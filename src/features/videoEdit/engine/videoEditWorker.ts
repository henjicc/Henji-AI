import { VideoEditRenderer } from './videoEditRenderer'
import type { VideoEditDocument } from '@/core/videoEdit/document'
import type { VideoEditPreviewSource } from '@/core/videoEdit/preview'

export type RenderRequest = { id: number } & (
  { kind: 'init'; document: VideoEditDocument; previewWidth?: number } | { kind: 'update'; document: VideoEditDocument }
  | { kind: 'preview'; sources: VideoEditPreviewSource[] }
  | { kind: 'render'; frame: number; sequential: boolean; scrubbing?: boolean }
  | { kind: 'audio'; start: number; duration: number })
export type RenderResponse = { id: number; error?: string; bitmap?: ImageBitmap; sourceTimestamps?: number[]; channels?: Float32Array[]; cacheHits?: number; cacheBytes?: number }
let renderer: VideoEditRenderer | undefined
let queue = Promise.resolve()
self.onmessage = (event: MessageEvent<RenderRequest>) => {
  const request = event.data
  queue = queue.then(async () => {
    try {
      if (request.kind === 'init') {
        await renderer?.dispose(); renderer = new VideoEditRenderer(request.document, request.previewWidth)
        self.postMessage({ id: request.id } satisfies RenderResponse)
      } else if (request.kind === 'preview') {
        if (!renderer) throw new Error('剪辑渲染器尚未就绪。')
        await renderer.setPreviewSources(request.sources); self.postMessage({ id: request.id } satisfies RenderResponse)
      } else if (request.kind === 'update') {
        if (!renderer) throw new Error('剪辑渲染器尚未就绪。')
        await renderer.updateDocument(request.document); self.postMessage({ id: request.id } satisfies RenderResponse)
      } else if (request.kind === 'render') {
        if (!renderer) throw new Error('剪辑渲染器尚未就绪。')
        const result = await renderer.render(request.frame, request.sequential, request.scrubbing)
        const bitmap = result.canvas.transferToImageBitmap()
        self.postMessage({ id: request.id, bitmap, sourceTimestamps: result.sourceTimestamps, cacheHits: result.cacheHits, cacheBytes: result.cacheBytes } satisfies RenderResponse, { transfer: [bitmap] })
      } else {
        if (!renderer) throw new Error('剪辑渲染器尚未就绪。')
        const channels = await renderer.mixAudio(request.start, request.duration)
        self.postMessage({ id: request.id, channels } satisfies RenderResponse, { transfer: channels.map(channel => channel.buffer as ArrayBuffer) })
      }
    } catch (error) { self.postMessage({ id: request.id, error: error instanceof Error ? error.message : String(error) } satisfies RenderResponse) }
  })
}
