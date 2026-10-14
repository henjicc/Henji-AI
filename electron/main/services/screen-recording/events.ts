import { randomUUID } from 'node:crypto'
import { screen } from 'electron'
import { EventType } from 'uiohook-napi'
import { CaptureLogCollector } from '../../../../src/core/captureLog/collector'
import { captureBounds, capturePoint, type CaptureGeometry, type CaptureRect } from '../../../../src/core/captureLog/coordinates'
import type { CapabilityCapture } from '../../../../src/core/captureLog/events'
import type { CaptureLogPage } from '../../../../src/core/captureLog/events'
import type { ApplicationRef } from '../../../../src/core/application-control/identifiers'
import { createMainLogger } from '../logging'
import { RecordingEventStore } from './event-store'
import { startDesktopInput } from './input-events'
import { createWindowsEventFacts, type DesktopNativeFacts } from './windows-events'
import type { RecordingControlBackend } from './control'

const logger = createMainLogger('main.screen_recording.events')
export interface RecordingEventOptions {
  ownerRef: ApplicationRef
  sourceDigest: string
  directory: string
  /** Same origin and monotonic clock used by the media tracks. Never use Date.now(). */
  originUs: number
  nowUs(): number
  geometry(): CaptureGeometry
  /** Excluded windows and recorder-owned surfaces must also be excluded from event capture. */
  excludedWindowIds?: readonly string[]
  excludedRegions?(): readonly CaptureRect[]
  onFailure(error: unknown): void
  onPage?(page: CaptureLogPage, path: string): Promise<void>
}

