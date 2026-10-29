import { getDocumentHoverFrames, writeDocumentHoverFrame } from '@/commands/documents'
import { createLogger } from '@/core/logging'
import { videoEditComposition, videoEditDuration, type VideoEditComposition, type VideoEditDocument } from '@/core/videoEdit/document'
import { invalidateDocumentHoverRead } from '@/features/documents'
import { listVideoEditInstances, subscribeVideoEdit, subscribeVideoEditView, videoEditGestureActive, type VideoEditInstance } from './videoEditService'
import { videoEditHoverContentKey, videoEditHoverPositions, VIDEO_EDIT_HOVER_LEVELS } from './videoEditHoverPreview'

const logger = createLogger('features.videoEdit.hoverFrames')
interface HoverFrameHost {
  captureHoverFrame(document: VideoEditComposition, frame: number, allowRender: boolean, signal: AbortSignal): Promise<Uint8Array | undefined>
}

/** 一次只做一张；取消后读回和写入都不能推进旧内容的进度。 */
export class VideoEditHoverFrameBuilder {
  private document?: VideoEditDocument
  private key?: string
  private positions = new Set<number>()
  private controller?: AbortController
  private working = false
  private failed = false
  private nextAt = 0
  private level = 0
  private run = false

  constructor(private readonly host: HoverFrameHost) {}

  interrupt(): void { this.controller?.abort() }
  invalidate(): void {
    this.interrupt(); this.document = undefined; this.key = undefined; this.positions.clear(); this.failed = false; this.level = 0; this.run = false
  }

  async step(document: VideoEditDocument, idleMs: number, now: number): Promise<void> {
    if (idleMs < 3000) { this.interrupt(); return }
    if (this.working || this.failed || now < this.nextAt || !document.sequences[0]) return
    this.working = true
    const controller = new AbortController(); this.controller = controller
    const current = (): boolean => this.controller === controller && !controller.signal.aborted
    try {
      if (this.document !== document) {
        const key = await videoEditHoverContentKey(document)
        if (!current()) return
        if (this.key !== key) {
          const stored = await getDocumentHoverFrames(document.id)
          if (!current()) return
          await writeDocumentHoverFrame({ docId: document.id, contentKey: key })
          if (!current()) return
          this.positions = new Set(stored?.contentKey === key ? stored.frames.map(item => item.position) : [])
          this.key = key; this.level = 0; this.run = false
        }
        this.document = document
      }
      const composition = videoEditComposition(document, document.sequences[0].id)
      const duration = videoEditDuration(composition)
      if (!duration) return
      const samples = videoEditHoverPositions(duration)
      while (this.level < VIDEO_EDIT_HOVER_LEVELS.length && samples.slice(0, VIDEO_EDIT_HOVER_LEVELS[this.level]).every(item => this.positions.has(item.position))) this.level++
      if (this.level === VIDEO_EDIT_HOVER_LEVELS.length) return
      const pending = samples.slice(0, VIDEO_EDIT_HOVER_LEVELS[this.level]).filter(item => !this.positions.has(item.position))
      // 同一档轮流看缺口，让已经常驻的其他位置先落盘，缺帧留到完全空闲。
      const target = pending[Math.floor(now / 1000) % pending.length]
      if (!this.run) {
        this.run = true
        logger.info('开始生成项目合成预览', { event: 'video_edit.hover_frames.start', context: { docId: document.id, existing: this.positions.size } })
      }
      const cached = await this.host.captureHoverFrame(composition, target.frame, false, controller.signal)
      const bytes = cached ?? (idleMs >= 10_000 && current() ? await this.host.captureHoverFrame(composition, target.frame, true, controller.signal) : undefined)
      if (!bytes || !current()) return
      await writeDocumentHoverFrame({ docId: document.id, contentKey: this.key!, frame: { position: target.position, bytes } })
      if (!current()) return
      this.positions.add(target.position)
      this.nextAt = now + 2000
      if (samples.slice(0, VIDEO_EDIT_HOVER_LEVELS[this.level]).every(item => this.positions.has(item.position))) {
        this.nextAt = now + 10_000
        if (this.positions.size === samples.length) logger.info('项目合成预览已完成', { event: 'video_edit.hover_frames.completed', context: { docId: document.id, frames: this.positions.size } })
      }
    } catch (error) {
      if (current()) {
        this.failed = true
        logger.warn('项目合成预览未完成', { event: 'video_edit.hover_frames.failed', context: { docId: document.id, frames: this.positions.size }, error })
      }
    } finally { if (this.controller === controller) this.controller = undefined; this.working = false }
  }
}

/** 只由已打开的节目宿主持有，所有输入和业务活动都立即让出后台帧。 */
export function startVideoEditHoverFrames(owner: VideoEditInstance, host: HoverFrameHost, ready: () => boolean, targetWindow: Window): () => void {
  const builder = new VideoEditHoverFrameBuilder(host)
  let contentVersion = owner.contentVersion, lastActivity = performance.now(), held = false, stopped = false
  const interrupt = (): void => { lastActivity = performance.now(); builder.interrupt() }
  const pointer = (event: PointerEvent): void => { held = event.buttons !== 0; interrupt() }
  const blur = (): void => { held = false; interrupt() }
  const key = (): void => interrupt()
  for (const event of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'] as const) targetWindow.addEventListener(event, pointer, { passive: true, capture: true })
  for (const event of ['keydown', 'wheel'] as const) targetWindow.addEventListener(event, key, { passive: true, capture: true })
  targetWindow.addEventListener('blur', blur)
  const unsubscribe = subscribeVideoEdit(() => {
    if (owner.contentVersion !== contentVersion) {
      contentVersion = owner.contentVersion; builder.invalidate(); invalidateDocumentHoverRead(owner.document.id)
    }
    interrupt()
  })
  const unsubscribeView = subscribeVideoEditView(interrupt)
  const timer = targetWindow.setInterval(() => {
    const now = performance.now()
    const busy = stopped || targetWindow.document.hidden || held || !ready() || !listVideoEditInstances().includes(owner) || videoEditGestureActive(owner.document.id)
      || listVideoEditInstances().some(instance => instance.playing || instance.scrubbing || instance.busy || instance.motionRecording)
    if (busy) { interrupt(); return }
    void builder.step(owner.document, now - lastActivity, now)
  }, 1000)
  return () => {
    stopped = true; builder.interrupt(); targetWindow.clearInterval(timer); unsubscribe(); unsubscribeView()
    for (const event of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'] as const) targetWindow.removeEventListener(event, pointer, true)
    for (const event of ['keydown', 'wheel'] as const) targetWindow.removeEventListener(event, key, true)
    targetWindow.removeEventListener('blur', blur)
  }
}
