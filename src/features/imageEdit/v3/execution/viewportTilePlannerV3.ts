import {
  IMAGE_EDIT_STORAGE_TILE_SIZE,
  createTileRegion,
  enumerateTilesForRect,
  mipSize,
  type ImageEditRect,
  type ImageEditSize,
} from '@/core/imageEdit/v3/tileGeometry'
import type {
  ImageEditorV3PyramidDescriptor,
  ImageEditorV3ResourceRef,
} from '@/platform/contracts/imageEditorV3'

const PREVIOUS_MIP_MIN_PHYSICAL_PIXELS_V3 = 0.7
const PREVIOUS_MIP_MAX_PHYSICAL_PIXELS_V3 = 1.6

export interface ImageEditorViewportTransformV3 {
  /** 视口左上角对应的文档像素坐标。 */
  documentX: number
  documentY: number
  /** CSS 像素尺寸。 */
  width: number
  height: number
  /** 每个文档像素对应的 CSS 像素数，1 表示 100%。 */
  zoom: number
  devicePixelRatio: number
  /** 文档像素/秒；仅用于运动方向预取，不参与相机变换。 */
  velocityX?: number
  velocityY?: number
  interacting?: boolean
}

export interface ImageEditorViewportTileRequestV3 {
  key: string
  resourceRef: ImageEditorV3ResourceRef
  mip: number
  tileX: number
  tileY: number
  /** 当前 mip 像素坐标中的 halo。 */
  halo: number
  bitDepth: 8 | 16 | 32
  /** 主进程必须返回的精确来源区域，缓存命中也按这些字段复核。 */
  width: number
  height: number
  originX: number
  originY: number
  estimatedBytes: number
}

export interface ImageEditorViewportTileCandidateV3 {
  mip: number
  tiles: readonly ImageEditorViewportTileRequestV3[]
  estimatedBytes: number
}

export interface ImageEditorViewportTilePlanV3 extends ImageEditorViewportTileCandidateV3 {
  idealMip: number
  degradedForBudget: boolean
  visibleDocumentRect: ImageEditRect
  visibleMipRect: ImageEditRect
  demandDocumentRect: ImageEditRect
  demandMipRect: ImageEditRect
  mipSize: ImageEditSize
  physicalPixelsPerMipPixel: number
}

export interface ImageEditorViewportTilePlanOptionsV3 {
  resourceRef: ImageEditorV3ResourceRef
  /** 输出几何；裁剪和方向只改变这里。 */
  documentSize: ImageEditSize
  /** 源金字塔几何；省略时与输出几何相同。 */
  sourceSize?: ImageEditSize
  pyramid: ImageEditorV3PyramidDescriptor
  viewport: ImageEditorViewportTransformV3
  bitDepth: 8 | 16 | 32
  /** 文档像素坐标中的最终 halo；规划器会按 mip 缩放。 */
  haloDocumentPixels?: number
  /** 静止时四周预取的视口倍数。生产显示默认由调度器传入 0.5。 */
  overscanViewports?: number
  /** 运动方向额外预取的视口倍数。 */
  forwardPrefetchViewports?: number
  /** 上一次选中的 mip；在 0.7～1.6 个设备像素范围内保持，避免缩放临界点反复重算。 */
  previousMip?: number
  /** 强制从指定 mip 开始，供完整文档最粗兜底使用。 */
  preferredMip?: number
  coverage?: 'viewport' | 'document'
  /** 返回 false 时尝试更粗一级 mip；所有 mip 均拒绝则抛出明确错误。 */
  admit?: (candidate: ImageEditorViewportTileCandidateV3) => boolean
}

/** 与主进程 source-provider 的单瓦片 halo 硬上限保持一致。 */
export const IMAGE_EDITOR_VIEWPORT_MAX_TILE_HALO_V3 = 2_048

export class ImageEditorViewportAdmissionErrorV3 extends Error {
  constructor() {
    super('CPU 瓦片预算不足，最粗 mip 仍无法容纳当前视口')
    this.name = 'ImageEditorViewportAdmissionErrorV3'
  }
}

function positiveFinite(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} 必须是正数`)
  return value
}

function nonNegativeFinite(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} 必须是非负整数`)
  return value
}

