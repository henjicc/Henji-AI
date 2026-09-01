import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import { createTileRegion } from '@/core/imageEdit/v3/tileGeometry'
import type { ImageEditorV3ResourceDescriptor } from '@/platform/contracts/imageEditorV3'
import type {
  ImageEditJsonObjectV3,
  ImageEditJsonValueV3,
  ImageEditLayerV3,
  ImageEditTransformV3,
} from '@/core/imageEdit/v3/layerTypes'
import { isImageEditSparseMaskReferenceV3 } from '@/core/imageEdit/v3/layerTypes'
import type {
  ImageEditCommandBusSnapshotV3,
  ImageEditPreviewOverrideV3,
} from '../application/imageEditCommandBus'
import { IMAGE_EDITOR_V3_BRUSH_TILE_MEDIA_TYPE } from '../application/imageEditorResourceDescriptorsV3'
import { createImageEditorSparseMaskReferencePlanV3 } from './sparseMaskResourcesV3'

export const IMAGE_EDITOR_PREVIEW_STABLE_MAX_EDGE_V3 = 1_600
export const IMAGE_EDITOR_PREVIEW_DRAFT_MAX_EDGE_V3 = 720

const RESOURCE_REF_PATTERN = /^sha256:[a-f0-9]{64}$/
const TILE_KEY_PATTERN = /^(0|[1-9]\d*)\/(0|[1-9]\d*)\/(0|[1-9]\d*)$/
const BRUSH_TILE_SIZE = 512
const BRUSH_TILE_MIN_RESOURCE_BYTES = 80
const BRUSH_TILE_MAX_RESOURCE_BYTES = 5 * 1024 * 1024

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isTransform(value: unknown): value is ImageEditTransformV3 {
  return Array.isArray(value)
    && value.length === 6
    && value.every((entry) => typeof entry === 'number' && Number.isFinite(entry))
}

function toJsonValue(value: unknown): ImageEditJsonValueV3 | undefined {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (Array.isArray(value)) {
    const items = value.map(toJsonValue)
    return items.every((item) => item !== undefined) ? items as ImageEditJsonValueV3[] : undefined
  }
  if (!isRecord(value)) return undefined
  const output: ImageEditJsonObjectV3 = {}
  for (const [key, entry] of Object.entries(value)) {
    const parsed = toJsonValue(entry)
    if (parsed === undefined) return undefined
    output[key] = parsed
  }
  return output
}

function toJsonObject(value: unknown): ImageEditJsonObjectV3 | null {
  const parsed = toJsonValue(value)
  return parsed && !Array.isArray(parsed) && typeof parsed === 'object' ? parsed : null
}

function applyLayerOverride(
  layer: ImageEditLayerV3,
  override: ImageEditPreviewOverrideV3,
): ImageEditLayerV3 {
  let next = layer
  if (layer.id === override.targetId) {
    if (override.kind === 'parameter' && isRecord(override.value)) {
      const keys = Object.keys(override.value)
      if (keys.length === 1 && typeof override.value.opacity === 'number') {
        next = { ...layer, opacity: Math.min(1, Math.max(0, override.value.opacity)) }
      } else if (layer.type === 'effect' || layer.type === 'adjustment') {
        const params = toJsonObject(override.value)
        if (params) next = { ...layer, params }
      }
    } else if (override.kind === 'transform') {
      const transform = isRecord(override.value) ? override.value.transform : override.value
      if (isTransform(transform)) next = { ...layer, transform }
    } else if (override.kind === 'brush' && isRecord(override.value) && layer.type === 'raster') {
      const tiles = isRecord(override.value.tiles)
        ? Object.fromEntries(Object.entries(override.value.tiles).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string',
        ))
        : null
      if (tiles) next = { ...layer, tiles: { ...layer.tiles, ...tiles } }
    }
  }
  if (next.type !== 'group') return next
  const children = next.children.map((child) => applyLayerOverride(child, override))
  return children.some((child, index) => child !== next.children[index])
    ? { ...next, children }
    : next
}

