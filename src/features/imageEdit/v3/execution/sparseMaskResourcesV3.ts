import type { ImageEditSize } from '@/core/imageEdit/v3/tileGeometry'
import {
  IMAGE_EDIT_MASK_TILE_SIZE_V3,
  isImageEditSparseMaskReferenceV3,
  type ImageEditMaskReferenceV3,
  type ImageEditSparseMaskReferenceV3,
} from '@/core/imageEdit/v3/layerTypes'
import type { ImageEditRenderPlan } from '@/core/imageEdit/v3/renderPlan'
import { createTileRegion } from '@/core/imageEdit/v3/tileGeometry'
import { IMAGE_EDITOR_V3_BRUSH_TILE_MEDIA_TYPE } from '../application/imageEditorResourceDescriptorsV3'
import type { ImageEditorV3ResourceDescriptor } from '@/platform/contracts/imageEditorV3'

const RESOURCE_REF_PATTERN = /^sha256:[a-f0-9]{64}$/
const TILE_KEY_PATTERN = /^(0|[1-9]\d*)\/(0|[1-9]\d*)\/(0|[1-9]\d*)$/
const MASK_TILE_MIN_RESOURCE_BYTES = 80
const MASK_TILE_MAX_RESOURCE_BYTES = 2 * 1024 * 1024

export interface ImageEditorSparseMaskTileReferenceV3 {
  tileKey: string
  resourceId: string
  byteSize: number
  tileX: number
  tileY: number
  width: number
  height: number
}

export interface ImageEditorSparseMaskReferencePlanV3 {
  mask: ImageEditSparseMaskReferenceV3
  tiles: ReadonlyMap<string, ImageEditorSparseMaskTileReferenceV3>
}

export interface ImageEditorSparseMaskPlanV3 {
  byMaskId: ReadonlyMap<string, ImageEditorSparseMaskReferencePlanV3>
}

function descriptorMap(
  descriptors: readonly ImageEditorV3ResourceDescriptor[],
): ReadonlyMap<string, ImageEditorV3ResourceDescriptor> {
  const result = new Map<string, ImageEditorV3ResourceDescriptor>()
  for (const descriptor of descriptors) {
    if (!RESOURCE_REF_PATTERN.test(descriptor.resourceRef)
      || !Number.isSafeInteger(descriptor.byteLength)
      || descriptor.byteLength < 0) {
      throw new Error(`图片编辑快照包含无效资源描述：${String(descriptor.resourceRef)}`)
    }
    if (result.has(descriptor.resourceRef)) {
      throw new Error(`图片编辑快照包含重复资源描述：${descriptor.resourceRef}`)
    }
    result.set(descriptor.resourceRef, descriptor)
  }
  return result
}

function parseTile(
  mask: ImageEditSparseMaskReferenceV3,
  canvasSize: ImageEditSize,
  tileKey: string,
  resourceId: string,
  descriptors: ReadonlyMap<string, ImageEditorV3ResourceDescriptor>,
): ImageEditorSparseMaskTileReferenceV3 {
  const match = TILE_KEY_PATTERN.exec(tileKey)
  if (!match || Number(match[1]) !== 0) {
    throw new Error(`稀疏蒙版“${mask.maskId}”包含无效或非 mip0 瓦片键：${tileKey}`)
  }
  const tileX = Number(match[2])
  const tileY = Number(match[3])
  let region
  try {
    region = createTileRegion(canvasSize, { mip: 0, x: tileX, y: tileY }, 0, mask.tileSize)
  } catch (error) {
    throw new Error(`稀疏蒙版“${mask.maskId}”的瓦片超出文档边界：${tileKey}`, { cause: error })
  }
  if (!RESOURCE_REF_PATTERN.test(resourceId)) {
    throw new Error(`稀疏蒙版“${mask.maskId}”包含无效资源引用：${tileKey}`)
  }
  const descriptor = descriptors.get(resourceId)
  if (!descriptor) throw new Error(`权威快照缺少蒙版瓦片资源描述：${tileKey}`)
  if (descriptor.mediaType !== IMAGE_EDITOR_V3_BRUSH_TILE_MEDIA_TYPE
    || descriptor.byteLength < MASK_TILE_MIN_RESOURCE_BYTES
    || descriptor.byteLength > MASK_TILE_MAX_RESOURCE_BYTES) {
    throw new Error(`蒙版瓦片资源描述不匹配：${tileKey}`)
  }
  return {
    tileKey,
    resourceId,
    byteSize: descriptor.byteLength,
    tileX,
    tileY,
    width: region.outputRect.width,
    height: region.outputRect.height,
  }
}

export function createImageEditorSparseMaskReferencePlanV3(
  mask: ImageEditSparseMaskReferenceV3,
  canvasSize: ImageEditSize,
  resourceDescriptors: readonly ImageEditorV3ResourceDescriptor[],
): ImageEditorSparseMaskReferencePlanV3 {
  if (mask.tileSize !== IMAGE_EDIT_MASK_TILE_SIZE_V3 || mask.storage !== 'mask-float32') {
    throw new Error(`稀疏蒙版“${mask.maskId}”的存储契约无效`)
  }
  const descriptors = descriptorMap(resourceDescriptors)
  const tiles = new Map<string, ImageEditorSparseMaskTileReferenceV3>()
  for (const [tileKey, resourceId] of Object.entries(mask.tiles)) {
    tiles.set(tileKey, parseTile(mask, canvasSize, tileKey, resourceId, descriptors))
  }
  return { mask, tiles }
}

/** 供预览、分块导出和 viewport renderer 共用，避免三套 sparse-mask 规则。 */
export function createImageEditorSparseMaskPlanV3(
  plan: ImageEditRenderPlan,
  canvasSize: ImageEditSize,
  resourceDescriptors: readonly ImageEditorV3ResourceDescriptor[],
): ImageEditorSparseMaskPlanV3 {
  const byMaskId = new Map<string, ImageEditorSparseMaskReferencePlanV3>()
  for (const node of plan.nodes) {
    const mask = node.mask
    if (!mask || !isImageEditSparseMaskReferenceV3(mask) || byMaskId.has(mask.maskId)) continue
    byMaskId.set(mask.maskId, createImageEditorSparseMaskReferencePlanV3(
      mask,
      canvasSize,
      resourceDescriptors,
    ))
  }
  return { byMaskId }
}

export function getImageEditorSparseMaskReferencePlanV3(
  reference: ImageEditMaskReferenceV3,
  plan: ImageEditorSparseMaskPlanV3,
): ImageEditorSparseMaskReferencePlanV3 | null {
  if (!isImageEditSparseMaskReferenceV3(reference)) return null
  const resolved = plan.byMaskId.get(reference.maskId)
  if (!resolved) throw new Error(`渲染计划缺少稀疏蒙版：${reference.maskId}`)
  return resolved
}
