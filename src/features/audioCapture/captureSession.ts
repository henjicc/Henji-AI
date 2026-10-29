import { CapturePreview } from './capturePreview'
import { createStore } from 'zustand/vanilla'
import type { AudioCaptureFile, AudioCapturePlacement, AudioCaptureSettingsState, AudioCaptureStatus } from '@/core/audioCapture/contracts'
import type { AudioCapturePlatform } from '@/platform/contracts/audioCapture'
import { createLogger } from '@/core/logging'

export interface CaptureSessionState {
  placement: AudioCapturePlacement | null
  visible: boolean
  phase: 'idle' | 'recording' | 'paused' | 'stopped' | 'interrupted'
  busy: boolean
  status: AudioCaptureStatus | null
  outputPath: string | null
  settings: AudioCaptureSettingsState | null
  error: string
  notice: string | null
}
const logger = createLogger('features.audioCapture.session')
const message = (error: unknown): string => error instanceof Error ? error.message : String(error)

/** 录音状态归属应用服务；卸载视图不会丢失文件、会话或正在进行的停止操作。 */
export class CaptureSession {
  readonly store = createStore<CaptureSessionState>(() => ({ placement: null, visible: false, phase: 'idle', busy: false, status: null, outputPath: null, settings: null, error: '', notice: null }))
  readonly preview = new CapturePreview()
  durationSeconds = 0
  private release: (() => void) | undefined
  private operation: Promise<void> | undefined
  private leaveRequest: Promise<boolean> | undefined
  private unlock: (() => void) | undefined
  private imported = new Set<string>()
  constructor(private readonly api: AudioCapturePlatform, private readonly importMedia: (path: string) => Promise<unknown>, private readonly editor?: {
    lock: (id: string, expectedRevision?: number) => () => void
    commit: (path: string, placement: AudioCapturePlacement) => Promise<unknown>
    progress: (placement: AudioCapturePlacement, seconds: number) => void
    rate: (id: string) => number
  }) {}
  get active(): boolean { return ['recording', 'paused'].includes(this.store.getState().phase) }
  private listen(): void {
    if (this.release) return
    const samples = this.api.onSamples(event => { if (event.sessionId === this.store.getState().status?.sessionId) this.preview.push(event) })
    const events = this.api.onEvent(event => {
      const state = this.store.getState()
      if (!('sessionId' in event) || (event.sessionId !== state.status?.sessionId && !(event.event === 'interrupted' && event.outputPath === state.outputPath))) return
      if (event.event === 'level') {
        this.durationSeconds = event.durationSeconds
        if (state.placement && state.phase === 'recording') {
          this.editor?.progress(state.placement, this.durationSeconds)
          const length = state.placement.endFrame - state.placement.startFrame
          if (length > 0 && this.durationSeconds * (this.editor?.rate(state.placement.projectId) ?? 48000) >= length && !this.operation) void this.stop().catch(() => undefined)
        }
      }
      if (event.event === 'interrupted') {
        const channels = state.settings?.effectiveSettings.channels ?? 1
        const depth = state.settings?.effectiveSettings.bitDepth ?? 24
        this.durationSeconds = Math.max(this.durationSeconds, event.writtenBytes / (channels * depth / 8 * (state.status?.sampleRate ?? 48000)))
        this.unlock?.(); this.unlock = undefined
        this.store.setState({ phase: 'interrupted', error: `${event.error.message}。已保留到 ${this.durationSeconds.toFixed(1)} 秒`, outputPath: event.outputPath })
        logger.warn('录音中断', { event: 'audio_capture.session.interrupted', context: { code: event.error.code, durationSeconds: this.durationSeconds } })
      }
    })
    this.release = () => { samples(); events() }
  }
  private run(action: string, operation: () => Promise<void>): Promise<void> {
    if (this.operation) return this.operation
    this.store.setState({ busy: true, error: '' })
    logger.info('录音操作开始', { event: `audio_capture.session.${action}.start` })
    this.operation = operation().then(() => { logger.info('录音操作完成', { event: `audio_capture.session.${action}.completed` }) }).catch((error: unknown) => {
      if (action === 'start') { this.unlock?.(); this.unlock = undefined }
      this.store.setState({ error: message(error) })
      logger.warn('录音操作失败', { event: `audio_capture.session.${action}.failed`, error })
      throw error
    }).finally(() => { this.operation = undefined; this.store.setState({ busy: false }) })
    return this.operation
  }
  open(): Promise<void> {
    if (!this.store.getState().outputPath && !this.active) {
      this.durationSeconds = 0
      this.store.setState({ status: null, notice: null })
    }
    this.store.setState({ visible: true })
    this.listen()
    return this.run('open', async () => { this.store.setState({ settings: await this.api.getSettings() }) })
  }
  start(placement?: AudioCapturePlacement): Promise<void> {
    return this.run('start', async () => {
      if (this.store.getState().phase === 'recording') return
      if (this.store.getState().outputPath) throw new Error('请先恢复或回收上一段未完成录音')
      if (placement) this.unlock = this.editor?.lock(placement.projectId, placement.revision)
      this.listen()
      const settings = await this.api.getSettings()
      const file = await this.api.prepareFile(placement)
      this.durationSeconds = 0
      this.preview.reset()
      this.store.setState({ visible: true, placement: placement ?? null, outputPath: file.outputPath, status: null, settings, phase: 'idle', notice: null })
      let status
      try { status = await this.api.start({ outputPath: file.outputPath, streamSamples: true }) } catch (error) { this.unlock?.(); this.unlock = undefined; throw error }
      if (this.store.getState().phase !== 'interrupted') this.store.setState({ phase: 'recording', status, notice: status.notice })
    })
  }
  togglePause(): Promise<void> {
    if (this.store.getState().placement) return this.run('pause', () => this.finishTake(true))
    return this.run('pause', async () => {
      const state = this.store.getState()
      if (!this.active || !state.status) return
      const status = await (state.phase === 'paused' ? this.api.resume(state.status.sessionId) : this.api.pause(state.status.sessionId))
      this.durationSeconds = status.durationSeconds
      this.store.setState({ status, phase: status.state })
    })
  }
  private async stopCapture(): Promise<void> {
    const state = this.store.getState()
    if (this.active && state.status && state.status.state !== 'stopped') {
      const status = await this.api.stop(state.status.sessionId)
      this.durationSeconds = status.durationSeconds
      this.store.setState({ status, phase: 'stopped' })
    }
  }
  private async finishTake(paused: boolean): Promise<void> {
    try {
      await this.stopCapture()
      const state = this.store.getState()
      if (state.outputPath && state.placement) {
        this.unlock ??= this.editor?.lock(state.placement.projectId)
        await this.editor?.commit(state.outputPath, state.placement)
        await this.api.completeFile(state.outputPath)
      }
      this.store.setState({ outputPath: null, phase: paused ? 'paused' : 'idle', visible: paused, ...(paused ? {} : { placement: null }) })
    } finally { this.unlock?.(); this.unlock = undefined }
  }
  private async importFile(outputPath: string): Promise<void> {
    // 导入已成功而清除恢复记录失败时，重试只重试收尾，不重复建草稿。
    if (!this.imported.has(outputPath)) { await this.importMedia(outputPath); this.imported.add(outputPath) }
    await this.api.completeFile(outputPath)
    this.store.setState({ placement: null, visible: false, outputPath: null, phase: 'idle' })
    this.release?.(); this.release = undefined
  }
  stop(): Promise<void> {
    if (this.store.getState().placement) return this.run('stop', () => this.finishTake(false))
    return this.run('stop', async () => { await this.stopCapture(); const path = this.store.getState().outputPath; if (path) await this.importFile(path) })
  }
  recoverTake(): Promise<void> {
    return this.run('recover_take', async () => {
      const path = this.store.getState().outputPath
      if (!path) return
      await this.api.recover(path)
      await this.finishTake(false)
    })
  }
  restore(file: AudioCaptureFile): Promise<void> {
    return this.run('restore', async () => {
      if (this.active || !file.placement || !this.editor) throw new Error('请先结束当前录音，再恢复原位置')
      const unlock = this.editor.lock(file.placement.projectId)
      try {
        await this.api.recover(file.outputPath)
        await this.editor.commit(file.outputPath, file.placement)
        await this.api.completeFile(file.outputPath)
        if (this.store.getState().outputPath === file.outputPath) this.store.setState({ placement: null, phase: 'idle', status: null, outputPath: null })
      } finally { unlock() }
    })
  }
  recover(outputPath = this.store.getState().outputPath): Promise<void> {
    return this.run('recover', async () => {
      if (!outputPath || this.active) throw new Error('请先停止当前录音')
      await this.api.recover(outputPath)
      await this.importFile(outputPath)
    })
  }
  async discard(outputPath = this.store.getState().outputPath): Promise<void> {
    await this.run('discard', async () => {
      await this.stopCapture()
      this.unlock?.(); this.unlock = undefined
      if (outputPath) await this.api.trashFile(outputPath)
      this.durationSeconds = 0
      this.store.setState({ placement: null, phase: 'idle', status: null, outputPath: null })
    })
  }
  /** 返回、工作区切换与窗口关闭共用屏障；确认后只停止并保留，首页仍可恢复。 */
  leave(): Promise<boolean> {
    if (this.leaveRequest) return this.leaveRequest
    this.leaveRequest = (async () => {
      if (this.operation) { try { await this.operation } catch { return false } }
      try { await this.run('leave', async () => {
        const state = this.store.getState()
        if (state.phase === 'interrupted' && state.outputPath) await this.api.recover(state.outputPath)
        if (state.placement) await this.finishTake(false)
        else await this.stopCapture()
      }) } catch { return false }
      this.store.setState({ visible: false })
      this.release?.(); this.release = undefined
      return true
    })().finally(() => { this.leaveRequest = undefined })
    return this.leaveRequest
  }
}
