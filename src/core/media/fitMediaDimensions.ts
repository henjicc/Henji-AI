import { findMediaDimensionViolation, type MediaDimensions } from '@henjicc/ai-sdk'

export interface MediaDimensionConstraints {
  minShortSidePx?: number
  maxLongSidePx?: number
  minPixels?: number
  maxPixels?: number
  minAspectRatio?: number
  maxAspectRatio?: number
}

/**
 * 素材尺寸不合模型要求时，算出只靠等比缩放就能满足的目标尺寸；比例不对等缩放解决不了的返回 null。
 * 已经合格的原样返回。视频编码要求宽高为偶数（even），取整后仍不满足约束的也返回 null。
 * 提交前检查与主进程缩放共用这一份判断，界面放行的素材主进程一定能处理。
 */
export function fitMediaDimensions(constraints: MediaDimensionConstraints | undefined, size: MediaDimensions, options: { even?: boolean } = {}): MediaDimensions | null {
  if (!findMediaDimensionViolation(constraints, size)) return size
  const { width, height } = size
  const aspect = width / height
  if (constraints?.minAspectRatio !== undefined && aspect < constraints.minAspectRatio - 1e-6) return null
  if (constraints?.maxAspectRatio !== undefined && aspect > constraints.maxAspectRatio + 1e-6) return null
  const long = Math.max(width, height)
  const short = Math.min(width, height)
  const area = width * height
  const upper = Math.min(
    constraints?.maxLongSidePx !== undefined ? constraints.maxLongSidePx / long : Infinity,
    constraints?.maxPixels !== undefined ? Math.sqrt(constraints.maxPixels / area) : Infinity,
  )
  const lower = Math.max(
    constraints?.minShortSidePx !== undefined ? constraints.minShortSidePx / short : 0,
    constraints?.minPixels !== undefined ? Math.sqrt(constraints.minPixels / area) : 0,
  )
  if (lower > upper) return null
  const scale = Math.min(upper, Math.max(lower, 1))
  // 缩小时向下取整保证不超上限，放大时向上取整保证不低于下限
  const round = (value: number): number => {
    const step = options.even ? 2 : 1
    return Math.max(step, (scale < 1 ? Math.floor(value / step) : Math.ceil(value / step)) * step)
  }
  const target = { width: round(width * scale), height: round(height * scale) }
  return findMediaDimensionViolation(constraints, target) ? null : target
}
