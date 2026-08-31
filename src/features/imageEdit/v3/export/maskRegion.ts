import {
  createImageEditorV3RequestId,
  readImageEditorV3BrushTiles,
} from '@/commands/imageEditorV3'
import {
  createFloat32MaskTile,
  type Float32MaskTile,
  type ImageEditBrushTileV3,
  type ImageEditMaskReferenceV3,
  type ImageEditResourceBudget,
} from '@/core/imageEdit/v3'
import { isImageEditSparseMaskReferenceV3 } from '@/core/imageEdit/v3/layerTypes'
import {
  getImageEditorSparseMaskReferencePlanV3,
  type ImageEditorSparseMaskPlanV3,
  type ImageEditorSparseMaskTileReferenceV3,
} from '../execution/sparseMaskResourcesV3'
import type {
  ImageEditorV3ExportRenderDependencies,
  ImageEditorV3ExportRenderRegion,
} from './contracts'

const READ_BATCH_SIZE = 16

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return
  const error = signal.reason instanceof Error ? signal.reason : new Error('蒙版瓦片读取已取消')
  if (error.name === 'Error') error.name = 'AbortError'
  throw error
}

function intersects(
  reference: ImageEditorSparseMaskTileReferenceV3,
  region: ImageEditorV3ExportRenderRegion,
  mip: number,
): boolean {
  const scale = 2 ** mip
  const left = region.x * scale
  const top = region.y * scale
  const right = (region.x + region.width) * scale
  const bottom = (region.y + region.height) * scale
  const tileLeft = reference.tileX * 512
  const tileTop = reference.tileY * 512
  return tileLeft < right
    && tileTop < bottom
    && tileLeft + reference.width > left
    && tileTop + reference.height > top
}

function validateMaskTile(
  reference: ImageEditorSparseMaskTileReferenceV3,
  tile: ImageEditBrushTileV3,
): asserts tile is Extract<ImageEditBrushTileV3, { storage: 'mask-float32' }> {
  if (tile.storage !== 'mask-float32'
    || tile.width !== reference.width
    || tile.height !== reference.height
    || tile.data.length !== reference.width * reference.height) {
    throw new Error(`蒙版瓦片像素契约不匹配：${reference.tileKey}`)
  }
  for (const value of tile.data) {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error(`蒙版瓦片包含无效值：${reference.tileKey}`)
    }
  }
}

async function loadMaskTiles(
  references: readonly ImageEditorSparseMaskTileReferenceV3[],
  signal: AbortSignal,
  dependencies: ImageEditorV3ExportRenderDependencies,
): Promise<ReadonlyMap<string, Extract<ImageEditBrushTileV3, { storage: 'mask-float32' }>>> {
  const read = dependencies.readBrushTiles ?? ((tiles, currentSignal) => (
    readImageEditorV3BrushTiles({
      requestId: createImageEditorV3RequestId('export-mask-tiles'),
      tiles,
    }, currentSignal)
  ))
  const output = new Map<string, Extract<ImageEditBrushTileV3, { storage: 'mask-float32' }>>()
  for (let offset = 0; offset < references.length; offset += READ_BATCH_SIZE) {
    throwIfAborted(signal)
    const batch = references.slice(offset, offset + READ_BATCH_SIZE)
    const loaded = await read(batch.map((reference) => ({
      tileKey: reference.tileKey,
      resource: { resourceId: reference.resourceId, byteSize: reference.byteSize },
    })), signal)
    const byKey = new Map(loaded.tiles.map((entry) => [entry.tileKey, entry.tile]))
    for (const reference of batch) {
      const tile = byKey.get(reference.tileKey)
      if (!tile) throw new Error(`蒙版瓦片读取结果缺失：${reference.tileKey}`)
      validateMaskTile(reference, tile)
      output.set(reference.tileKey, tile)
    }
  }
  return output
}

/** 只读取当前输出区域相交的 512 Float32 瓦片，绝不物化全画布蒙版。 */
export async function loadImageEditorV3SparseMaskRegion(
  reference: ImageEditMaskReferenceV3,
  region: ImageEditorV3ExportRenderRegion,
  mip: number,
  plan: ImageEditorSparseMaskPlanV3,
  signal: AbortSignal,
  dependencies: ImageEditorV3ExportRenderDependencies,
  budget: ImageEditResourceBudget,
): Promise<Float32MaskTile | null> {
  if (!isImageEditSparseMaskReferenceV3(reference)) return null
  const maskPlan = getImageEditorSparseMaskReferencePlanV3(reference, plan)
  if (!maskPlan) throw new Error(`稀疏蒙版计划缺失：${reference.maskId}`)
  const references = [...maskPlan.tiles.values()].filter((tile) => intersects(tile, region, mip))
  const decodedBytes = references.reduce(
    (total, tile) => total + tile.width * tile.height * Float32Array.BYTES_PER_ELEMENT,
    0,
  )
  const lease = budget.acquire('in-flight', decodedBytes)
  if (!lease) throw new Error('图片导出资源账本无法预留蒙版解码空间')
  try {
    const tiles = await loadMaskTiles(references, signal, dependencies)
    const output = new Float32Array(region.width * region.height)
    if (reference.defaultValue === 1) output.fill(1)
    const scale = 2 ** mip
    for (let y = 0; y < region.height; y += 1) {
      throwIfAborted(signal)
      const sourceY = Math.min(
        Number.MAX_SAFE_INTEGER,
        Math.floor((region.y + y + 0.5) * scale),
      )
      const tileY = Math.floor(sourceY / 512)
      for (let x = 0; x < region.width; x += 1) {
        const sourceX = Math.floor((region.x + x + 0.5) * scale)
        const tileX = Math.floor(sourceX / 512)
        const key = `0/${tileX}/${tileY}`
        const tile = tiles.get(key)
        if (!tile) continue
        const localX = Math.min(tile.width - 1, sourceX - tileX * 512)
        const localY = Math.min(tile.height - 1, sourceY - tileY * 512)
        output[y * region.width + x] = tile.data[localY * tile.width + localX]
      }
    }
    return createFloat32MaskTile(region.width, region.height, output)
  } finally {
    lease.release()
  }
}
