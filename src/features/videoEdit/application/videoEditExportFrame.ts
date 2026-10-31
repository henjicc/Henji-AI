import { BLACK_HEX } from '@/core/theme/colorTokens'
import { videoEditExportRenderPlan, type VideoEditExportSettings } from '@/core/videoEdit/exportPresets'
import type { VideoEditComposition } from '@/core/videoEdit/document'
import type { VideoEditRenderSession } from '../engine/videoEditRenderSession'

/** 成片与单帧对比共用同一输出路径；同画幅直接编码渲染画布。 */
export async function prepareVideoEditExportFrame(renderer: Pick<VideoEditRenderSession, 'canvas' | 'setOutputScale'>, document: Pick<VideoEditComposition, 'width' | 'height'>, settings: VideoEditExportSettings): Promise<{ canvas: OffscreenCanvas; copy: () => void }> {
  const plan = videoEditExportRenderPlan(document.width, document.height, settings)
  await renderer.setOutputScale(plan.scale, plan.renderAtOutputResolution)
  if (plan.direct) return { canvas: renderer.canvas, copy: () => {} }
  const canvas = new OffscreenCanvas(settings.width, settings.height)
  const ctx = canvas.getContext('2d')!
  return { canvas, copy: () => {
    ctx.fillStyle = BLACK_HEX; ctx.fillRect(0, 0, canvas.width, canvas.height)
    const s = plan.geometry.source, d = plan.geometry.destination
    ctx.drawImage(renderer.canvas, s.x, s.y, s.width, s.height, d.x, d.y, d.width, d.height)
  } }
}

/** 以墙钟时间约束通知与让出频率，快帧不会累积固定的逐帧调度开销。 */
export function videoEditExportProgress(publish: () => void, yieldThread = () => new Promise<void>(resolve => setTimeout(resolve, 0)), now = () => performance.now()): () => Promise<void> {
  let publishedAt = now()
  return async () => {
    if (now() - publishedAt < 250) return
    publish()
    await yieldThread()
    publishedAt = now()
  }
}
