import {
  createImageEditorV3RequestId,
  readImageEditorV3BrushTiles,
} from '@/commands/imageEditorV3'
import {
  createFloat32PremultipliedRgbaTile,
  createTileRegion,
  enumerateTilesForRect,
  imageEditBrushTileKeyV3,
  type Float32PremultipliedRgbaTile,
  type ImageEditBrushResourceReferenceV3,
  type ImageEditBrushTileV3,
  type ImageEditMemoryLease,
  type ImageEditRenderPlan,
  type ImageEditRenderPlanNode,
  type ImageEditResourceBudget,
  type ImageEditSize,
} from '@/core/imageEdit/v3'
import type {
  ImageEditorV3ResourceDescriptor,
} from '@/platform/contracts/imageEditorV3'
import {
  ImageEditorV3ExportCapabilityError,
  type ImageEditorV3ExportRenderDependencies,
  type ImageEditorV3ExportRenderRegion,
} from './contracts'

const BRUSH_TILE_SIZE = 512
const BRUSH_TILE_BATCH_SIZE = 16
const BRUSH_TILE_MIN_RESOURCE_BYTES = 80
const BRUSH_TILE_MAX_RESOURCE_BYTES = 5 * 1024 * 1024
const BRUSH_TILE_MEDIA_TYPE = 'application/x-henji-brush-tile-v3'
const RESOURCE_REF_PATTERN = /^sha256:[a-f0-9]{64}$/
const TILE_KEY_PATTERN = /^(0|[1-9]\d*)\/(0|[1-9]\d*)\/(0|[1-9]\d*)$/

interface SparseRasterTileReference {
  tileKey: string
  resourceId: string
  byteSize: number
  tileX: number
  tileY: number
  width: number
  height: number
}

export interface ImageEditorV3SparseRasterPlan {
  byNodeId: ReadonlyMap<string, ReadonlyMap<string, SparseRasterTileReference>>
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function abortError(signal: AbortSignal): Error {
  const error = signal.reason instanceof Error
    ? signal.reason
    : new Error('图片画笔瓦片读取已取消')
  if (error.name === 'Error') error.name = 'AbortError'
  return error
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError(signal)
}

async function raceWithAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  throwIfAborted(signal)
  let onAbort: (() => void) | undefined
  const cancelled = new Promise<never>((_, reject) => {
    onAbort = () => reject(abortError(signal))
    signal.addEventListener('abort', onAbort, { once: true })
  })
  try {
    return await Promise.race([operation, cancelled])
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort)
  }
}

function descriptorMap(
  descriptors: readonly ImageEditorV3ResourceDescriptor[],
): ReadonlyMap<string, ImageEditorV3ResourceDescriptor> {
  const result = new Map<string, ImageEditorV3ResourceDescriptor>()
  for (const descriptor of descriptors) {
    if (!RESOURCE_REF_PATTERN.test(descriptor.resourceRef)
      || !Number.isSafeInteger(descriptor.byteLength)
      || descriptor.byteLength < 0
      || (descriptor.mediaType !== null && typeof descriptor.mediaType !== 'string')) {
      throw new Error(`图片编辑快照包含无效资源描述：${String(descriptor.resourceRef)}`)
    }
    if (result.has(descriptor.resourceRef)) {
      throw new Error(`图片编辑快照包含重复资源描述：${descriptor.resourceRef}`)
    }
    result.set(descriptor.resourceRef, { ...descriptor })
  }
  return result
}

