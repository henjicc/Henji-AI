import type { MarkCropRect } from '@/features/imageMark/domain/types'

export const OUTPAINT_FIELDS = ['expandLeft', 'expandRight', 'expandTop', 'expandBottom'] as const
export type OutpaintMargins = Record<typeof OUTPAINT_FIELDS[number], number>
export interface OutpaintImageSize { width: number; height: number }

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
