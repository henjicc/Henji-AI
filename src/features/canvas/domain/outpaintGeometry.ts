import type { MarkCropRect } from '@/features/imageMark/domain/types'

export const OUTPAINT_FIELDS = ['expandLeft', 'expandRight', 'expandTop', 'expandBottom'] as const
export type OutpaintMargins = Record<typeof OUTPAINT_FIELDS[number], number>
export interface OutpaintImageSize { width: number; height: number }

/** 平移只分配已有留白；拉边和移动都不能超出 API 与当前显示范围。 */
export function constrainOutpaintRect(rect: MarkCropRect, image: MarkCropRect, maximum: number, moving: boolean, visible = { x: maximum, y: maximum }): MarkCropRect {
  const horizontal = Math.max(0, Math.min(maximum, visible.x))
  const vertical = Math.max(0, Math.min(maximum, visible.y))
  if (!moving) {
    const margins = rectToMargins(rect, image, maximum)
    return marginsToRect({
      expandLeft: Math.min(margins.expandLeft, Math.floor(horizontal)),
      expandRight: Math.min(margins.expandRight, Math.floor(horizontal)),
      expandTop: Math.min(margins.expandTop, Math.floor(vertical)),
      expandBottom: Math.min(margins.expandBottom, Math.floor(vertical)),
    }, image)
  }
  return {
    ...rect,
    x: Math.max(image.x - Math.min(horizontal, rect.width - image.width), Math.min(image.x, image.x + image.width + horizontal - rect.width, rect.x)),
    y: Math.max(image.y - Math.min(vertical, rect.height - image.height), Math.min(image.y, image.y + image.height + vertical - rect.height, rect.y)),
  }
}

/** 显示比例仅由原图、接口上限、容器尺寸和用户滚轮决定，与当前扩图框无关。 */
export function fitOutpaintView(image: OutpaintImageSize, viewport: OutpaintImageSize, maximum: number, zoom = 1) {
  const scale = Math.max(0.001, Math.min(
    Math.max(1, viewport.width - 48) / (image.width + maximum * 2),
    Math.max(1, viewport.height - 64) / (image.height + maximum * 2),
  ) * zoom)
  return { scale, x: (viewport.width - image.width * scale) / 2, y: (viewport.height - 16 - image.height * scale) / 2 }
}

/** 滚轮放大到完整扩图框贴边为止，不改变扩图像素或裁掉已有框。 */
export function zoomOutpaintView(zoom: number, delta: number, image: OutpaintImageSize, margins: OutpaintMargins, viewport: OutpaintImageSize, maximum: number) {
  const base = fitOutpaintView(image, viewport, maximum).scale
  const limit = Math.min(
    Math.max(1, viewport.width - 48) / (image.width + 2 * Math.max(margins.expandLeft, margins.expandRight)) / base,
    Math.max(1, viewport.height - 64) / (image.height + 2 * Math.max(margins.expandTop, margins.expandBottom)) / base,
  )
  return Math.max(0.25, Math.min(limit, zoom * Math.exp(-Math.max(-100, Math.min(100, delta)) * 0.002)))
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
