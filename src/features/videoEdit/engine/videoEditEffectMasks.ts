import { isShapesMask, isSmartRegionMask, rasterizeVideoEditMaskShapes, videoEditShapeMaskSize, transformVideoEditMaskShape, VIDEO_EDIT_TRACKER_MASK_DEFAULTS, type VideoEditEffectMask, type VideoEditMaskShape } from '@/core/videoEdit/effectMasks'
import { videoEditFollowShapeMap } from '@/core/videoEdit/tracking'
import { videoEditTrackerBox, videoEditTrackerMask } from './videoEditTrackResults'
import type { VideoEditSize } from '@/core/videoEdit/clipGeometry'
import { videoEditSmartRegionMask, type VideoEditSmartRegionMask } from './videoEditSmartRegionMasks'

/*
 * 渲染 Worker 里取一个效果在这一帧的作用区域蒙版（智能区域 4.7d、手绘遮罩 4.10）：统一返回片段画面分辨率的 0–255 蒙版，
 * 由合成场景按片段几何画到序列上再混合效果。没有可用结果（智能区域还在分析）时返回 undefined，调用方跳过这个效果。
 */

const MAX_SHAPE_MASKS = 12
const shapeMasks = new Map<string, VideoEditSmartRegionMask>()

/** 手绘遮罩：同一组形状、同一尺寸只栅格化一次（暂停时反复重画同一帧不重复计算）。 */
export function videoEditShapeMask(shapes: readonly VideoEditMaskShape[], picture: VideoEditSize): VideoEditSmartRegionMask {
  const size = videoEditShapeMaskSize(picture.width, picture.height)
  const key = `${size.width}x${size.height}\u0000${JSON.stringify(shapes)}`
  const cached = shapeMasks.get(key)
  if (cached) { shapeMasks.delete(key); shapeMasks.set(key, cached); return cached }
  const mask = { ...size, data: rasterizeVideoEditMaskShapes(shapes, size.width, size.height) }
  shapeMasks.set(key, mask)
  while (shapeMasks.size > MAX_SHAPE_MASKS) shapeMasks.delete(shapeMasks.keys().next().value as string)
  return mask
}

export interface VideoEditEffectMaskContext {
  /** 片段素材的 Worker 可 fetch 地址（智能区域按素材查分析结果）；文字、图形等没有素材时为 undefined。 */
  mediaUrl?: string
  /** 片段画面尺寸（手绘遮罩按它的宽高比栅格化）。 */
  picture: VideoEditSize
  /** 片段在这一帧的素材时间（素材绝对时钟，微秒；静态图片为 0）。 */
  timeUs: number
  trackerKeys?: Readonly<Record<string, string>>
}

export async function videoEditEffectMask(mask: VideoEditEffectMask, context: VideoEditEffectMaskContext): Promise<VideoEditSmartRegionMask | undefined> {
  if (mask.regionId === 'tracker') {
    const key = context.trackerKeys?.[mask.trackerId]
    return key ? videoEditTrackerMask(key, { ...VIDEO_EDIT_TRACKER_MASK_DEFAULTS, ...mask, invert: Boolean(mask.invert) }, context.timeUs) : undefined
  }
  if (isShapesMask(mask)) {
    const shapes: VideoEditMaskShape[] = []
    for (const shape of mask.shapes) {
      if (!shape.follow) { shapes.push(shape); continue }
      const key = context.trackerKeys?.[shape.follow.trackerId]
      const box = key ? await videoEditTrackerBox(key, context.timeUs) : undefined
      if (!box) return undefined
      shapes.push(transformVideoEditMaskShape(shape, videoEditFollowShapeMap(shape.follow.reference, box)))
    }
    return videoEditShapeMask(shapes, context.picture)
  }
  if (isSmartRegionMask(mask)) return context.mediaUrl ? videoEditSmartRegionMask(context.mediaUrl, mask, context.timeUs) : undefined
  return undefined
}
