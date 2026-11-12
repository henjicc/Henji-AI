import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { audioCaptureInventorySchema, audioCaptureStatusSchema, type AudioCaptureEvent, type AudioCaptureHealth, type AudioCaptureInventory, type AudioCaptureSettings, type AudioCaptureSettingsState, type AudioCaptureStart, type AudioCaptureStatus, type SystemAudioNativeEvent } from '../../../../src/core/audioCapture/contracts'
import { AudioCaptureClient } from './client'
import { AudioCaptureError } from './protocol'
import { AudioCaptureSettingsService, captureSettingsState, resolveCaptureSettings } from './settings'
import { createMainLogger } from '../logging'

/**
 * 订阅方未确认的块达到这么多就暂停给它推送，降到四分之一以下恢复。推送跟不上只丢推送，从不停录音：落盘在原生进程里，与推送无关。
 * 每块 512–1024 帧。音频编辑只拿推送画波形，1024 块（48 kHz 约 11–22 秒）就够；录屏、讲解的麦克风轨是用推送写的，
 * 丢推送就是轨道空档，给到 4096 块（约 44–87 秒，界面里排队的采样最多约 32 MB）。完整录音始终在原生文件里。
 */
export const PREVIEW_DROP_LAG = 1024
export const SHARED_DROP_LAG = 4096
/** 暂停推送期间每隔这么多块仍发一块：订阅方缓过来确认了它，就能接着收（界面重载后的新界面也靠它接上）。 */
const PREVIEW_PROBE_INTERVAL = 50
/** 共享麦克风中断后的重连间隔：先快后慢，直到所有订阅都结束。 */
const RECONNECT_DELAYS_MS = [500, 1000, 2000, 3000]

interface Subscriber { owner: number; paused: boolean; lastSent: number; acknowledged: number; dropping: boolean; dropped: number; sinceProbe: number }
interface ActiveCapture {
  owner: number
  /** 当前原生会话；独占录音时也是唯一订阅的 ID。共享麦克风重连后换新。 */
  sessionId: string
  outputPath: string
  /** 共享麦克风每次重连都在同一目录写新文件（原名-2.wav…）；除最后一份外，结束时由这里清理。 */
  readonly basePath: string
  segments: string[]
  segmentIndex: number
  shared: boolean
  streamSamples: boolean
  settings: AudioCaptureSettings
  subscribers: Map<string, Subscriber>
  /** 原生会话是否在采集；共享麦克风重连期间为 false。 */
  native: boolean
  sampleRate: number
  writtenBytes: number
  durationSeconds: number
  health: AudioCaptureHealth | undefined
  startedAt: number
  /** 推给订阅方的序号在重连后继续递增，渲染层的确认计数不用跟着重置。 */
  sequenceBase: number
  lastSequence: number
  reconnects: number
  reconnect?: { timer?: ReturnType<typeof setTimeout>; attempt: number; since: number; code: string }
  releaseWakeLock: () => void
}
export interface AudioCaptureServiceHooks {
  /** 录音进行中阻止系统睡眠；返回释放函数。 */
  holdWakeLock?: (reason: string) => () => void
  /** 独占录音（音频编辑）意外结束：最小化时也要让用户知道。 */
  interrupted?: (owner: number, event: InterruptedEvent) => void
}
type InterruptedEvent = Extract<AudioCaptureEvent, { event: 'interrupted' }>
const logger = createMainLogger('main.audio_capture')
const subscriber = (owner: number): Subscriber => ({ owner, paused: false, lastSent: -1, acknowledged: -1, dropping: false, dropped: 0, sinceProbe: 0 })
const segmentPath = (base: string, index: number): string => path.join(path.dirname(base), `${path.basename(base, path.extname(base))}-${index}${path.extname(base)}`)

