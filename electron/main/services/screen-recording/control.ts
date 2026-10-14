import type { RecordingAction, RecordingControlSnapshot, RecordingShortcuts } from '../../../../src/core/screenRecording/contracts'
import { DEFAULT_RECORDING_SHORTCUTS, recordingActions, recordingShortcutsSchema } from '../../../../src/core/screenRecording/contracts'
import type { RecordingTrackStatus } from '../../../../src/core/screenRecording/contracts'

/** 1.2/1.3 的采集协调器实现此接口。Promise 完成代表实际采集状态已切换。 */
export interface RecordingControlBackend {
  start(signal: AbortSignal): Promise<void>
  pause(signal: AbortSignal): Promise<void>
  resume(signal: AbortSignal): Promise<void>
  mark(signal: AbortSignal, note?: string): Promise<void>
  stop(signal: AbortSignal): Promise<void>
  /** 取消是资源释放屏障；完成后任何旧的异步启动都不得重新开启采集。 */
  cancel(): Promise<void>
}
interface ControlDependencies {
  now(): number
  register(accelerator: string, callback: () => void): boolean
  unregister(accelerator: string): void
  changed(snapshot: RecordingControlSnapshot | null): void
  released(): void
  log(event: string, error?: unknown): void
}
interface ActiveRecording {
  snapshot: RecordingControlSnapshot
  backend: RecordingControlBackend
  elapsed: number
  startedAt: number
  abort: AbortController
}

/** 一个运行实例、一套状态；控制条、快捷键和后续应用能力都委托这里。 */
export class RecordingControlService {
  private active: ActiveRecording | null = null
  private shortcuts: RecordingShortcuts = { ...DEFAULT_RECORDING_SHORTCUTS }
  private readonly registered = new Map<RecordingAction, string>()
  private countdownTimer: ReturnType<typeof setInterval> | undefined
  private ticker: ReturnType<typeof setInterval> | undefined
  private pending: Promise<void> | null = null

  constructor(private readonly deps: ControlDependencies) {}

  create(sessionId: string, backend: RecordingControlBackend): RecordingControlSnapshot {
    if (this.active) throw new Error('已有录制会话，请先停止或关闭当前录制')
    this.active = { backend, elapsed: 0, startedAt: 0, abort: new AbortController(), snapshot: { sessionId, phase: 'ready', countdown: 0, elapsedMs: 0, microphoneLevel: null, busy: false, error: null, shortcutConflicts: [] } }
    this.configureShortcuts(this.shortcuts)
    this.ticker = setInterval(() => this.publish(), 200)
    this.ticker.unref?.()
    this.deps.log('recording.control.created')
    this.publish()
    return this.snapshot()!
  }

  snapshot(): RecordingControlSnapshot | null {
    const active = this.active
    if (!active) return null
    const elapsedMs = active.elapsed + (active.snapshot.phase === 'recording' ? Math.max(0, this.deps.now() - active.startedAt) : 0)
    return { ...active.snapshot, elapsedMs, cameraPreview: active.snapshot.phase === 'recording' ? active.snapshot.cameraPreview : null, shortcutConflicts: [...active.snapshot.shortcutConflicts], trackWarnings: [...active.snapshot.trackWarnings ?? []] }
  }

  configureShortcuts(input: RecordingShortcuts): RecordingAction[] {
    const next = recordingShortcutsSchema.parse(input)
    this.unregisterShortcuts()
    this.shortcuts = next
    const conflicts: RecordingAction[] = []
    if (this.active && !['stopped'].includes(this.active.snapshot.phase)) {
      for (const action of recordingActions) {
        const accelerator = next[action]
        if (!accelerator) continue
        try {
          if (!this.deps.register(accelerator, () => { void this.command(action).catch(error => this.deps.log('recording.control.shortcut.failed', error)) })) conflicts.push(action)
          else this.registered.set(action, accelerator)
        } catch (error) { conflicts.push(action); this.deps.log('recording.control.shortcut.failed', error) }
      }
      this.active.snapshot.shortcutConflicts = conflicts
      if (conflicts.length) this.deps.log('recording.control.shortcut.conflict')
    }
    this.publish()
    return conflicts
  }

  async command(action: RecordingAction, note?: string): Promise<void> {
    if (note !== undefined && (action !== 'mark' || note.length > 4000)) throw new Error('备注只能用于录制标记，且不能超过4000字')
    const active = this.active
    if (!active) throw new Error('没有录制会话，请先准备录制')
    if (this.pending) {
      if (action !== 'stop') throw new Error('录制状态正在切换，请稍后再试')
      await this.pending.catch(() => undefined)
      if (this.active !== active || active.snapshot.phase === 'stopped') return
      return this.command('stop')
    }
    if (action === 'toggle' && active.snapshot.phase === 'ready') {
      active.snapshot.phase = 'countdown'; active.snapshot.countdown = 3
      this.countdownTimer = setInterval(() => {
        if (this.active !== active) return
        active.snapshot.countdown -= 1
        if (active.snapshot.countdown === 0) {
          this.clearCountdown()
          void this.execute('start', active).catch(error => this.deps.log('recording.control.start.failed', error))
        } else this.publish()
      }, 1000)
      this.countdownTimer.unref?.()
      this.publish(); return
    }
    if (action === 'stop' && active.snapshot.phase === 'countdown') this.clearCountdown()
    if (action === 'stop' && active.snapshot.phase === 'stopped') return
    if (action === 'mark' && active.snapshot.phase !== 'recording') throw new Error('标记只能在录制过程中添加')
    if (action === 'toggle' && !['recording', 'paused'].includes(active.snapshot.phase)) throw new Error('当前不能开始或暂停，请停止当前会话后重新准备')
    return this.execute(action === 'toggle' ? active.snapshot.phase === 'paused' ? 'resume' : 'pause' : action, active, note)
  }

