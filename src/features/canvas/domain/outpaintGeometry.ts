import type { MarkCropRect } from '@/features/imageMark/domain/types'

export const OUTPAINT_FIELDS = ['expandLeft', 'expandRight', 'expandTop', 'expandBottom'] as const
export type OutpaintMargins = Record<typeof OUTPAINT_FIELDS[number], number>
export interface OutpaintImageSize { width: number; height: number }

/** 平移保持输出尺寸，只分配已有留白；撞到原图或单边上限即停止。 */
export function constrainOutpaintRect(rect: MarkCropRect, image: MarkCropRect, maximum: number, moving: boolean): MarkCropRect {
  if (!moving) return marginsToRect(rectToMargins(rect, image, maximum), image)
  return {
    ...rect,
    x: Math.max(image.x - Math.min(maximum, rect.width - image.width), Math.min(image.x, image.x + image.width + maximum - rect.width, rect.x)),
    y: Math.max(image.y - Math.min(maximum, rect.height - image.height), Math.min(image.y, image.y + image.height + maximum - rect.height, rect.y)),
  }
}

export interface OutpaintView { scale: number; x: number; y: number }

/** 只适配节点内部：按输出尺寸缩放，位置仅在超出安全边缘时调整。 */
export function fitOutpaintView(rect: MarkCropRect, image: OutpaintImageSize, viewport: OutpaintImageSize, previous?: OutpaintView): OutpaintView {
  const width = Math.max(1, viewport.width - 48)
  const height = Math.max(1, viewport.height - 64)
  const scale = Math.max(0.001, Math.min(width / Math.max(image.width * 1.5, rect.width), height / Math.max(image.height * 1.5, rect.height)))
  const x = previous ? viewport.width / 2 + (previous.x - viewport.width / 2) * scale / previous.scale : (viewport.width - image.width * scale) / 2
  const y = previous ? viewport.height / 2 + (previous.y - viewport.height / 2) * scale / previous.scale : (viewport.height - image.height * scale) / 2
  return {
    scale,
    x: Math.max(24 - rect.x * scale, Math.min(viewport.width - 24 - (rect.x + rect.width) * scale, x)),
    y: Math.max(24 - rect.y * scale, Math.min(viewport.height - 40 - (rect.y + rect.height) * scale, y)),
  }
}

export function resolveOutpaintMargins(
  params: Record<string, unknown>, image: OutpaintImageSize, maximum: number,
): OutpaintMargins {
  const ratio = Math.min(0.1, maximum / image.width, maximum / image.height)
  const defaults = [image.width * ratio, image.width * ratio, image.height * ratio, image.height * ratio]
  return Object.fromEntries(OUTPAINT_FIELDS.map((key, index) => [key,
    Math.round(Math.max(0, Math.min(maximum,
      typeof params[key] === 'number' && Number.isFinite(params[key]) ? params[key] : defaults[index]))),
  ])) as OutpaintMargins
}

export function marginsToRect(margins: OutpaintMargins, image: MarkCropRect): MarkCropRect {
  return {
    x: image.x - margins.expandLeft, y: image.y - margins.expandTop,
    width: image.width + margins.expandLeft + margins.expandRight,
    height: image.height + margins.expandTop + margins.expandBottom,
  }
}

/** 四边独立限幅，始终包含完整原图，不改变图片的宽高比。 */
export function rectToMargins(rect: MarkCropRect, image: MarkCropRect, maximum: number): OutpaintMargins {
  const clamp = (value: number) => Math.round(Math.max(0, Math.min(maximum, value)))
  return {
    expandLeft: clamp(image.x - rect.x),
    expandRight: clamp(rect.x + rect.width - image.x - image.width),
    expandTop: clamp(image.y - rect.y),
    expandBottom: clamp(rect.y + rect.height - image.y - image.height),
  }
}

export function resolveOutpaintRequestParams(params: Record<string, unknown>, image: OutpaintImageSize, maximum: number) {
  return { ...resolveOutpaintMargins(params, image, maximum), zoomOutPercentage: 0 }
}
