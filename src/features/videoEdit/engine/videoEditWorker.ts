import { VideoEditRenderer } from './videoEditRenderer'
import type { VideoEditDocument } from '@/core/videoEdit/document'
import type { VideoEditPreviewSource } from '@/core/videoEdit/preview'

export type RenderRequest = { id: number } & (
  { kind: 'init'; document: VideoEditDocument; previewWidth?: number; surface?: OffscreenCanvas } | { kind: 'update'; document: VideoEditDocument }
  | { kind: 'preview'; sources: VideoEditPreviewSource[] }
  | { kind: 'invalidate'; revision: number }
  | { kind: 'dispose' }
  | { kind: 'render'; frame: number; sequential: boolean; scrubbing?: boolean; deadline?: number }
  | { kind: 'audio'; start: number; duration: number })
export type RenderResponse = { id: number; phase?: 'submitted'; error?: string; bitmap?: ImageBitmap; sourceTimestamps?: number[]; channels?: Float32Array[]; cacheHits?: number; cacheBytes?: number; presented?: boolean; decodeMs?: number; gpuMs?: number }
let renderer: VideoEditRenderer | undefined
let direct = false
let revision = 0
let queue = Promise.resolve()
self.onmessage = (event: MessageEvent<RenderRequest>) => {
  const request = event.data
  if (request.kind === 'invalidate') { if (revision !== request.revision) { revision = request.revision; renderer?.cancelPresentation() } return }
  if (request.kind === 'dispose') { revision = Number.MAX_SAFE_INTEGER; renderer?.cancelPresentation() }
  if (request.kind === 'init') revision = request.document.revision
  if (request.kind === 'update') revision = Math.max(revision, request.document.revision)
  queue = queue.then(async () => {
    try {
      if (request.kind === 'dispose') {
        await renderer?.dispose(); renderer = undefined; self.postMessage({ id: request.id } satisfies RenderResponse)
      } else if (request.kind === 'init') {
        await renderer?.dispose(); renderer = new VideoEditRenderer(request.document, request.previewWidth, request.surface); direct = !!request.surface
        self.postMessage({ id: request.id } satisfies RenderResponse)
      } else if (request.kind === 'preview') {
        if (!renderer) throw new Error('剪辑渲染器尚未就绪。')
        await renderer.setPreviewSources(request.sources); self.postMessage({ id: request.id } satisfies RenderResponse)
      } else if (request.kind === 'update') {
        if (!renderer) throw new Error('剪辑渲染器尚未就绪。')
        await renderer.updateDocument(request.document); self.postMessage({ id: request.id } satisfies RenderResponse)
      } else if (request.kind === 'render') {
        if (!renderer) throw new Error('剪辑渲染器尚未就绪。')
        const result = await renderer.render(request.frame, request.sequential, request.scrubbing, () => renderer?.document.revision === revision, request.deadline)
        const finish = async (): Promise<void> => {
          const start = performance.now()
          await result.completion
          const bitmap = direct || !result.presented ? undefined : result.canvas.transferToImageBitmap()
          self.postMessage({ id: request.id, bitmap, sourceTimestamps: result.sourceTimestamps, cacheHits: result.cacheHits, cacheBytes: result.cacheBytes, presented: result.presented, decodeMs: result.decodeMs, gpuMs: result.gpuMs + performance.now() - start } satisfies RenderResponse, { transfer: bitmap ? [bitmap] : [] })
        }
        if (direct && request.scrubbing) {
          self.postMessage({ id: request.id, phase: 'submitted' } satisfies RenderResponse)
          void finish().catch(error => self.postMessage({ id: request.id, error: String(error) } satisfies RenderResponse))
        } else await finish()
      } else {
        if (!renderer) throw new Error('剪辑渲染器尚未就绪。')
        const channels = await renderer.mixAudio(request.start, request.duration)
        self.postMessage({ id: request.id, channels } satisfies RenderResponse, { transfer: channels.map(channel => channel.buffer as ArrayBuffer) })
      }
    } catch (error) { self.postMessage({ id: request.id, error: error instanceof Error ? error.message : String(error) } satisfies RenderResponse) }
  })
}