  private execute(operation: 'start' | 'pause' | 'resume' | 'mark' | 'stop', active: ActiveRecording, note?: string): Promise<void> {
    const wasRecording = active.snapshot.phase === 'recording'
    active.snapshot.busy = true; active.snapshot.error = null
    if (operation === 'stop') {
      if (wasRecording) active.elapsed += Math.max(0, this.deps.now() - active.startedAt)
      active.snapshot.phase = 'stopping'
    }
    this.deps.log(`recording.control.${operation}.start`)
    this.publish()
    const task = Promise.resolve().then(() => operation === 'mark' ? active.backend.mark(active.abort.signal, note) : active.backend[operation](active.abort.signal)).then(() => {
      if (this.active !== active || active.abort.signal.aborted) return
      if (active.snapshot.phase === 'failed' && operation !== 'stop') return
      if (operation === 'pause') { active.elapsed += Math.max(0, this.deps.now() - active.startedAt); active.snapshot.phase = 'paused'; active.snapshot.microphoneLevel = null }
      if (operation === 'start' || operation === 'resume') { active.startedAt = this.deps.now(); active.snapshot.phase = 'recording' }
      if (operation === 'stop') { active.snapshot.phase = 'stopped'; active.snapshot.microphoneLevel = null; this.releaseResources() }
      this.deps.log(`recording.control.${operation}.completed`)
    }).catch(error => {
      if (this.active === active) {
        if (active.snapshot.phase === 'recording') active.elapsed += Math.max(0, this.deps.now() - active.startedAt)
        active.snapshot.phase = 'failed'
        active.snapshot.error = '录制操作未完成，请停止录制后重新准备。'
        active.snapshot.microphoneLevel = null
      }
      this.deps.log(`recording.control.${operation}.failed`, error)
      throw error
    }).finally(() => {
      if (this.active === active) active.snapshot.busy = false
      if (this.pending === task) this.pending = null
      this.publish()
    })
    this.pending = task
    return task
  }

  setMicrophoneLevel(sessionId: string, level: number | null): void {
    if (!this.active || this.active.snapshot.sessionId !== sessionId) return
    this.active.snapshot.microphoneLevel = this.active.snapshot.phase === 'recording' && level !== null && Number.isFinite(level) ? Math.max(0, Math.min(1, level)) : null
  }

  setTrackStatus(sessionId: string, status: RecordingTrackStatus): void {
    if (!this.active || this.active.snapshot.sessionId !== sessionId || ['stopped', 'failed', 'stopping'].includes(this.active.snapshot.phase)) return
    this.setMicrophoneLevel(sessionId, status.microphoneLevel)
    this.active.snapshot.cameraPreview = this.active.snapshot.phase === 'recording' ? status.cameraPreview : null
    this.active.snapshot.trackWarnings = [...status.warnings]
    this.publish()
  }

  /** Device/process failures arrive outside a control command. Preserve the failed result for readback. */
  fail(sessionId: string, message: string): void {
    const active = this.active
    if (!active || active.snapshot.sessionId !== sessionId) return
    if (active.snapshot.phase === 'recording') active.elapsed += Math.max(0, this.deps.now() - active.startedAt)
    active.snapshot.phase = 'failed'; active.snapshot.error = message; active.snapshot.microphoneLevel = null
    this.releaseResources(); this.publish()
  }

  /** Capture/storage failures terminate native resources immediately, including an in-flight start. */
  async captureFailed(sessionId: string, error: unknown): Promise<void> {
    const active = this.active
    if (!active || active.snapshot.sessionId !== sessionId || active.snapshot.phase === 'stopped') return
    active.abort.abort()
    this.fail(sessionId, '录制操作未完成，请停止录制后重新准备。')
    this.deps.log('recording.control.capture.failed', error)
    await active.backend.cancel()
  }

  /** 失去宿主时立即释放权限/快捷键，并通知后端取消；旧 Promise 不得污染新会话。 */
  async dispose(): Promise<void> {
    const active = this.active
    active?.abort.abort()
    this.active = null; this.pending = null
    this.releaseResources(); this.publish()
    if (active) {
      try { await active.backend.cancel() } catch (error) { this.deps.log('recording.control.cancel.failed', error); throw error }
    }
  }
  private clearCountdown(): void { clearInterval(this.countdownTimer); this.countdownTimer = undefined }
  private unregisterShortcuts(): void { for (const accelerator of this.registered.values()) this.deps.unregister(accelerator); this.registered.clear() }
  private releaseResources(): void {
    this.clearCountdown(); clearInterval(this.ticker); this.ticker = undefined
    this.unregisterShortcuts(); this.deps.released()
  }
  private publish(): void { this.deps.changed(this.snapshot()) }
}
