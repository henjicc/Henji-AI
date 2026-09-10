import type { MarkCropRect } from '@/features/imageMark/domain/types'

export const OUTPAINT_FIELDS = ['expandLeft', 'expandRight', 'expandTop', 'expandBottom'] as const
export type OutpaintMargins = Record<typeof OUTPAINT_FIELDS[number], number>
export interface OutpaintImageSize { width: number; height: number }

export interface OutpaintScene { frame: MarkCropRect; image: MarkCropRect }
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

/** 容器变化只变换同一份构图，不从取整后的请求参数重新创建画面。 */
export function scaleOutpaintScene(scene: OutpaintScene, from: OutpaintImageSize, to: OutpaintImageSize): OutpaintScene {
  const scale = Math.min(to.width / from.width, to.height / from.height)
  const x = (to.width - from.width * scale) / 2
  const y = (to.height - from.height * scale) / 2
  const transform = (rect: MarkCropRect) => ({ x: rect.x * scale + x, y: rect.y * scale + y, width: rect.width * scale, height: rect.height * scale })
  return { frame: transform(scene.frame), image: transform(scene.image) }
}

export function createOutpaintScene(source: OutpaintImageSize, viewport: OutpaintImageSize, margins: OutpaintMargins, maximum: number): OutpaintScene {
  const scale = Math.min(
    Math.max(viewport.width / (source.width + 2 * maximum), viewport.height / (source.height + 2 * maximum)),
    viewport.width / (source.width + margins.expandLeft + margins.expandRight),
    viewport.height / (source.height + margins.expandTop + margins.expandBottom),
  )
  const frameWidth = (source.width + margins.expandLeft + margins.expandRight) * scale
  const frameHeight = (source.height + margins.expandTop + margins.expandBottom) * scale
  const frame = {
    x: clamp((viewport.width - source.width * scale) / 2 - margins.expandLeft * scale, 0, viewport.width - frameWidth),
    y: clamp((viewport.height - source.height * scale) / 2 - margins.expandTop * scale, 0, viewport.height - frameHeight),
    width: frameWidth, height: frameHeight,
  }
  return { frame, image: { x: frame.x + margins.expandLeft * scale, y: frame.y + margins.expandTop * scale, width: source.width * scale, height: source.height * scale } }
}

/** 拉边只改输出框，既包含原图，也不越过工作面和 API 边界。 */
export function resizeOutpaintFrame(rect: MarkCropRect, image: MarkCropRect, source: OutpaintImageSize, viewport: OutpaintImageSize, maximum: number): MarkCropRect {
  const margin = maximum * image.width / source.width
  const x = clamp(rect.x, Math.max(0, image.x - margin), image.x)
  const y = clamp(rect.y, Math.max(0, image.y - margin), image.y)
  const right = clamp(rect.x + rect.width, image.x + image.width, Math.min(viewport.width, image.x + image.width + margin))
  const bottom = clamp(rect.y + rect.height, image.y + image.height, Math.min(viewport.height, image.y + image.height + margin))
  return { x, y, width: right - x, height: bottom - y }
}

/** 图片在固定框内移动；保留完整原图，四边留白不超过接口上限。 */
export function moveOutpaintImage(image: MarkCropRect, frame: MarkCropRect, source: OutpaintImageSize, maximum: number): MarkCropRect {
  const margin = maximum * image.width / source.width
  return { ...image,
    x: clamp(image.x, Math.max(frame.x, frame.x + frame.width - image.width - margin), Math.min(frame.x + frame.width - image.width, frame.x + margin)),
    y: clamp(image.y, Math.max(frame.y, frame.y + frame.height - image.height - margin), Math.min(frame.y + frame.height - image.height, frame.y + margin)),
  }
}

/** 双侧留白达到上限时，以最小等比放大释放平移空间，输出框保持不动。 */
export function translateOutpaintImage(image: MarkCropRect, frame: MarkCropRect, source: OutpaintImageSize, maximum: number): MarkCropRect {
  const centerX = clamp(image.x + image.width / 2, frame.x + image.width / 2, frame.x + frame.width - image.width / 2)
  const centerY = clamp(image.y + image.height / 2, frame.y + image.height / 2, frame.y + frame.height - image.height / 2)
  const scale = Math.min(
    Math.min(frame.width / source.width, frame.height / source.height),
    Math.max(image.width / source.width,
      (centerX - frame.x) / (source.width / 2 + maximum),
      (frame.x + frame.width - centerX) / (source.width / 2 + maximum),
      (centerY - frame.y) / (source.height / 2 + maximum),
      (frame.y + frame.height - centerY) / (source.height / 2 + maximum)),
  )
  const width = source.width * scale
  const height = source.height * scale
  return moveOutpaintImage({ x: centerX - width / 2, y: centerY - height / 2, width, height }, frame, source, maximum)
}

/** 滚轮只改变图片的等比尺寸，框保持原位；极限由完整原图与 API 留白共同决定。 */
export function zoomOutpaintImage(scene: OutpaintScene, delta: number, source: OutpaintImageSize, maximum: number): MarkCropRect {
  const { image, frame } = scene
  const minimum = Math.max(frame.width / (source.width + 2 * maximum), frame.height / (source.height + 2 * maximum))
  const maximumScale = Math.min(frame.width / source.width, frame.height / source.height)
  const scale = clamp(image.width / source.width * Math.exp(-clamp(delta, -100, 100) * 0.002), minimum, maximumScale)
  const width = source.width * scale
  const height = source.height * scale
  return moveOutpaintImage({ x: image.x + (image.width - width) / 2, y: image.y + (image.height - height) / 2, width, height }, frame, source, maximum)
}

export function outpaintSceneToMargins(scene: OutpaintScene, source: OutpaintImageSize, maximum: number): OutpaintMargins {
  const scale = scene.image.width / source.width
  const normalize = (rect: MarkCropRect) => ({ x: rect.x / scale, y: rect.y / scale, width: rect.width / scale, height: rect.height / scale })
  return rectToMargins(normalize(scene.frame), normalize(scene.image), maximum)
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
