import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { audioCaptureInventorySchema, audioCaptureStatusSchema, type AudioCaptureEvent, type AudioCaptureInventory, type AudioCaptureSettings, type AudioCaptureSettingsState, type AudioCaptureStart, type AudioCaptureStatus } from '../../../../src/core/audioCapture/contracts'
import { AudioCaptureClient } from './client'
import { AudioCaptureError } from './protocol'
import { AudioCaptureSettingsService, captureSettingsState, resolveCaptureSettings } from './settings'
import { createMainLogger } from '../logging'

const logger = createMainLogger('main.audio_capture')
export class AudioCaptureService {
  private inventory: AudioCaptureInventory | undefined
  private active: { owner: number; sessionId: string; outputPath: string; writtenBytes: number } | undefined
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
    if (this.active) throw new AudioCaptureError('RECORDING_ACTIVE', '已有录音会话，请先停止')
    const { native, notice } = await this.nativeSettings(request.settings ?? this.settings.read().settings)
    const sessionId = randomUUID()
    this.lastSent = -1; this.lastAcknowledged = -1; this.deliveryFailed = false
    this.active = { owner, sessionId, outputPath: request.outputPath, writtenBytes: 0 }; this.client.setActive(true)
    logger.info('开始录音', { event: 'audio_capture.recording.start', context: { sessionId } })
    try { const result = audioCaptureStatusSchema.parse(await this.client.request('start', { ...request, settings: native, sessionId })); return { ...result, notice: result.sampleRate !== native.sampleRate ? [notice, `驱动当前采样率为 ${result.sampleRate} Hz，本次按驱动设置录音。`].filter(Boolean).join(' ') : notice } }
    catch (error) { this.active = undefined; this.client.setActive(false); logger.warn('录音启动失败', { event: 'audio_capture.recording.failed', error }); throw error }
  }
  async control(owner: number, type: 'pause' | 'resume' | 'stop' | 'status', sessionId: string): Promise<AudioCaptureStatus> {
    if (this.active?.owner !== owner || this.active.sessionId !== sessionId) throw new AudioCaptureError('SESSION_NOT_OWNED', '录音会话已结束或不属于当前窗口')
    const result = audioCaptureStatusSchema.parse(await this.client.request(type, { sessionId }))
    if (type === 'stop') { this.active = undefined; this.client.setActive(false); logger.info('录音已保存', { event: 'audio_capture.recording.completed', context: { sessionId, writtenBytes: result.writtenBytes } }) }
    else if (type !== 'status') logger.info('录音状态改变', { event: `audio_capture.${type}.completed`, context: { sessionId } })
    return result
  }
  watchDevices(owner: number, enabled: boolean): void {
    if (enabled) this.deviceWatchers.add(owner); else this.deviceWatchers.delete(owner)
    clearInterval(this.deviceTimer)
    if (this.deviceWatchers.size) { this.deviceTimer = setInterval(() => { if (!this.active) void this.run(() => this.enumerate()).catch(error => logger.debug('刷新录音设备失败', { event: 'audio_capture.devices.failed', error })) }, 10_000); this.deviceTimer.unref() }
  }
  acknowledge(owner: number, sessionId: string, sequence: number): void {
    if (this.active?.owner !== owner || this.active.sessionId !== sessionId) return
    if (sequence <= this.lastSent) this.lastAcknowledged = Math.max(this.lastAcknowledged, sequence)
  }
  async releaseOwner(owner: number): Promise<void> { this.watchDevices(owner, false); if (this.active?.owner === owner) await this.control(owner, 'stop', this.active.sessionId) }
  async openAsioPanel(settings: AudioCaptureSettings): Promise<void> { const { native } = await this.nativeSettings(settings); await this.client.request('asioPanel', { device: native.device }); this.inventory = undefined }
  async recover(outputPath: string): Promise<{ writtenBytes: number }> {
    if (this.isRecordingPath(outputPath)) throw new AudioCaptureError('RECORDING_ACTIVE', '请先停止录音，再恢复文件')
    logger.info('恢复录音文件', { event: 'audio_capture.recover.start' })
    try { const result = z.object({ writtenBytes: z.number() }).parse(await this.client.request('recover', { outputPath })); logger.info('录音文件已恢复', { event: 'audio_capture.recover.completed', context: result }); return result }
    catch (error) { logger.warn('录音恢复失败', { event: 'audio_capture.recover.failed', error }); throw error }
  }
  dispose(): void { clearInterval(this.deviceTimer); this.client.dispose() }
}
