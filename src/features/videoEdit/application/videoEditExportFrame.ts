import { videoEditExportRenderPlan, type VideoEditExportSettings } from '@/core/videoEdit/exportPresets'
import type { VideoEditComposition } from '@/core/videoEdit/document'
import type { VideoEditRenderSession } from '../engine/videoEditRenderSession'
import type { VideoEditEncodeGeometry } from '../engine/videoEditFrameEncoder'

/**
 * 按导出规格设定合成尺寸，返回合成画面在成片里的位置；同画幅时返回 undefined，合成画面直接编码。
 * 缩放、裁切与留边由渲染 Worker 在编码前完成。
 */
export async function prepareVideoEditExportFrame(renderer: Pick<VideoEditRenderSession, 'setOutputScale'>, document: Pick<VideoEditComposition, 'width' | 'height'>, settings: VideoEditExportSettings): Promise<VideoEditEncodeGeometry | undefined> {
  const plan = videoEditExportRenderPlan(document.width, document.height, settings)
  await renderer.setOutputScale(plan.scale, plan.renderAtOutputResolution)
  return plan.direct ? undefined : { width: settings.width, height: settings.height, source: plan.geometry.source, destination: plan.geometry.destination }
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
