import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import type {
  ImageEditJsonObjectV3,
  ImageEditJsonValueV3,
  ImageEditLayerV3,
  ImageEditTransformV3,
} from '@/core/imageEdit/v3/layerTypes'
import type {
  ImageEditCommandBusSnapshotV3,
  ImageEditPreviewOverrideV3,
} from '../application/imageEditCommandBus'

export const IMAGE_EDITOR_PREVIEW_STABLE_MAX_EDGE_V3 = 1_600
export const IMAGE_EDITOR_PREVIEW_DRAFT_MAX_EDGE_V3 = 960

const RESOURCE_REF_PATTERN = /^sha256:[a-f0-9]{64}$/

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

export interface ImageEditorPreviewResourceRequestV3 {
  resourceId: string
  maxDimension: number
}

function collectLayerResources(
  layer: ImageEditLayerV3,
  maxDimension: number,
  requests: Map<string, number>,
): void {
  if (layer.mask && RESOURCE_REF_PATTERN.test(layer.mask.resourceId)) {
    requests.set(layer.mask.resourceId, Math.max(requests.get(layer.mask.resourceId) ?? 0, maxDimension))
  }
  if (layer.type === 'raster') {
    if (layer.source.kind === 'resource' && RESOURCE_REF_PATTERN.test(layer.source.resourceId)) {
      requests.set(layer.source.resourceId, Math.max(requests.get(layer.source.resourceId) ?? 0, maxDimension))
    }
    for (const resourceId of Object.values(layer.tiles)) {
      if (RESOURCE_REF_PATTERN.test(resourceId)) {
        requests.set(resourceId, Math.max(requests.get(resourceId) ?? 0, 512))
      }
    }
  } else if (layer.type === 'group') {
    for (const child of layer.children) collectLayerResources(child, maxDimension, requests)
  }
}

export function collectImageEditorPreviewResourceRequestsV3(
  document: ImageEditDocumentV3,
  maxDimension: number,
): ImageEditorPreviewResourceRequestV3[] {
  const requests = new Map<string, number>()
  for (const layer of document.layers) collectLayerResources(layer, maxDimension, requests)
  return [...requests].map(([resourceId, requestedMaxDimension]) => ({
    resourceId,
    maxDimension: requestedMaxDimension,
  }))
}
