import { VideoEditRenderer } from './videoEditRenderer'
import type { VideoEditDocument } from '@/core/videoEdit/document'

export type RenderRequest = { id: number } & (
  { kind: 'init'; document: VideoEditDocument } | { kind: 'render'; frame: number; sequential: boolean }
  | { kind: 'audio'; start: number; duration: number })
export type RenderResponse = { id: number; error?: string; bitmap?: ImageBitmap; sourceTimestamps?: number[]; channels?: Float32Array[] }
let renderer: VideoEditRenderer | undefined
let queue = Promise.resolve()
self.onmessage = (event: MessageEvent<RenderRequest>) => {
  const request = event.data
  queue = queue.then(async () => {
    try {
      if (request.kind === 'init') {
        await renderer?.dispose(); renderer = new VideoEditRenderer(request.document)
        self.postMessage({ id: request.id } satisfies RenderResponse)
      } else if (request.kind === 'render') {
        if (!renderer) throw new Error('剪辑渲染器尚未就绪。')
        const result = await renderer.render(request.frame, request.sequential)
        const bitmap = result.canvas.transferToImageBitmap()
        self.postMessage({ id: request.id, bitmap, sourceTimestamps: result.sourceTimestamps } satisfies RenderResponse, { transfer: [bitmap] })
      } else {
        if (!renderer) throw new Error('剪辑渲染器尚未就绪。')
        const channels = await renderer.mixAudio(request.start, request.duration)
        self.postMessage({ id: request.id, channels } satisfies RenderResponse, { transfer: channels.map(channel => channel.buffer as ArrayBuffer) })
      }
    } catch (error) { self.postMessage({ id: request.id, error: error instanceof Error ? error.message : String(error) } satisfies RenderResponse) }
  })
}
