import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { audioCaptureInventorySchema, audioCaptureStatusSchema, type AudioCaptureEvent, type AudioCaptureInventory, type AudioCaptureSettings, type AudioCaptureSettingsState, type AudioCaptureStart, type AudioCaptureStatus } from '../../../../src/core/audioCapture/contracts'
import { AudioCaptureClient } from './client'
import { AudioCaptureError } from './protocol'
import { AudioCaptureSettingsService, captureSettingsState, resolveCaptureSettings } from './settings'
import { createMainLogger } from '../logging'

interface CaptureSubscriber { owner: number; paused: boolean; lastSent: number; acknowledged: number; failed: boolean }
const logger = createMainLogger('main.audio_capture')
export class AudioCaptureService {
  private inventory: AudioCaptureInventory | undefined
  private active: { owner: number; sessionId: string; outputPath: string; writtenBytes: number; shared?: { settings: AudioCaptureSettings; subscribers: Map<string, CaptureSubscriber> } } | undefined
  private queue: Promise<unknown> = Promise.resolve()
  private readonly deviceWatchers = new Set<number>()
  private deviceTimer: ReturnType<typeof setInterval> | undefined
  private lastSent = -1
  private lastAcknowledged = -1
  private deliveryFailed = false
  private readonly client: AudioCaptureClient
  constructor(executable: () => string, private readonly settings = new AudioCaptureSettingsService(), private readonly publish: (owner: number | undefined, event: AudioCaptureEvent) => void = () => {}) {
    this.client = new AudioCaptureClient(executable, event => this.event(event), () => {
      this.inventory = undefined
      if (this.active) this.event({ event: 'interrupted', ...this.active, error: { code: 'PROCESS_EXITED', message: '录音服务异常退出，已写文件保留，可恢复后重新录制', recoverable: true } })
    })
  }
  /** 所有状态写入串行；一次开始占有设备，后来的调用不能抢走或停止它。 */
  run<T>(task: () => Promise<T>): Promise<T> { const result = this.queue.then(task); this.queue = result.catch(() => undefined); return result }
  isRecordingPath(outputPath: string): boolean { return this.active?.outputPath === outputPath }
  private event(event: AudioCaptureEvent): void {
    const owner = this.active?.owner
    if ('sessionId' in event && event.sessionId !== this.active?.sessionId) return
    const shared = this.active?.shared
    if (shared && 'sessionId' in event) {
      if (event.event === 'level' && this.active) this.active.writtenBytes = event.writtenBytes
      for (const [sessionId, subscriber] of shared.subscribers) {
        if (event.event === 'samples') {
          if (subscriber.paused || subscriber.failed) continue
          if (subscriber.lastSent - subscriber.acknowledged >= 128) {
            subscriber.failed = true
            void this.run(async () => {
              if (!this.active?.shared?.subscribers.has(sessionId)) return
              const status = await this.control(subscriber.owner, 'stop', sessionId)
              this.publish(subscriber.owner, { event: 'interrupted', sessionId, outputPath: status.outputPath, writtenBytes: status.writtenBytes, error: { code: 'CONSUMER_TOO_SLOW', message: '采样接收方处理过慢，已停止此路录音，其他录音继续。', recoverable: true } })
            }).catch(error => logger.warn('共享采样停止失败', { event: 'audio_capture.delivery.failed', error }))
            continue
          }
          if (subscriber.lastSent < 0) subscriber.acknowledged = event.sequence - 1
          subscriber.lastSent = event.sequence
        }
        this.publish(subscriber.owner, { ...event, sessionId })
      }
      if (event.event === 'interrupted') {
        logger.warn('共享录音中断，已写文件保留', { event: 'audio_capture.recording.failed', context: { code: event.error.code } })
        this.active = undefined; this.client.setActive(false)
      }
      return
    }
    if (event.event === 'samples') {
      if (this.deliveryFailed) return
      if (this.lastSent - this.lastAcknowledged >= 128 && this.active) {
        this.deliveryFailed = true
        const active = { ...this.active }
        void this.run(async () => {
          if (this.active?.sessionId !== active.sessionId) return
          const result = await this.control(active.owner, 'stop', active.sessionId)
          this.publish(active.owner, { event: 'interrupted', sessionId: active.sessionId, outputPath: active.outputPath, writtenBytes: result.writtenBytes, error: { code: 'CONSUMER_TOO_SLOW', message: '采样接收方处理过慢，录音已停止并保留，请关闭繁忙任务后重试', recoverable: true } })
        }).catch(error => logger.warn('采样背压停止失败', { event: 'audio_capture.delivery.failed', error }))
        return
      }
      this.lastSent = event.sequence
    }
    if (event.event === 'level' && this.active) this.active.writtenBytes = event.writtenBytes
    if (event.event === 'interrupted') {
      logger.warn('录音中断，文件已保留', { event: 'audio_capture.recording.failed', context: { sessionId: event.sessionId, code: event.error.code } })
      this.active = undefined; this.client.setActive(false)
    }
    this.publish(owner, event)
  }
  async enumerate(): Promise<AudioCaptureInventory> {
    if (this.active && this.inventory) return this.inventory
    const inventory = audioCaptureInventorySchema.parse(await this.client.request('enumerate'))
    const changed = JSON.stringify(inventory) !== JSON.stringify(this.inventory)
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
  private async nativeSettings(settings: AudioCaptureSettings): Promise<{ native: Record<string, unknown>; notice: string | null }> {
    const resolved = resolveCaptureSettings(settings, await this.enumerate())
    const { deviceName: _name, deviceOrdinal: _ordinal, ...parameters } = resolved.effectiveSettings
    void _name; void _ordinal
    return { native: { ...parameters, device: resolved.device }, notice: resolved.notice }
  }
  async probe(settings: AudioCaptureSettings): Promise<{ formats: { sampleRate: number; bitDepth: number; supported: boolean }[] }> {
    const { native } = await this.nativeSettings(settings)
    return z.object({ formats: z.array(z.object({ sampleRate: z.number(), bitDepth: z.number(), supported: z.boolean() })) }).parse(await this.client.request('probe', { settings: native }))
  }
  async start(owner: number, request: AudioCaptureStart): Promise<AudioCaptureStatus & { notice: string | null }> {
    if (this.active) {
      if (!request.shared || !request.streamSamples || !this.active.shared) throw new AudioCaptureError('RECORDING_ACTIVE', '已有独占录音会话，请先停止音频编辑录音再开始录屏或讲解。')
      const sessionId = randomUUID(), shared = this.active.shared
      const status = audioCaptureStatusSchema.parse(await this.client.request('status', { sessionId: this.active.sessionId }))
      if ([...shared.subscribers.values()].every(value => value.paused)) await this.client.request('resume', { sessionId: this.active.sessionId })
      shared.subscribers.set(sessionId, { owner, paused: false, lastSent: -1, acknowledged: -1, failed: false })
      logger.info('共享现有麦克风采集', { event: 'audio_capture.subscription.start', context: { subscribers: shared.subscribers.size } })
      return { ...status, sessionId, state: 'recording', sharedSubscribers: shared.subscribers.size, settings: shared.settings, notice: null }
    }
    const effective = (await this.getSettings()).effectiveSettings
    const settings = request.settings ?? effective
    const { native, notice } = await this.nativeSettings(settings)
    const sessionId = randomUUID()
    this.lastSent = -1; this.lastAcknowledged = -1; this.deliveryFailed = false
    this.active = { owner, sessionId, outputPath: request.outputPath, writtenBytes: 0, ...(request.shared && request.streamSamples ? { shared: { settings, subscribers: new Map([[sessionId, { owner, paused: false, lastSent: -1, acknowledged: -1, failed: false }]]) } } : {}) }; this.client.setActive(true)
    logger.info('开始录音', { event: 'audio_capture.recording.start', context: { sessionId } })
    try { const result = audioCaptureStatusSchema.parse(await this.client.request('start', { outputPath: request.outputPath, streamSamples: request.streamSamples ?? false, monitor: false, settings: native, sessionId })); return { ...result, settings, ...(this.active?.shared ? { sharedSubscribers: 1 } : {}), notice: result.sampleRate !== native.sampleRate ? [notice, `驱动当前采样率为 ${result.sampleRate} Hz，本次按驱动设置录音。`].filter(Boolean).join(' ') : notice } }
    catch (error) { this.active = undefined; this.client.setActive(false); logger.warn('录音启动失败', { event: 'audio_capture.recording.failed', error }); throw error }
  }
  async control(owner: number, type: 'pause' | 'resume' | 'stop' | 'status', sessionId: string): Promise<AudioCaptureStatus> {
    if (this.active?.shared) return this.controlSubscriber(owner, type, sessionId)
    if (this.active?.owner !== owner || this.active.sessionId !== sessionId) throw new AudioCaptureError('SESSION_NOT_OWNED', '录音会话已结束或不属于当前窗口')
    const result = audioCaptureStatusSchema.parse(await this.client.request(type, { sessionId }))
    if (type === 'stop') { this.active = undefined; this.client.setActive(false); logger.info('录音已保存', { event: 'audio_capture.recording.completed', context: { sessionId, writtenBytes: result.writtenBytes } }) }
    else if (type !== 'status') logger.info('录音状态改变', { event: `audio_capture.${type}.completed`, context: { sessionId } })
    return result
  }
  private async controlSubscriber(owner: number, type: 'pause' | 'resume' | 'stop' | 'status', sessionId: string): Promise<AudioCaptureStatus> {
    const active = this.active!, shared = active.shared!, subscriber = shared.subscribers.get(sessionId)
    if (!subscriber || subscriber.owner !== owner) throw new AudioCaptureError('SESSION_NOT_OWNED', '录音订阅已结束或不属于当前窗口')
    const othersRunning = [...shared.subscribers.entries()].some(([id, value]) => id !== sessionId && !value.paused)
    const operation = type === 'stop' && shared.subscribers.size === 1 ? 'stop'
      : (type === 'pause' || type === 'stop') && !subscriber.paused && !othersRunning ? 'pause'
      : type === 'resume' && subscriber.paused && !othersRunning ? 'resume' : 'status'
    const result = audioCaptureStatusSchema.parse(await this.client.request(operation, { sessionId: active.sessionId }))
    if (type === 'stop') shared.subscribers.delete(sessionId)
    else if (type !== 'status') { subscriber.paused = type === 'pause'; subscriber.lastSent = -1; subscriber.acknowledged = -1 }
    if (!shared.subscribers.size) { this.active = undefined; this.client.setActive(false) }
    if (type !== 'status') logger.info('麦克风订阅状态改变', { event: `audio_capture.subscription.${type}.completed`, context: { subscribers: shared.subscribers.size } })
    return { ...result, sessionId, settings: shared.settings, sharedSubscribers: shared.subscribers.size, state: type === 'stop' ? 'stopped' : subscriber.paused ? 'paused' : 'recording' }
  }
  watchDevices(owner: number, enabled: boolean): void {
    if (enabled) this.deviceWatchers.add(owner); else this.deviceWatchers.delete(owner)
    clearInterval(this.deviceTimer)
    if (this.deviceWatchers.size) { this.deviceTimer = setInterval(() => { if (!this.active) void this.run(() => this.enumerate()).catch(error => logger.debug('刷新录音设备失败', { event: 'audio_capture.devices.failed', error })) }, 10_000); this.deviceTimer.unref() }
  }
  acknowledge(owner: number, sessionId: string, sequence: number): void {
    const subscriber = this.active?.shared?.subscribers.get(sessionId)
    if (subscriber) { if (subscriber.owner === owner && sequence <= subscriber.lastSent) subscriber.acknowledged = Math.max(subscriber.acknowledged, sequence); return }
    if (this.active?.owner !== owner || this.active.sessionId !== sessionId) return
    if (sequence <= this.lastSent) this.lastAcknowledged = Math.max(this.lastAcknowledged, sequence)
  }
  async releaseOwner(owner: number): Promise<void> {
    this.watchDevices(owner, false)
    if (this.active?.shared) { for (const [id, subscriber] of [...this.active.shared.subscribers]) if (subscriber.owner === owner) await this.control(owner, 'stop', id) }
    else if (this.active?.owner === owner) await this.control(owner, 'stop', this.active.sessionId)
  }
  async openAsioPanel(settings: AudioCaptureSettings): Promise<void> { const { native } = await this.nativeSettings(settings); await this.client.request('asioPanel', { device: native.device }); this.inventory = undefined }
  async recover(outputPath: string): Promise<{ writtenBytes: number }> {
    if (this.isRecordingPath(outputPath)) throw new AudioCaptureError('RECORDING_ACTIVE', '请先停止录音，再恢复文件')
    logger.info('恢复录音文件', { event: 'audio_capture.recover.start' })
    try { const result = z.object({ writtenBytes: z.number() }).parse(await this.client.request('recover', { outputPath })); logger.info('录音文件已恢复', { event: 'audio_capture.recover.completed', context: result }); return result }
    catch (error) { logger.warn('录音恢复失败', { event: 'audio_capture.recover.failed', error }); throw error }
  }
  dispose(): void { clearInterval(this.deviceTimer); this.client.dispose() }
}
