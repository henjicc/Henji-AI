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
  mipSize: ImageEditSize
  physicalPixelsPerMipPixel: number
}

export interface ImageEditorViewportTilePlanOptionsV3 {
  resourceRef: ImageEditorV3ResourceRef
  documentSize: ImageEditSize
  pyramid: ImageEditorV3PyramidDescriptor
  viewport: ImageEditorViewportTransformV3
  bitDepth: 8 | 16 | 32
  /** 文档像素坐标中的最终 halo；规划器会按 mip 缩放。 */
  haloDocumentPixels?: number
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
  documentSize: ImageEditSize,
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
    const expected = mipSize(documentSize, level.mip)
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

function idealMipForViewport(viewport: ImageEditorViewportTransformV3): number {
  const physicalPixelsPerDocumentPixel = viewport.zoom * viewport.devicePixelRatio
  if (physicalPixelsPerDocumentPixel >= 1) return 0
  return Math.max(0, Math.min(30, Math.floor(Math.log2(1 / physicalPixelsPerDocumentPixel))))
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
  bitDepth: 8 | 16 | 32,
  haloDocumentPixels: number,
): ImageEditorViewportTileCandidateV3 & { visibleMipRect: ImageEditRect; mipSize: ImageEditSize } {
  const scale = 2 ** mip
  const visibleMipRect = {
    x: visibleDocumentRect.x / scale,
    y: visibleDocumentRect.y / scale,
    width: visibleDocumentRect.width / scale,
    height: visibleDocumentRect.height / scale,
  }
  const halo = Math.ceil(haloDocumentPixels / scale)
  const centerX = visibleMipRect.x + visibleMipRect.width / 2
  const centerY = visibleMipRect.y + visibleMipRect.height / 2
  const coordinates = enumerateTilesForRect(options.documentSize, mip, visibleMipRect)
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
  return { mip, tiles, estimatedBytes, visibleMipRect, mipSize: mipSize(options.documentSize, mip) }
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
  const viewport = {
    documentX: finite(options.viewport.documentX, '视口文档 X'),
    documentY: finite(options.viewport.documentY, '视口文档 Y'),
    width: positiveFinite(options.viewport.width, '视口宽度'),
    height: positiveFinite(options.viewport.height, '视口高度'),
    zoom: positiveFinite(options.viewport.zoom, '视口缩放'),
    devicePixelRatio: positiveFinite(options.viewport.devicePixelRatio, '设备像素比'),
  }
  const bitDepth = options.bitDepth
  if (![8, 16, 32].includes(bitDepth)) throw new Error('视口瓦片位深无效')
  const haloDocumentPixels = nonNegativeFinite(options.haloDocumentPixels ?? 0, '视口 halo')
  if (haloDocumentPixels > IMAGE_EDITOR_VIEWPORT_MAX_TILE_HALO_V3) {
    throw new Error(`视口 halo 不能超过 ${IMAGE_EDITOR_VIEWPORT_MAX_TILE_HALO_V3} 个文档像素`)
  }
  const levels = validatePyramid(documentSize, options.pyramid)
  const idealMip = idealMipForViewport(viewport)
  const startIndex = firstMipIndexAtOrBelowTarget(levels, idealMip)
  const visibleDocumentRect = clippedVisibleRect(documentSize, viewport)

  for (let index = startIndex; index < levels.length; index += 1) {
    const candidate = candidateForMip(
      { ...options, documentSize, viewport },
      levels[index].mip,
      visibleDocumentRect,
      bitDepth,
      haloDocumentPixels,
    )
    if (options.admit && !options.admit(candidate)) continue
    return {
      ...candidate,
      idealMip,
      degradedForBudget: index > startIndex,
      visibleDocumentRect,
      physicalPixelsPerMipPixel: viewport.zoom * viewport.devicePixelRatio * (2 ** candidate.mip),
    }
  }
  throw new ImageEditorViewportAdmissionErrorV3()
}