function parseSparseReference(
  node: ImageEditRenderPlanNode,
  canvasSize: ImageEditSize,
  key: string,
  resourceId: unknown,
  descriptors: ReadonlyMap<string, ImageEditorV3ResourceDescriptor>,
): SparseRasterTileReference {
  const match = TILE_KEY_PATTERN.exec(key)
  if (!match) throw new Error(`栅格图层“${node.layerId}”包含无效画笔瓦片键：${key}`)
  const mip = Number(match[1])
  const tileX = Number(match[2])
  const tileY = Number(match[3])
  if (!Number.isSafeInteger(mip) || !Number.isSafeInteger(tileX) || !Number.isSafeInteger(tileY)) {
    throw new Error(`栅格图层“${node.layerId}”包含超出安全范围的画笔瓦片键：${key}`)
  }
  if (mip !== 0) {
    throw new Error(`栅格图层“${node.layerId}”包含非 mip0 画笔瓦片，无法权威导出：${key}`)
  }
  if (key !== imageEditBrushTileKeyV3({ mip, x: tileX, y: tileY })) {
    throw new Error(`栅格图层“${node.layerId}”包含非规范画笔瓦片键：${key}`)
  }
  let region
  try {
    region = createTileRegion(canvasSize, { mip, x: tileX, y: tileY }, 0, BRUSH_TILE_SIZE)
  } catch (error) {
    throw new Error(`栅格图层“${node.layerId}”的画笔瓦片超出文档边界：${key}`, { cause: error })
  }
  if (typeof resourceId !== 'string' || !RESOURCE_REF_PATTERN.test(resourceId)) {
    throw new Error(`栅格图层“${node.layerId}”的画笔瓦片资源引用无效：${key}`)
  }
  const descriptor = descriptors.get(resourceId)
  if (!descriptor) {
    throw new Error(`权威快照缺少画笔瓦片资源描述：${key}（${resourceId}）`)
  }
  if (descriptor.mediaType !== BRUSH_TILE_MEDIA_TYPE) {
    throw new Error(`画笔瓦片资源媒体类型不匹配：${key}（${String(descriptor.mediaType)}）`)
  }
  if (descriptor.byteLength < BRUSH_TILE_MIN_RESOURCE_BYTES
    || descriptor.byteLength > BRUSH_TILE_MAX_RESOURCE_BYTES) {
    throw new Error(`画笔瓦片资源字节数无效：${key}（${descriptor.byteLength}）`)
  }
  return {
    tileKey: key,
    resourceId,
    byteSize: descriptor.byteLength,
    tileX,
    tileY,
    width: region.outputRect.width,
    height: region.outputRect.height,
  }
}

/** 在创建输出会话前一次性校验全部稀疏键和权威资源描述。 */
export function createImageEditorV3SparseRasterPlan(
  plan: ImageEditRenderPlan,
  canvasSize: ImageEditSize,
  resourceDescriptors: readonly ImageEditorV3ResourceDescriptor[],
): ImageEditorV3SparseRasterPlan {
  const descriptors = descriptorMap(resourceDescriptors)
  const byNodeId = new Map<string, ReadonlyMap<string, SparseRasterTileReference>>()
  for (const node of plan.nodes) {
    if (node.definitionId !== 'source.raster') continue
    if (!isRecord(node.parameters.tiles)) {
      throw new Error(`栅格渲染节点缺少画笔瓦片映射：${node.layerId}`)
    }
    const byKey = new Map<string, SparseRasterTileReference>()
    for (const [key, resourceId] of Object.entries(node.parameters.tiles)) {
      byKey.set(key, parseSparseReference(node, canvasSize, key, resourceId, descriptors))
    }
    if (byKey.size > 0) byNodeId.set(node.id, byKey)
  }
  return { byNodeId }
}

function defaultReadBrushTiles(
  tiles: ReadonlyArray<{
    tileKey: string
    resource: ImageEditBrushResourceReferenceV3
  }>,
  signal: AbortSignal,
): Promise<{ tiles: Array<{ tileKey: string; tile: ImageEditBrushTileV3 }> }> {
  return readImageEditorV3BrushTiles({
    requestId: createImageEditorV3RequestId('export-brush-tiles'),
    tiles,
  }, signal)
}

function acquireDecodedLease(
  budget: ImageEditResourceBudget,
  bytes: number,
): ImageEditMemoryLease {
  const lease = budget.acquire('in-flight', bytes)
  if (lease) return lease
  throw new ImageEditorV3ExportCapabilityError(
    'WORKING_SET_EXCEEDED',
    `图片导出资源账本无法预留 ${Math.ceil(bytes / 1024 / 1024)}MiB 画笔解码空间`,
  )
}

function validateBrushTile(
  reference: SparseRasterTileReference,
  tile: ImageEditBrushTileV3,
  expected: {
    workingSpace: 'srgb' | 'display-p3' | 'rec2020'
    transferFunction: 'srgb' | 'linear' | 'pq' | 'hlg'
  },
  signal: AbortSignal,
): asserts tile is Extract<ImageEditBrushTileV3, { storage: 'rgba-float32' }> {
  if (tile.storage !== 'rgba-float32'
    || tile.width !== reference.width
    || tile.height !== reference.height
    || tile.colorDomain !== 'linear-light'
    || tile.workingSpace !== expected.workingSpace
    || tile.transferFunction !== expected.transferFunction
    || tile.referenceWhiteNits !== 203
    || tile.alpha !== 'premultiplied'
    || !(tile.data instanceof Float32Array)
    || tile.data.length !== reference.width * reference.height * 4) {
    throw new Error(`画笔瓦片像素契约与文档不匹配：${reference.tileKey}`)
  }
  for (let offset = 0; offset < tile.data.length; offset += 4) {
    if ((offset & 0xffff) === 0) throwIfAborted(signal)
    const alpha = tile.data[offset + 3]
    if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) {
      throw new Error(`画笔瓦片包含无效 Alpha：${reference.tileKey}`)
    }
    for (let channel = 0; channel < 3; channel += 1) {
      const value = tile.data[offset + channel]
      if (!Number.isFinite(value) || (alpha === 0 && value !== 0)) {
        throw new Error(`画笔瓦片包含无效预乘 RGBA：${reference.tileKey}`)
      }
    }
  }
}

