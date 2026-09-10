import type { MarkCropRect } from '@/features/imageMark/domain/types'

export const OUTPAINT_FIELDS = ['expandLeft', 'expandRight', 'expandTop', 'expandBottom'] as const
export type OutpaintMargins = Record<typeof OUTPAINT_FIELDS[number], number>
export interface OutpaintImageSize { width: number; height: number }

export interface OutpaintScene { frame: MarkCropRect; image: MarkCropRect }
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

/** 全部留白集中在任意一边仍合法，因此最小尺寸不随图片位置改变。 */
function minimumMovableScale(source: OutpaintImageSize, viewport: OutpaintImageSize, maximum: number): number {
  return Math.max(viewport.width / (source.width + maximum), viewport.height / (source.height + maximum))
}

/** 容器变化只变换同一份构图，不从取整后的请求参数重新创建画面。 */
export function scaleOutpaintScene(scene: OutpaintScene, from: OutpaintImageSize, to: OutpaintImageSize): OutpaintScene {
  const scale = Math.min(to.width / from.width, to.height / from.height)
  const x = (to.width - from.width * scale) / 2
  const y = (to.height - from.height * scale) / 2
  const transform = (rect: MarkCropRect) => ({ x: rect.x * scale + x, y: rect.y * scale + y, width: rect.width * scale, height: rect.height * scale })
  return { frame: transform(scene.frame), image: transform(scene.image) }
}

export function createOutpaintScene(source: OutpaintImageSize, viewport: OutpaintImageSize, margins: OutpaintMargins, maximum: number): OutpaintScene {
  const fitScale = Math.min(
    viewport.width / (source.width + margins.expandLeft + margins.expandRight),
    viewport.height / (source.height + margins.expandTop + margins.expandBottom),
  )
  // 初始构图保留缩小余地；已有明确留白仍以完整展示其构图为准。
  const scale = Math.min(fitScale, (minimumMovableScale(source, viewport, maximum) + fitScale) / 2)
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

/** 拉框只改变输出范围，不再替用户调整图片尺寸。 */
export function resizeOutpaintScene(rect: MarkCropRect, image: MarkCropRect, source: OutpaintImageSize, viewport: OutpaintImageSize, maximum: number): OutpaintScene {
  return { frame: resizeOutpaintFrame(rect, image, source, viewport, maximum), image }
}

/** 平移只夹住位置；为最大工作面保留合法留白，不自动缩放图片。 */
export function moveOutpaintImage(image: MarkCropRect, frame: MarkCropRect, source: OutpaintImageSize, maximum: number, workspace = frame): MarkCropRect {
  const margin = maximum * image.width / source.width
  return { ...image,
    x: clamp(image.x, Math.max(frame.x, workspace.x + workspace.width - image.width - margin), Math.min(frame.x + frame.width - image.width, workspace.x + margin)),
    y: clamp(image.y, Math.max(frame.y, workspace.y + workspace.height - image.height - margin), Math.min(frame.y + frame.height - image.height, workspace.y + margin)),
  }
}

/** 缩小限制按完整工作面计算，始终保留四边移动空间；滚轮不附带平移或反向放大。 */
export function zoomOutpaintImage(scene: OutpaintScene, delta: number, source: OutpaintImageSize, maximum: number, workspace = scene.frame): MarkCropRect {
  const { image, frame } = scene
  const centerX = image.x + image.width / 2
  const centerY = image.y + image.height / 2
  const minimum = minimumMovableScale(source, workspace, maximum)
  const maximumScale = Math.min(
    2 * Math.min(centerX - frame.x, frame.x + frame.width - centerX) / source.width,
    2 * Math.min(centerY - frame.y, frame.y + frame.height - centerY) / source.height,
  )
  const currentScale = image.width / source.width
  const scale = clamp(currentScale * Math.exp(-clamp(delta, -100, 100) * 0.002), Math.min(currentScale, minimum), Math.max(currentScale, maximumScale))
  const width = source.width * scale
  const height = source.height * scale
  return { x: centerX - width / 2, y: centerY - height / 2, width, height }
}

export function outpaintSceneToMargins(scene: OutpaintScene, source: OutpaintImageSize, maximum: number): OutpaintMargins {
  const scale = scene.image.width / source.width
  const normalize = (rect: MarkCropRect) => ({ x: rect.x / scale, y: rect.y / scale, width: rect.width / scale, height: rect.height / scale })
  return rectToMargins(normalize(scene.frame), normalize(scene.image), maximum)
}
export function resolveOutpaintMargins(
  params: Record<string, unknown>, image: OutpaintImageSize, maximum: number,
): OutpaintMargins {
  // 大图也为缩小留出余地：初始两侧留白之和最多使用单边预算的一半。
  const ratio = Math.min(0.1, maximum / (4 * image.width), maximum / (4 * image.height))
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