function finite(value: number, name: string): number {
  if (!Number.isFinite(value)) throw new Error(`${name} 必须是有限数值`)
  return value
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} 必须是正整数`)
  return value
}

function safeBytes(width: number, height: number, bitDepth: 8 | 16 | 32): number {
  const bytes = width * height * 4 * (bitDepth / 8)
  if (!Number.isSafeInteger(bytes)) throw new Error('视口瓦片字节数超出安全整数范围')
  return bytes
}

function validatePyramid(
  sourceSize: ImageEditSize,
  pyramid: ImageEditorV3PyramidDescriptor,
): ImageEditorV3PyramidDescriptor['levels'] {
  if (pyramid.tileSize !== IMAGE_EDIT_STORAGE_TILE_SIZE || pyramid.levels.length === 0) {
    throw new Error('图片源金字塔缺少 512 像素瓦片层级')
  }
  const seen = new Set<number>()
  const levels = [...pyramid.levels].sort((left, right) => left.mip - right.mip)
  if (levels[0]?.mip !== 0) throw new Error('图片源金字塔必须包含 mip 0')
  for (const level of levels) {
    if (!Number.isSafeInteger(level.mip) || level.mip < 0 || level.mip > 30 || seen.has(level.mip)) {
      throw new Error('图片源金字塔包含无效或重复 mip')
    }
    seen.add(level.mip)
    const expected = mipSize(sourceSize, level.mip)
    if (
      level.width !== expected.width
      || level.height !== expected.height
      || level.columns !== Math.ceil(level.width / IMAGE_EDIT_STORAGE_TILE_SIZE)
      || level.rows !== Math.ceil(level.height / IMAGE_EDIT_STORAGE_TILE_SIZE)
    ) {
      throw new Error(`图片源金字塔 mip ${level.mip} 与文档尺寸不一致`)
    }
  }
  return levels
}

function clippedVisibleRect(
  documentSize: ImageEditSize,
  viewport: ImageEditorViewportTransformV3,
): ImageEditRect {
  const right = Math.min(documentSize.width, viewport.documentX + viewport.width / viewport.zoom)
  const bottom = Math.min(documentSize.height, viewport.documentY + viewport.height / viewport.zoom)
  const x = Math.max(0, Math.min(documentSize.width, viewport.documentX))
  const y = Math.max(0, Math.min(documentSize.height, viewport.documentY))
  return {
    x,
    y,
    width: Math.max(0, right - x),
    height: Math.max(0, bottom - y),
  }
}

function clampRectToDocument(rect: ImageEditRect, documentSize: ImageEditSize): ImageEditRect {
  const x = Math.max(0, Math.min(documentSize.width, rect.x))
  const y = Math.max(0, Math.min(documentSize.height, rect.y))
  const right = Math.max(x, Math.min(documentSize.width, rect.x + rect.width))
  const bottom = Math.max(y, Math.min(documentSize.height, rect.y + rect.height))
  return { x, y, width: right - x, height: bottom - y }
}

function demandRect(
  documentSize: ImageEditSize,
  viewport: ImageEditorViewportTransformV3,
  visible: ImageEditRect,
  overscanViewports: number,
  forwardPrefetchViewports: number,
): ImageEditRect {
  if (visible.width === 0 || visible.height === 0) return visible
  const viewportWidth = viewport.width / viewport.zoom
  const viewportHeight = viewport.height / viewport.zoom
  const velocityX = finite(viewport.velocityX ?? 0, '视口横向速度')
  const velocityY = finite(viewport.velocityY ?? 0, '视口纵向速度')
  const forwardX = Math.sign(velocityX) * viewportWidth * forwardPrefetchViewports
  const forwardY = Math.sign(velocityY) * viewportHeight * forwardPrefetchViewports
  const left = visible.x - viewportWidth * overscanViewports + Math.min(0, forwardX)
  const top = visible.y - viewportHeight * overscanViewports + Math.min(0, forwardY)
  const right = visible.x + visible.width + viewportWidth * overscanViewports + Math.max(0, forwardX)
  const bottom = visible.y + visible.height + viewportHeight * overscanViewports + Math.max(0, forwardY)
  return clampRectToDocument({ x: left, y: top, width: right - left, height: bottom - top }, documentSize)
}

function idealMipForViewport(viewport: ImageEditorViewportTransformV3): number {
  const physicalPixelsPerDocumentPixel = viewport.zoom * viewport.devicePixelRatio
  if (physicalPixelsPerDocumentPixel >= 1) return 0
  return Math.max(0, Math.min(30, Math.floor(Math.log2(1 / physicalPixelsPerDocumentPixel))))
}

function targetMipForViewport(
  viewport: ImageEditorViewportTransformV3,
  previousMip: number | undefined,
): number {
  const ideal = idealMipForViewport(viewport)
  if (previousMip === undefined) return ideal
  if (!Number.isSafeInteger(previousMip) || previousMip < 0 || previousMip > 30) {
    throw new Error('上一次 mip 必须是 0～30 的整数')
  }
  const physicalPixels = viewport.zoom * viewport.devicePixelRatio * (2 ** previousMip)
  return physicalPixels >= PREVIOUS_MIP_MIN_PHYSICAL_PIXELS_V3
    && physicalPixels <= PREVIOUS_MIP_MAX_PHYSICAL_PIXELS_V3
    ? previousMip
    : ideal
}

function firstMipIndexAtOrBelowTarget(
  levels: ImageEditorV3PyramidDescriptor['levels'],
  targetMip: number,
): number {
  let selected = 0
  for (let index = 0; index < levels.length; index += 1) {
    if (levels[index].mip > targetMip) break
    selected = index
  }
  return selected
}

function candidateForMip(
  options: ImageEditorViewportTilePlanOptionsV3,
  mip: number,
  visibleDocumentRect: ImageEditRect,
  demandDocumentRect: ImageEditRect,
  bitDepth: 8 | 16 | 32,
  haloDocumentPixels: number,
): ImageEditorViewportTileCandidateV3 & {
  visibleMipRect: ImageEditRect
  demandMipRect: ImageEditRect
  mipSize: ImageEditSize
} {
  const scale = 2 ** mip
  const toMipRect = (rect: ImageEditRect): ImageEditRect => ({
    x: rect.x / scale,
    y: rect.y / scale,
    width: rect.width / scale,
    height: rect.height / scale,
  })
  const visibleMipRect = toMipRect(visibleDocumentRect)
  const demandMipRect = toMipRect(demandDocumentRect)
  const halo = Math.ceil(haloDocumentPixels / scale)
  const centerX = visibleMipRect.x + visibleMipRect.width / 2
  const centerY = visibleMipRect.y + visibleMipRect.height / 2
  const coordinates = enumerateTilesForRect(options.documentSize, mip, demandMipRect)
    .sort((left, right) => {
      const leftX = (left.x + 0.5) * IMAGE_EDIT_STORAGE_TILE_SIZE - centerX
      const leftY = (left.y + 0.5) * IMAGE_EDIT_STORAGE_TILE_SIZE - centerY
      const rightX = (right.x + 0.5) * IMAGE_EDIT_STORAGE_TILE_SIZE - centerX
      const rightY = (right.y + 0.5) * IMAGE_EDIT_STORAGE_TILE_SIZE - centerY
      return leftX * leftX + leftY * leftY - rightX * rightX - rightY * rightY
    })
  const tiles = coordinates.map((coordinate): ImageEditorViewportTileRequestV3 => {
    const region = createTileRegion(options.documentSize, coordinate, halo)
    return {
      key: imageEditorViewportTileCacheKeyV3({
        resourceRef: options.resourceRef,
        mip,
        tileX: coordinate.x,
        tileY: coordinate.y,
        halo,
        bitDepth,
      }),
      resourceRef: options.resourceRef,
      mip,
      tileX: coordinate.x,
      tileY: coordinate.y,
      halo,
      bitDepth,
      width: region.sourceRect.width,
      height: region.sourceRect.height,
      originX: region.sourceRect.x,
      originY: region.sourceRect.y,
      estimatedBytes: safeBytes(region.sourceRect.width, region.sourceRect.height, bitDepth),
    }
  })
  const estimatedBytes = tiles.reduce((total, tile) => total + tile.estimatedBytes, 0)
  if (!Number.isSafeInteger(estimatedBytes)) throw new Error('视口瓦片总字节数超出安全整数范围')
  return {
    mip,
    tiles,
    estimatedBytes,
    visibleMipRect,
    demandMipRect,
    mipSize: mipSize(options.documentSize, mip),
  }
}

export function imageEditorViewportTileCacheKeyV3(
  request: Pick<ImageEditorViewportTileRequestV3,
  'resourceRef' | 'mip' | 'tileX' | 'tileY' | 'halo' | 'bitDepth'>,
): string {
  return [
    request.resourceRef,
    `m${request.mip}`,
    `x${request.tileX}`,
    `y${request.tileY}`,
    `h${request.halo}`,
    `b${request.bitDepth}`,
  ].join(':')
}

/**
 * 默认 mip 始终保持每个 mip 像素不超过一个设备像素，避免选择过粗层级后再放大。
 * 只有 admission 明确拒绝时才逐级降画质，并在计划上标记 degradedForBudget。
 */
export function planImageEditorViewportTilesV3(
  options: ImageEditorViewportTilePlanOptionsV3,
): ImageEditorViewportTilePlanV3 {
  const documentSize = {
    width: positiveInteger(options.documentSize.width, '文档宽度'),
    height: positiveInteger(options.documentSize.height, '文档高度'),
  }
  const sourceSize = {
    width: positiveInteger(options.sourceSize?.width ?? documentSize.width, '源图片宽度'),
    height: positiveInteger(options.sourceSize?.height ?? documentSize.height, '源图片高度'),
  }
  const viewport = {
    documentX: finite(options.viewport.documentX, '视口文档 X'),
    documentY: finite(options.viewport.documentY, '视口文档 Y'),
    width: positiveFinite(options.viewport.width, '视口宽度'),
    height: positiveFinite(options.viewport.height, '视口高度'),
    zoom: positiveFinite(options.viewport.zoom, '视口缩放'),
    devicePixelRatio: positiveFinite(options.viewport.devicePixelRatio, '设备像素比'),
    velocityX: finite(options.viewport.velocityX ?? 0, '视口横向速度'),
    velocityY: finite(options.viewport.velocityY ?? 0, '视口纵向速度'),
    interacting: options.viewport.interacting === true,
  }
  const bitDepth = options.bitDepth
  if (![8, 16, 32].includes(bitDepth)) throw new Error('视口瓦片位深无效')
  const haloDocumentPixels = nonNegativeFinite(options.haloDocumentPixels ?? 0, '视口 halo')
  if (haloDocumentPixels > IMAGE_EDITOR_VIEWPORT_MAX_TILE_HALO_V3) {
    throw new Error(`视口 halo 不能超过 ${IMAGE_EDITOR_VIEWPORT_MAX_TILE_HALO_V3} 个文档像素`)
  }
  const overscanViewports = positiveOrZeroFinite(options.overscanViewports ?? 0, '视口预取范围')
  const forwardPrefetchViewports = positiveOrZeroFinite(
    options.forwardPrefetchViewports ?? 0,
    '运动方向预取范围',
  )
  const levels = validatePyramid(sourceSize, options.pyramid)
  const idealMip = idealMipForViewport(viewport)
  const requestedMip = options.preferredMip ?? targetMipForViewport(viewport, options.previousMip)
  if (!Number.isSafeInteger(requestedMip) || requestedMip < 0 || requestedMip > 30) {
    throw new Error('指定 mip 必须是 0～30 的整数')
  }
  const startIndex = firstMipIndexAtOrBelowTarget(levels, requestedMip)
  const visibleDocumentRect = clippedVisibleRect(documentSize, viewport)
  const demandDocumentRect = options.coverage === 'document'
    ? { x: 0, y: 0, ...documentSize }
    : demandRect(
        documentSize,
        viewport,
        visibleDocumentRect,
        overscanViewports,
        viewport.interacting ? forwardPrefetchViewports : 0,
      )

  for (let index = startIndex; index < levels.length; index += 1) {
    const candidate = candidateForMip(
      { ...options, documentSize, viewport },
      levels[index].mip,
      visibleDocumentRect,
      demandDocumentRect,
      bitDepth,
      haloDocumentPixels,
    )
    if (options.admit && !options.admit(candidate)) continue
    return {
      ...candidate,
      idealMip,
      degradedForBudget: index > startIndex,
      visibleDocumentRect,
      demandDocumentRect,
      physicalPixelsPerMipPixel: viewport.zoom * viewport.devicePixelRatio * (2 ** candidate.mip),
    }
  }
  throw new ImageEditorViewportAdmissionErrorV3()
}

function positiveOrZeroFinite(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} 必须是非负数`)
  return value
}