function applyOverride(
  document: ImageEditDocumentV3,
  override: ImageEditPreviewOverrideV3,
): ImageEditDocumentV3 {
  if (override.baseRevision !== document.revision) return document
  if (override.kind === 'crop' && isRecord(override.value)) {
    const cropValue = 'crop' in override.value ? override.value.crop : override.value
    const orientationValue = override.value.orientation
    const orientation = isRecord(orientationValue)
      && [0, 90, 180, 270].includes(Number(orientationValue.rotate))
      && typeof orientationValue.mirrored === 'boolean'
      ? {
          rotate: Number(orientationValue.rotate) as ImageEditDocumentV3['geometry']['orientation']['rotate'],
          mirrored: orientationValue.mirrored,
        }
      : document.geometry.orientation
    if (cropValue === null) {
      return { ...document, geometry: { ...document.geometry, orientation, crop: null } }
    }
    const crop = isRecord(cropValue) ? cropValue : override.value
    const { x, y, width, height } = crop
    if ([x, y, width, height].every((entry) => typeof entry === 'number' && Number.isFinite(entry))) {
      return {
        ...document,
        geometry: {
          ...document.geometry,
          orientation,
          crop: { x: Number(x), y: Number(y), width: Number(width), height: Number(height) },
        },
      }
    }
    return document
  }
  const layers = document.layers.map((layer) => applyLayerOverride(layer, override))
  return layers.some((layer, index) => layer !== document.layers[index])
    ? { ...document, layers }
    : document
}

/** PreviewOverride 只投影出瞬态文档，revision 与命令历史均保持不变。 */
export function projectImageEditorPreviewDocumentV3(
  snapshot: ImageEditCommandBusSnapshotV3,
): ImageEditDocumentV3 {
  return Object.values(snapshot.previewOverrides).reduce(applyOverride, snapshot.document)
}

export interface ImageEditorPreviewProxyResourceRequestV3 {
  kind: 'image-proxy'
  resourceId: string
  maxDimension: number
}

export interface ImageEditorPreviewBrushResourceRequestV3 {
  kind: 'brush-tile'
  storage: 'rgba-float32' | 'mask-float32'
  resourceId: string
  tileKey: string
  byteLength: number
  width: number
  height: number
}

export type ImageEditorPreviewResourceRequestV3 =
  | ImageEditorPreviewProxyResourceRequestV3
  | ImageEditorPreviewBrushResourceRequestV3

function createDescriptorMap(
  descriptors: readonly ImageEditorV3ResourceDescriptor[],
): ReadonlyMap<string, ImageEditorV3ResourceDescriptor> {
  const result = new Map<string, ImageEditorV3ResourceDescriptor>()
  for (const descriptor of descriptors) {
    if (!RESOURCE_REF_PATTERN.test(descriptor.resourceRef)
      || !Number.isSafeInteger(descriptor.byteLength)
      || descriptor.byteLength < 0
      || (descriptor.mediaType !== null && typeof descriptor.mediaType !== 'string')) {
      throw new Error(`图片预览包含无效资源描述：${String(descriptor.resourceRef)}`)
    }
    if (result.has(descriptor.resourceRef)) {
      throw new Error(`图片预览包含重复资源描述：${descriptor.resourceRef}`)
    }
    result.set(descriptor.resourceRef, descriptor)
  }
  return result
}

function addProxyRequest(
  resourceId: string,
  maxDimension: number,
  descriptors: ReadonlyMap<string, ImageEditorV3ResourceDescriptor>,
  requests: Map<string, number>,
): void {
  if (!RESOURCE_REF_PATTERN.test(resourceId)) return
  if (descriptors.get(resourceId)?.mediaType === IMAGE_EDITOR_V3_BRUSH_TILE_MEDIA_TYPE) {
    throw new Error(`画笔瓦片不能作为普通图片代理读取：${resourceId}`)
  }
  requests.set(resourceId, Math.max(requests.get(resourceId) ?? 0, maxDimension))
}