function copyBrushIntersection(
  reference: SparseRasterTileReference,
  tile: Extract<ImageEditBrushTileV3, { storage: 'rgba-float32' }>,
  target: Float32Array,
  region: ImageEditorV3ExportRenderRegion,
): void {
  const originX = reference.tileX * BRUSH_TILE_SIZE
  const originY = reference.tileY * BRUSH_TILE_SIZE
  const left = Math.max(region.x, originX)
  const top = Math.max(region.y, originY)
  const right = Math.min(region.x + region.width, originX + tile.width)
  const bottom = Math.min(region.y + region.height, originY + tile.height)
  if (right <= left || bottom <= top) return
  const copyWidth = right - left
  for (let y = top; y < bottom; y += 1) {
    const sourceOffset = ((y - originY) * tile.width + left - originX) * 4
    const targetOffset = ((y - region.y) * region.width + left - region.x) * 4
    target.set(tile.data.subarray(sourceOffset, sourceOffset + copyWidth * 4), targetOffset)
  }
}

/** 稀疏画笔瓦片是该栅格图层对应存储区域的完整替换，而不是叠加笔迹。 */
export async function applyImageEditorV3SparseRasterRegion(
  node: ImageEditRenderPlanNode,
  base: Float32PremultipliedRgbaTile,
  region: ImageEditorV3ExportRenderRegion,
  canvasSize: ImageEditSize,
  plan: ImageEditorV3SparseRasterPlan,
  expected: {
    workingSpace: 'srgb' | 'display-p3' | 'rec2020'
    transferFunction: 'srgb' | 'linear' | 'pq' | 'hlg'
  },
  signal: AbortSignal,
  dependencies: ImageEditorV3ExportRenderDependencies,
  budget: ImageEditResourceBudget,
): Promise<Float32PremultipliedRgbaTile> {
  const byKey = plan.byNodeId.get(node.id)
  if (!byKey) return base
  const references = enumerateTilesForRect(canvasSize, 0, region, BRUSH_TILE_SIZE)
    .map((coordinate) => byKey.get(imageEditBrushTileKeyV3(coordinate)))
    .filter((value): value is SparseRasterTileReference => value !== undefined)
  if (references.length === 0) return base

  const output = new Float32Array(base.data)
  const readBrushTiles = dependencies.readBrushTiles ?? defaultReadBrushTiles
  for (let start = 0; start < references.length; start += BRUSH_TILE_BATCH_SIZE) {
    throwIfAborted(signal)
    const batch = references.slice(start, start + BRUSH_TILE_BATCH_SIZE)
    const decodedBytes = batch.reduce(
      (total, reference) => total + reference.width * reference.height * 4 * Float32Array.BYTES_PER_ELEMENT,
      0,
    )
    const lease = acquireDecodedLease(budget, decodedBytes)
    try {
      const requested = batch.map((reference) => ({
        tileKey: reference.tileKey,
        resource: { resourceId: reference.resourceId, byteSize: reference.byteSize },
      }))
      const result = await raceWithAbort(readBrushTiles(requested, signal), signal)
      if (result.tiles.length !== batch.length) throw new Error('画笔瓦片读取结果数量不匹配')
      const returned = new Map<string, ImageEditBrushTileV3>()
      for (const item of result.tiles) {
        if (returned.has(item.tileKey) || !batch.some((reference) => reference.tileKey === item.tileKey)) {
          throw new Error(`画笔瓦片读取返回了重复或未请求的键：${item.tileKey}`)
        }
        returned.set(item.tileKey, item.tile)
      }
      for (const reference of batch) {
        const tile = returned.get(reference.tileKey)
        if (!tile) throw new Error(`画笔瓦片读取结果缺失：${reference.tileKey}`)
        validateBrushTile(reference, tile, expected, signal)
        copyBrushIntersection(reference, tile, output, region)
      }
    } finally {
      lease.release()
    }
  }
  return createFloat32PremultipliedRgbaTile(
    base.width,
    base.height,
    base.colorDomain,
    output,
    base.workingSpace,
    base.transferFunction,
    base.referenceWhiteNits,
  )
}