export class AudioCaptureService {
  private inventory: AudioCaptureInventory | undefined
  private active: ActiveCapture | undefined
  private queue: Promise<unknown> = Promise.resolve()
  private readonly deviceWatchers = new Set<number>()
  private deviceTimer: ReturnType<typeof setInterval> | undefined
  private readonly client: AudioCaptureClient
  constructor(executable: () => string, private readonly settings = new AudioCaptureSettingsService(), private readonly publish: (owner: number | undefined, event: AudioCaptureEvent) => void = () => {}, private readonly hooks: AudioCaptureServiceHooks = {}) {
    this.client = new AudioCaptureClient(executable, event => this.event(event), loss => {
      this.inventory = undefined
      const active = this.active
      if (active?.native) this.event({ event: 'interrupted', sessionId: active.sessionId, outputPath: active.outputPath, writtenBytes: active.writtenBytes, error: { ...loss, recoverable: true } })
    })
  }
  /** 所有状态写入串行；一次开始占有设备，后来的调用不能抢走或停止它。 */
  run<T>(task: () => Promise<T>): Promise<T> { const result = this.queue.then(task); this.queue = result.catch(() => undefined); return result }
  isRecordingPath(outputPath: string): boolean { return this.active?.outputPath === outputPath }
  private event(event: AudioCaptureEvent | SystemAudioNativeEvent): void {
    const active = this.active
    // 系统声在另一个原生进程里（system-audio.ts），麦克风进程不会发它的事件。
    if (!active || event.event === 'devicesChanged' || event.event === 'segment' || event.event === 'device' || event.event === 'systemHealth' || event.sessionId !== active.sessionId) return
    if (event.event === 'samples') {
      const sequence = event.sequence + active.sequenceBase
      active.lastSequence = Math.max(active.lastSequence, sequence)
      for (const [id, value] of active.subscribers) if (!value.paused && this.offer(active, id, value, sequence)) this.publish(value.owner, { ...event, sequence, sessionId: id })
      return
    }
    if (event.event === 'level') {
      active.writtenBytes = event.writtenBytes; active.durationSeconds = event.durationSeconds
      for (const [id, value] of active.subscribers) this.publish(value.owner, { ...event, sessionId: id })
      return
    }
    if (event.event === 'health') { active.durationSeconds = Math.max(active.durationSeconds, event.durationSeconds); this.recordHealth(active, event.health); return }
    if (event.health) this.recordHealth(active, event.health)
    active.writtenBytes = event.writtenBytes
    if (active.shared && active.subscribers.size) { this.beginReconnect(active, event); return }
    this.endInterrupted(active, event)
  }
  /** 录音意外结束：收尾会话并告诉订阅方，独占录音另外提醒用户。 */
  private endInterrupted(active: ActiveCapture, event: InterruptedEvent): void {
    if (this.active !== active) return
    this.finish(active, 'interrupted', event.error.code)
    for (const [id, value] of active.subscribers) this.publish(value.owner, { ...event, sessionId: id })
    if (!active.shared) this.hooks.interrupted?.(active.owner, event)
  }
  /** 决定这一块推不推给该订阅方；跟不上时只丢推送并计数。 */
  private offer(active: ActiveCapture, id: string, value: Subscriber, sequence: number): boolean {
    const lag = value.lastSent < 0 ? 0 : value.lastSent - value.acknowledged
    const dropLag = active.shared ? SHARED_DROP_LAG : PREVIEW_DROP_LAG
    if (value.dropping) {
      if (lag <= dropLag / 4) {
        value.dropping = false
        logger.info('采样推送已恢复', { event: 'audio_capture.preview.resumed', context: { sessionId: id, mode: active.shared ? 'shared' : 'exclusive', droppedBlocks: value.dropped } })
      } else {
        value.dropped += 1
        if (++value.sinceProbe < PREVIEW_PROBE_INTERVAL) return false
        value.sinceProbe = 0
      }
    } else if (lag >= dropLag) {
      value.dropping = true; value.sinceProbe = 0; value.dropped += 1
      logger.warn(active.shared ? '麦克风轨的接收方跟不上，暂停推送：录屏或讲解的麦克风轨会出现空档，完整录音仍在原生文件里' : '采样接收方跟不上，暂停推送，录音继续', { event: 'audio_capture.preview.dropping', context: { sessionId: id, mode: active.shared ? 'shared' : 'exclusive', lag } })
      return false
    }
    if (value.lastSent < 0) value.acknowledged = sequence - 1
    value.lastSent = sequence
    return true
  }
  private recordHealth(active: ActiveCapture, health: AudioCaptureHealth): void {
    const previous = active.health
    active.health = health
    const grew = (key: keyof AudioCaptureHealth): number => health[key] - (previous?.[key] ?? 0)
    const context = { sessionId: active.sessionId, ...health, newInputOverflows: grew('inputOverflows'), newInputUnderflows: grew('inputUnderflows'), newDroppedFrames: grew('droppedFrames'), newDroppedPreviewBlocks: grew('droppedPreviewBlocks') }
    if (context.newInputOverflows > 0 || context.newInputUnderflows > 0 || context.newDroppedFrames > 0) logger.warn('录音采样出现缺口，已计数并继续录音', { event: 'audio_capture.recording.glitch', context })
    // 独占录音的推送只画波形；共享麦克风的推送就是录屏、讲解的麦克风轨，丢了轨道就有空档。
    else if (context.newDroppedPreviewBlocks > 0 && active.shared) logger.warn('麦克风推送有丢弃，录屏或讲解的麦克风轨会出现空档，完整录音仍在原生文件里', { event: 'audio_capture.preview.dropped', context: { ...context, mode: 'shared' } })
    else if (context.newDroppedPreviewBlocks > 0) logger.info('波形推送有丢弃，录音文件不受影响', { event: 'audio_capture.preview.dropped', context: { ...context, mode: 'exclusive' } })
    else if (grew('maxWriteMs') > 0 && health.maxWriteMs >= 100) logger.warn('录音写盘耗时出现新峰值', { event: 'audio_capture.disk.slow', context })
  }
  private finish(active: ActiveCapture, outcome: 'completed' | 'interrupted', code?: string): void {
    if (this.active !== active) return
    clearTimeout(active.reconnect?.timer)
    this.active = undefined; this.client.setActive(false)
    active.releaseWakeLock()
    const previewDroppedBlocks = [...active.subscribers.values()].reduce((sum, value) => sum + value.dropped, 0)
    const context = { sessionId: active.sessionId, mode: active.shared ? 'shared' : 'exclusive', outcome, ...(code ? { code } : {}), durationSeconds: active.durationSeconds, writtenBytes: active.writtenBytes,
      elapsedSeconds: Math.round((Date.now() - active.startedAt) / 1000), reconnects: active.reconnects, previewDroppedBlocks, ...active.health }
    if (outcome === 'interrupted') logger.warn('录音中断，文件已保留', { event: 'audio_capture.recording.failed', context })
    logger.info('录音结束汇总', { event: 'audio_capture.recording.summary', context })
    // 重连前写过的共享麦克风临时文件只由这里清理；最后一份交给订阅方（录屏在停止后删除它）。
    for (const segment of active.segments) if (segment !== active.outputPath) void fs.rm(segment, { force: true }).catch(error => logger.debug('共享麦克风临时文件清理失败', { event: 'audio_capture.segment.cleanup.failed', error }))
  }
  private beginReconnect(active: ActiveCapture, event: InterruptedEvent): void {
    active.native = false
    if (!active.segments.includes(event.outputPath)) active.segments.push(event.outputPath)
    clearTimeout(active.reconnect?.timer)
    active.reconnect = { attempt: 0, since: Date.now(), code: event.error.code }
    active.sequenceBase = active.lastSequence + 1
    logger.warn('共享麦克风中断，自动重连', { event: 'audio_capture.reconnect.start', context: { code: event.error.code, subscribers: active.subscribers.size } })
    this.scheduleReconnect(active)
  }
  private scheduleReconnect(active: ActiveCapture): void {
    const reconnect = active.reconnect
    if (!reconnect) return
    reconnect.timer = setTimeout(() => { void this.run(() => this.reconnectOnce(active, reconnect)) }, RECONNECT_DELAYS_MS[Math.min(reconnect.attempt, RECONNECT_DELAYS_MS.length - 1)])
    reconnect.timer.unref?.()
  }
  private async reconnectOnce(active: ActiveCapture, reconnect: NonNullable<ActiveCapture['reconnect']>): Promise<void> {
    if (this.active !== active || active.reconnect !== reconnect || !active.subscribers.size) return
    reconnect.attempt += 1
    try {
      // 设备可能已换了索引或被拔掉：重新枚举，按与开始录音相同的规则找设备（找不到就用默认输入并记录）。
      const { native, notice } = await this.nativeSettings(active.settings, await this.enumerate(true))
      // 每次尝试换新文件名：启动失败也可能已建出空文件，原生端不覆盖已有文件。
      const sessionId = randomUUID(), outputPath = segmentPath(active.basePath, ++active.segmentIndex)
      active.sessionId = sessionId; active.outputPath = outputPath; active.segments.push(outputPath)
      const result = audioCaptureStatusSchema.parse(await this.client.request('start', { outputPath, streamSamples: active.streamSamples, monitor: false, settings: native, sessionId }))
      // 启动途中又中断了：那次中断已经安排了下一轮，这一轮作废。
      if (this.active !== active || active.reconnect !== reconnect) return
      active.native = true; active.sampleRate = result.sampleRate; active.reconnect = undefined; active.reconnects += 1
      this.client.setActive(true)
      for (const value of active.subscribers.values()) { value.lastSent = -1; value.acknowledged = -1; value.dropping = false }
      if ([...active.subscribers.values()].every(value => value.paused)) await this.client.request('pause', { sessionId })
      logger.info('共享麦克风已重连', { event: 'audio_capture.reconnect.completed', context: { attempts: reconnect.attempt, gapSeconds: (Date.now() - reconnect.since) / 1000, code: reconnect.code, ...(notice ? { notice } : {}) } })
    } catch (error) {
      if (this.active !== active || active.reconnect !== reconnect) return
      active.native = false
      if (reconnect.attempt === 1) logger.warn('共享麦克风重连失败，稍后再试', { event: 'audio_capture.reconnect.failed', error, context: { attempt: reconnect.attempt } })
      else logger.debug('共享麦克风重连失败，稍后再试', { event: 'audio_capture.reconnect.failed', error, context: { attempt: reconnect.attempt } })
      this.scheduleReconnect(active)
    }
  }
  /** 重连期间没有原生会话可问，用已知事实回答状态。 */
  private idleStatus(active: ActiveCapture): AudioCaptureStatus {
    return { sessionId: active.sessionId, outputPath: active.outputPath, state: 'recording', sampleRate: active.sampleRate, inputLatency: 0, callbackFrames: 0, frames: 0, writtenBytes: active.writtenBytes, durationSeconds: active.durationSeconds, ...(active.health ? { health: active.health } : {}) }
  }
  async enumerate(fresh = false): Promise<AudioCaptureInventory> {
    if (!fresh && this.active && this.inventory) return this.inventory
    const inventory = audioCaptureInventorySchema.parse(await this.client.request('enumerate'))
    const changed = JSON.stringify(inventory) !== JSON.stringify(this.inventory)
    if (changed && this.inventory) logger.info('录音设备有变化', { event: 'audio_capture.devices.changed', context: { inputs: inventory.devices.filter(device => device.maxInputChannels > 0).length } })
    this.inventory = inventory
    if (changed) this.publish(undefined, { event: 'devicesChanged', inventory })
    return inventory
  }
  async getSettings(): Promise<AudioCaptureSettingsState> { return captureSettingsState(this.settings, this.inventory ?? await this.enumerate()) }
  async setSettings(settings: AudioCaptureSettings, revision: number): Promise<AudioCaptureSettingsState> {
    this.settings.write(settings, revision)
    logger.info('录音设置已保存', { event: 'audio_capture.settings.completed' })
    return this.getSettings()
  }
  private async nativeSettings(settings: AudioCaptureSettings, inventory?: AudioCaptureInventory): Promise<{ native: Record<string, unknown>; notice: string | null }> {
    const resolved = resolveCaptureSettings(settings, inventory ?? await this.enumerate())
    const { deviceName: _name, deviceOrdinal: _ordinal, ...parameters } = resolved.effectiveSettings
    void _name; void _ordinal
    return { native: { ...parameters, device: resolved.device }, notice: resolved.notice }
  }
  async probe(settings: AudioCaptureSettings): Promise<{ formats: { sampleRate: number; bitDepth: number; supported: boolean }[] }> {
    const { native } = await this.nativeSettings(settings)
    return z.object({ formats: z.array(z.object({ sampleRate: z.number(), bitDepth: z.number(), supported: z.boolean() })) }).parse(await this.client.request('probe', { settings: native }))
  }
  async start(owner: number, request: AudioCaptureStart): Promise<AudioCaptureStatus & { notice: string | null }> {
    const current = this.active
    if (current) {
      if (!request.shared || !request.streamSamples || !current.shared) throw new AudioCaptureError('RECORDING_ACTIVE', '已有独占录音会话，请先停止音频编辑录音再开始录屏或讲解。')
      const sessionId = randomUUID()
      let status = this.idleStatus(current)
      if (current.native) {
        status = audioCaptureStatusSchema.parse(await this.client.request('status', { sessionId: current.sessionId }))
        if ([...current.subscribers.values()].every(value => value.paused)) await this.client.request('resume', { sessionId: current.sessionId })
      }
      current.subscribers.set(sessionId, subscriber(owner))
      logger.info('共享现有麦克风采集', { event: 'audio_capture.subscription.start', context: { subscribers: current.subscribers.size } })
      return { ...status, sessionId, state: 'recording', sharedSubscribers: current.subscribers.size, settings: current.settings, notice: null }
    }
    const effective = (await this.getSettings()).effectiveSettings
    const settings = request.settings ?? effective
    const { native, notice } = await this.nativeSettings(settings)
    const sessionId = randomUUID(), shared = Boolean(request.shared && request.streamSamples)
    const active: ActiveCapture = { owner, sessionId, outputPath: request.outputPath, basePath: request.outputPath, segments: [], segmentIndex: 1, shared, streamSamples: request.streamSamples ?? false, settings,
      subscribers: new Map([[sessionId, subscriber(owner)]]), native: false, sampleRate: Number(native.sampleRate) || 48000, writtenBytes: 0, durationSeconds: 0, health: undefined, startedAt: Date.now(),
      sequenceBase: 0, lastSequence: -1, reconnects: 0, releaseWakeLock: () => {} }
    this.active = active; this.client.setActive(true)
    logger.info('开始录音', { event: 'audio_capture.recording.start', context: { sessionId, mode: shared ? 'shared' : 'exclusive', hostApi: settings.hostApi, sampleRate: native.sampleRate, channels: settings.channels, bitDepth: settings.bitDepth } })
    try {
      const result = audioCaptureStatusSchema.parse(await this.client.request('start', { outputPath: request.outputPath, streamSamples: request.streamSamples ?? false, monitor: false, settings: native, sessionId }))
      active.native = true; active.sampleRate = result.sampleRate
      if (this.active === active) active.releaseWakeLock = this.hooks.holdWakeLock?.(shared ? '麦克风' : '音频编辑录音') ?? (() => {})
      return { ...result, settings, ...(shared ? { sharedSubscribers: 1 } : {}), notice: result.sampleRate !== native.sampleRate ? [notice, `驱动当前采样率为 ${result.sampleRate} Hz，本次按驱动设置录音。`].filter(Boolean).join(' ') : notice }
    } catch (error) {
      if (this.active === active) { this.active = undefined; this.client.setActive(false) }
      logger.warn('录音启动失败', { event: 'audio_capture.recording.failed', error })
      throw error
    }
  }
  async control(owner: number, type: 'pause' | 'resume' | 'stop' | 'status', sessionId: string): Promise<AudioCaptureStatus> {
    const active = this.active, value = active?.subscribers.get(sessionId)
    if (!active || !value || value.owner !== owner) throw new AudioCaptureError('SESSION_NOT_OWNED', active?.shared ? '录音订阅已结束或不属于当前窗口' : '录音会话已结束或不属于当前窗口')
    if (active.shared) return this.controlSubscriber(active, value, type, sessionId)
    let result: AudioCaptureStatus
    try { result = audioCaptureStatusSchema.parse(await this.client.request(type, { sessionId })) }
    catch (error) {
      // 原生收到停止就会结束会话，哪怕收尾报错；主进程也得收尾，并按中断告诉界面，让它去恢复文件。
      // 不应答的情况已由客户端结束原生进程、走崩溃回调收拢，这里再调用无害。
      if (type === 'stop') this.endInterrupted(active, { event: 'interrupted', sessionId, outputPath: active.outputPath, writtenBytes: active.writtenBytes,
        error: { code: error instanceof AudioCaptureError ? error.code : 'CAPTURE_FAILED', message: error instanceof Error ? error.message : '录音没能正常停止，已录部分保留', recoverable: true } })
      throw error
    }
    if (result.health) this.recordHealth(active, result.health)
    if (type === 'stop') {
      active.durationSeconds = result.durationSeconds; active.writtenBytes = result.writtenBytes
      logger.info('录音已保存', { event: 'audio_capture.recording.completed', context: { sessionId, writtenBytes: result.writtenBytes } })
      this.finish(active, 'completed')
    } else if (type !== 'status') logger.info('录音状态改变', { event: `audio_capture.${type}.completed`, context: { sessionId } })
    return result
  }
  private async controlSubscriber(active: ActiveCapture, value: Subscriber, type: 'pause' | 'resume' | 'stop' | 'status', sessionId: string): Promise<AudioCaptureStatus> {
    const shared = active.subscribers
    const othersRunning = [...shared.entries()].some(([id, other]) => id !== sessionId && !other.paused)
    const operation = type === 'stop' && shared.size === 1 ? 'stop'
      : (type === 'pause' || type === 'stop') && !value.paused && !othersRunning ? 'pause'
      : type === 'resume' && value.paused && !othersRunning ? 'resume' : 'status'
    let result: AudioCaptureStatus | undefined
    try {
      result = active.native ? audioCaptureStatusSchema.parse(await this.client.request(operation, { sessionId: active.sessionId })) : this.idleStatus(active)
    } finally {
      // 停止无论原生应答成败都移除这路订阅：录屏、讲解的停止只调用一次，留着它会让麦克风一直采集、一直重连。
      if (type === 'stop') {
        shared.delete(sessionId)
        if (!shared.size) {
          if (result) { active.durationSeconds = result.durationSeconds; active.writtenBytes = result.writtenBytes }
          this.finish(active, 'completed')
        }
      }
    }
    if (result.health) this.recordHealth(active, result.health)
    if (type !== 'stop' && type !== 'status') { value.paused = type === 'pause'; value.lastSent = -1; value.acknowledged = -1; value.dropping = false }
    if (type !== 'status') logger.info('麦克风订阅状态改变', { event: `audio_capture.subscription.${type}.completed`, context: { subscribers: shared.size } })
    return { ...result, sessionId, settings: active.settings, sharedSubscribers: shared.size, state: type === 'stop' ? 'stopped' : value.paused ? 'paused' : 'recording' }
  }
  /**
   * 当前窗口仍在进行的音频编辑录音：界面重载或崩溃后，新界面据此接管并显示时长。
   * 旧界面的推送确认作废，从这一刻重新计。
   */
  async activeRecording(owner: number): Promise<(AudioCaptureStatus & { settings: AudioCaptureSettings }) | null> {
    const active = this.active
    if (!active || active.shared || active.owner !== owner || !active.native) return null
    const status = audioCaptureStatusSchema.parse(await this.client.request('status', { sessionId: active.sessionId }))
    // 应答之后紧跟着的中断事件可能已经先处理了：那时界面还没开始收事件，不能再交给它一段已结束的录音。
    if (this.active !== active || !active.native) return null
    const value = active.subscribers.get(active.sessionId)
    if (value) { value.lastSent = -1; value.acknowledged = -1; value.dropping = false }
    logger.info('界面查询进行中的录音', { event: 'audio_capture.owner.attached', context: { sessionId: active.sessionId, durationSeconds: status.durationSeconds } })
    return { ...status, settings: active.settings }
  }
  watchDevices(owner: number, enabled: boolean): void {
    if (enabled) this.deviceWatchers.add(owner); else this.deviceWatchers.delete(owner)
    clearInterval(this.deviceTimer)
    if (this.deviceWatchers.size) { this.deviceTimer = setInterval(() => { if (!this.active) void this.run(() => this.enumerate()).catch(error => logger.debug('刷新录音设备失败', { event: 'audio_capture.devices.failed', error })) }, 10_000); this.deviceTimer.unref() }
  }
  acknowledge(owner: number, sessionId: string, sequence: number): void {
    const value = this.active?.subscribers.get(sessionId)
    if (value && value.owner === owner && sequence <= value.lastSent) value.acknowledged = Math.max(value.acknowledged, sequence)
  }
  /**
   * 窗口的界面不在了。录屏、讲解的麦克风订阅由界面里的会话写分段，界面一走就失去归属，直接结束；
   * 音频编辑录音写在原生进程里，界面只是观察者：重载或崩溃时（keepRecording）继续录，等新界面接管，窗口关掉才停。
   */
  async releaseOwner(owner: number, options: { keepRecording?: boolean } = {}): Promise<void> {
    this.watchDevices(owner, false)
    const active = this.active
    if (!active) return
    if (active.shared) { for (const [id, value] of [...active.subscribers]) if (value.owner === owner) await this.control(owner, 'stop', id); return }
    if (active.owner !== owner) return
    if (options.keepRecording) { logger.info('界面已离开，录音继续，等待新界面接管', { event: 'audio_capture.owner.detached', context: { sessionId: active.sessionId } }); return }
    await this.control(owner, 'stop', active.sessionId)
  }
  async openAsioPanel(settings: AudioCaptureSettings): Promise<void> { const { native } = await this.nativeSettings(settings); await this.client.request('asioPanel', { device: native.device }); this.inventory = undefined }
  /** 失联的原生进程还在把队列写进文件时，恢复或回收同一个文件要等它写完退出。 */
  settled(): Promise<void> { return this.client.settled() }
  async recover(outputPath: string): Promise<{ writtenBytes: number }> {
    if (this.isRecordingPath(outputPath)) throw new AudioCaptureError('RECORDING_ACTIVE', '请先停止录音，再恢复文件')
    await this.settled()
    logger.info('恢复录音文件', { event: 'audio_capture.recover.start' })
    try { const result = z.object({ writtenBytes: z.number() }).parse(await this.client.request('recover', { outputPath })); logger.info('录音文件已恢复', { event: 'audio_capture.recover.completed', context: result }); return result }
    catch (error) { logger.warn('录音恢复失败', { event: 'audio_capture.recover.failed', error }); throw error }
  }
  /** 应用退出时（所有窗口已批准关闭之后）调用：让原生进程收尾 WAV 再退出。 */
  dispose(): Promise<void> {
    clearInterval(this.deviceTimer)
    clearTimeout(this.active?.reconnect?.timer)
    this.active?.releaseWakeLock()
    return this.client.dispose()
  }
}