/** Event capture follows the actual backend barriers, not UI timers or countdown states. */
export class RecordingEventSession {
  private readonly collector: CaptureLogCollector
  private disposeInput?: () => void
  private timer?: ReturnType<typeof setTimeout>
  private facts?: DesktopNativeFacts
  private previousWindow = ''
  private accepting = false
  private failure: unknown
  constructor(private readonly options: RecordingEventOptions) {
    const store = new RecordingEventStore(options.directory)
    this.collector = new CaptureLogCollector({ ...options, id: randomUUID }, async page => { const path = await store.write(page); await options.onPage?.(page, path) }, error => this.fail(error))
  }
  private fail(error: unknown): void {
    if (this.failure) return
    this.failure = error
    try { this.detach() } catch (cleanup) { logger.error('录制输入释放失败', { event: 'recording.events.cleanup.failed', error: cleanup }) }
    logger.error('录制事件采集失败', { event: 'recording.events.capture.failed', error })
    this.options.onFailure(error)
  }
  private dipPoint(point: { x: number; y: number }): { x: number; y: number } { return process.platform === 'win32' ? screen.screenToDipPoint(point) : point }
  private dipBounds(rect: CaptureRect): CaptureRect {
    const start = this.dipPoint(rect)
    const end = this.dipPoint({ x: rect.x + rect.width, y: rect.y + rect.height })
    return { ...start, width: end.x - start.x, height: end.y - start.y }
  }
  private excluded(): boolean {
    const foreground = this.facts?.foreground()
    return Boolean(foreground?.windowId && this.options.excludedWindowIds?.includes(foreground.windowId))
  }
  private excludedPoint(point: { x: number; y: number }): boolean {
    return this.options.excludedRegions?.().some(rect => point.x >= rect.x && point.y >= rect.y && point.x < rect.x + rect.width && point.y < rect.y + rect.height) ?? false
  }
  private attach(): void {
    if (this.failure) throw this.failure
    this.facts ??= createWindowsEventFacts()
    this.accepting = true; this.previousWindow = ''
    try {
      this.disposeInput = startDesktopInput(payload => {
        if (!this.accepting) return
        try {
          if (this.excluded()) return
          const at = this.options.nowUs()
          if (payload.kind !== 'mouse') { this.collector.record(at, payload); return }
          const event = payload.event
          const desktopPoint = this.dipPoint(event)
          if (this.excludedPoint(desktopPoint)) return
          const point = capturePoint(desktopPoint, this.options.geometry())
          if (!point) return
          if (event.type === EventType.EVENT_MOUSE_WHEEL) this.collector.record(at, { kind: 'scroll', point, axis: event.direction === 4 ? 'horizontal' : 'vertical', amount: event.rotation * event.amount })
          else this.collector.record(at, { kind: 'click', point, phase: event.type === EventType.EVENT_MOUSE_PRESSED ? 'down' : 'up', button: event.button === 1 ? 'left' : event.button === 2 ? 'right' : event.button === 3 ? 'middle' : 'other' })
        } catch (error) { this.fail(error) }
      })
      let due = this.options.nowUs()
      const poll = (): void => {
        if (!this.accepting) return
        try {
          const at = this.options.nowUs(); const geometry = this.options.geometry()
          const foreground = this.facts!.foreground()
          const desktopPoint = screen.getCursorScreenPoint()
          const excluded = foreground.windowId !== null && this.options.excludedWindowIds?.includes(foreground.windowId)
          const cursorExcluded = excluded || this.excludedPoint(desktopPoint)
          this.collector.record(at, { kind: 'cursor', point: cursorExcluded ? null : capturePoint(desktopPoint, geometry), shape: cursorExcluded ? 'hidden' : this.facts!.cursor() })
          const fact = excluded ? { windowId: null, bounds: null, available: false } : { ...foreground, bounds: foreground.bounds ? captureBounds(this.dipBounds(foreground.bounds), geometry) : null }
          const key = JSON.stringify(fact)
          if (key !== this.previousWindow) { this.collector.record(at, { kind: 'window', ...fact }); this.previousWindow = key }
          due = Math.max(due + 1_000_000 / 120, at + 1)
          if (this.accepting) { this.timer = setTimeout(poll, Math.max(1, (due - this.options.nowUs()) / 1000)); this.timer.unref?.() }
        } catch (error) { this.fail(error) }
      }
      poll()
    } catch (error) { this.detach(); throw error }
  }
  private detach(): void {
    this.accepting = false; clearTimeout(this.timer); this.timer = undefined
    const dispose = this.disposeInput; this.disposeInput = undefined; dispose?.()
  }
  capability(fact: CapabilityCapture): void {
    if (!this.accepting) return
    try { this.collector.record(this.options.nowUs(), { kind: 'capability', ...fact }) } catch (error) { this.fail(error) }
  }
  sensitive(regions: Array<{ id: string; bounds: CaptureRect }>): void {
    if (!this.accepting || this.excluded()) return
    try {
      const geometry = this.options.geometry()
      const found = regions.flatMap(region => {
        if (this.excludedPoint(region.bounds)) return []
        const box = captureBounds(region.bounds, geometry)
        return box ? [{ id: region.id, box: [box.x / geometry.pixels.width, box.y / geometry.pixels.height, box.width / geometry.pixels.width, box.height / geometry.pixels.height] as [number, number, number, number] }] : []
      })
      this.collector.record(this.options.nowUs(), { kind: 'sensitive', regions: found })
    } catch (error) { this.fail(error) }
  }
  mark(note?: string): void {
    if (!this.accepting) return
    this.collector.record(this.options.nowUs(), { kind: 'mark', ...(note === undefined ? {} : { note }) })
  }
  wrap(backend: RecordingControlBackend): RecordingControlBackend {
    const releaseOnFailure = async (error: unknown): Promise<never> => {
      try { this.detach() } catch (cleanup) { logger.error('录制输入释放失败', { event: 'recording.events.cleanup.failed', error: cleanup }) }
      try { await backend.cancel() } catch (cleanup) { logger.error('录制媒体释放失败', { event: 'recording.events.cancel.failed', error: cleanup }) }
      throw error
    }
    return {
      start: async signal => {
        logger.info('开始采集录制事件', { event: 'recording.events.start.start' })
        try {
          await backend.start(signal)
          if (signal.aborted) throw new Error('录制已取消')
          this.collector.start(this.options.nowUs()); this.attach()
          logger.info('录制事件采集已开始', { event: 'recording.events.start.completed' })
        } catch (error) { logger.error('录制事件启动失败', { event: 'recording.events.start.failed', error }); return releaseOnFailure(error) }
      },
      pause: async signal => {
        try { this.detach(); this.collector.pause(this.options.nowUs()); await backend.pause(signal); await this.collector.flush() }
        catch (error) { return releaseOnFailure(error) }
      },
      resume: async signal => {
        if (this.failure) throw this.failure
        try { await backend.resume(signal); if (signal.aborted) throw new Error('录制已取消'); this.collector.resume(this.options.nowUs()); this.attach() }
        catch (error) { return releaseOnFailure(error) }
      },
      // Events keep flowing through the countdown; consumers cut everything before the recorded start.
      ...(backend.began ? { began: () => backend.began!() } : {}),
      ...(backend.ending ? { ending: () => backend.ending!() } : {}),
      ...(backend.pausing ? { pausing: () => backend.pausing!() } : {}),
      ...(backend.resumed ? { resumed: () => backend.resumed!() } : {}),
      mark: async (signal, note) => {
        try { await backend.mark(signal, note); this.mark(note) }
        catch (error) { return releaseOnFailure(error) }
      },
      stop: async signal => {
        logger.info('停止采集录制事件', { event: 'recording.events.stop.start' })
        // Detach is synchronous; failure in input cleanup must not skip media or page barriers.
        let inputFailure: unknown
        try { this.detach() } catch (error) { inputFailure = error }
        const results = await Promise.allSettled([this.collector.stop(this.options.nowUs()), backend.stop(signal)])
        const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
        if (failed || this.failure || inputFailure) { const error = failed?.reason ?? this.failure ?? inputFailure; logger.error('录制事件收尾失败', { event: 'recording.events.stop.failed', error }); return releaseOnFailure(error) }
        logger.info('录制事件已保存', { event: 'recording.events.stop.completed' })
      },
      cancel: async () => {
        let inputFailure: unknown
        try { this.detach() } catch (error) { inputFailure = error }
        const results = await Promise.allSettled([this.collector.stop(this.options.nowUs()), backend.cancel()])
        const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
        if (failed || inputFailure) throw failed?.reason ?? inputFailure
      },
    }
  }
}