function addBrushRequest(
  document: ImageEditDocumentV3,
  layerId: string,
  tileKey: string,
  resourceId: string,
  descriptors: ReadonlyMap<string, ImageEditorV3ResourceDescriptor>,
  requests: Map<string, ImageEditorPreviewBrushResourceRequestV3>,
  storage: ImageEditorPreviewBrushResourceRequestV3['storage'] = 'rgba-float32',
): void {
  const match = TILE_KEY_PATTERN.exec(tileKey)
  if (!match) throw new Error(`栅格图层“${layerId}”包含无效画笔瓦片键：${tileKey}`)
  const mip = Number(match[1])
  const x = Number(match[2])
  const y = Number(match[3])
  if (mip !== 0 || !Number.isSafeInteger(x) || !Number.isSafeInteger(y)) {
    throw new Error(`栅格图层“${layerId}”包含不受支持的画笔瓦片键：${tileKey}`)
  }
  if (!RESOURCE_REF_PATTERN.test(resourceId)) {
    throw new Error(`栅格图层“${layerId}”包含无效画笔瓦片资源：${tileKey}`)
  }
  let region
  try {
    region = createTileRegion(document.geometry, { mip, x, y }, 0, BRUSH_TILE_SIZE)
  } catch (error) {
    throw new Error(`栅格图层“${layerId}”的画笔瓦片超出文档边界：${tileKey}`, { cause: error })
  }
  const descriptor = descriptors.get(resourceId)
  if (!descriptor) throw new Error(`图片预览缺少画笔瓦片资源描述：${tileKey}`)
  if (descriptor.mediaType !== IMAGE_EDITOR_V3_BRUSH_TILE_MEDIA_TYPE) {
    throw new Error(`图片预览画笔瓦片媒体类型不匹配：${tileKey}`)
  }
  if (descriptor.byteLength < BRUSH_TILE_MIN_RESOURCE_BYTES
    || descriptor.byteLength > BRUSH_TILE_MAX_RESOURCE_BYTES) {
    throw new Error(`图片预览画笔瓦片字节数无效：${tileKey}`)
  }
  const request: ImageEditorPreviewBrushResourceRequestV3 = {
    kind: 'brush-tile',
    storage,
    resourceId,
    tileKey,
    byteLength: descriptor.byteLength,
    width: region.outputRect.width,
    height: region.outputRect.height,
  }
  const existing = requests.get(resourceId)
  if (existing && (
    existing.width !== request.width
    || existing.height !== request.height
    || existing.storage !== request.storage
  )) {
    throw new Error(`同一画笔瓦片资源被用于不一致的尺寸：${resourceId}`)
  }
  if (!existing) requests.set(resourceId, request)
}

function collectLayerResources(
  document: ImageEditDocumentV3,
  layer: ImageEditLayerV3,
  maxDimension: number,
  descriptors: ReadonlyMap<string, ImageEditorV3ResourceDescriptor>,
  proxies: Map<string, number>,
  brushes: Map<string, ImageEditorPreviewBrushResourceRequestV3>,
): void {
  if (layer.mask) {
    if (isImageEditSparseMaskReferenceV3(layer.mask)) {
      const maskPlan = createImageEditorSparseMaskReferencePlanV3(
        layer.mask,
        document.geometry,
        [...descriptors.values()],
      )
      for (const reference of maskPlan.tiles.values()) {
        addBrushRequest(
          document,
          layer.id,
          reference.tileKey,
          reference.resourceId,
          descriptors,
          brushes,
          'mask-float32',
        )
      }
    } else if (RESOURCE_REF_PATTERN.test(layer.mask.resourceId)) {
      addProxyRequest(layer.mask.resourceId, maxDimension, descriptors, proxies)
    }
  }
  if (layer.type === 'raster') {
    if (layer.source.kind === 'resource' && RESOURCE_REF_PATTERN.test(layer.source.resourceId)) {
      addProxyRequest(layer.source.resourceId, maxDimension, descriptors, proxies)
    }
    for (const [tileKey, resourceId] of Object.entries(layer.tiles)) {
      addBrushRequest(document, layer.id, tileKey, resourceId, descriptors, brushes)
    }
  } else if (layer.type === 'group') {
    for (const child of layer.children) {
      collectLayerResources(document, child, maxDimension, descriptors, proxies, brushes)
    }
  }
}

export function collectImageEditorPreviewResourceRequestsV3(
  document: ImageEditDocumentV3,
  maxDimension: number,
  resourceDescriptors: readonly ImageEditorV3ResourceDescriptor[] = [],
): ImageEditorPreviewResourceRequestV3[] {
  const descriptors = createDescriptorMap(resourceDescriptors)
  const proxies = new Map<string, number>()
  const brushes = new Map<string, ImageEditorPreviewBrushResourceRequestV3>()
  for (const layer of document.layers) {
    collectLayerResources(document, layer, maxDimension, descriptors, proxies, brushes)
  }
  return [
    ...[...proxies].map(([resourceId, requestedMaxDimension]) => ({
      kind: 'image-proxy' as const,
      resourceId,
      maxDimension: requestedMaxDimension,
    })),
    ...brushes.values(),
  ]
}
