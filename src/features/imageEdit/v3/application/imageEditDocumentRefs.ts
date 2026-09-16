import type { ApplicationRef } from '@/core/application-control'
import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import type { ImageEditGroupLayerV3, ImageEditLayerV3 } from '@/core/imageEdit/v3/layerTypes'

const V3_REF_PREFIX = 'v3:'

export interface ImageEditLiveLayerLocationV3 {
  layer: ImageEditLayerV3
  parentId: string | null
  index: number
  ancestors: ImageEditGroupLayerV3[]
}

function encodePart(value: string): string {
  return encodeURIComponent(value)
}

function decodePart(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    throw new Error('NOT_FOUND')
  }
}

function parts(ref: ApplicationRef, kind: string, count: number): string[] {
  if (ref.kind !== kind || !ref.id.startsWith(V3_REF_PREFIX)) throw new Error('NOT_FOUND')
  const result = ref.id.slice(V3_REF_PREFIX.length).split(':').map(decodePart)
  if (result.length !== count || result.some((item) => item.length === 0)) throw new Error('NOT_FOUND')
  return result
}

export function imageEditV3DocumentRef(documentId: string): ApplicationRef {
  return { kind: 'image_edit.document', id: `${V3_REF_PREFIX}${encodePart(documentId)}` }
}

export function imageEditV3LayerRef(documentId: string, layerId: string): ApplicationRef {
  return { kind: 'image_edit.layer', id: `${V3_REF_PREFIX}${encodePart(documentId)}:${encodePart(layerId)}` }
}

export function imageEditV3GroupRef(documentId: string, layerId: string): ApplicationRef {
  return { kind: 'image_edit.group', id: `${V3_REF_PREFIX}${encodePart(documentId)}:${encodePart(layerId)}` }
}

export function imageEditV3MaskRef(documentId: string, layerId: string): ApplicationRef {
  return { kind: 'image_edit.mask', id: `${V3_REF_PREFIX}${encodePart(documentId)}:${encodePart(layerId)}` }
}

export function imageEditV3ResourceRef(documentId: string, resourceId: string): ApplicationRef {
  return { kind: 'image_edit.resource', id: `${V3_REF_PREFIX}${encodePart(documentId)}:${encodePart(resourceId)}` }
}

export function imageEditV3AnnotationRef(
  documentId: string,
  layerId: string,
  annotationId: string,
): ApplicationRef {
  return {
    kind: 'image_mark.annotation',
    id: `${V3_REF_PREFIX}${encodePart(documentId)}:${encodePart(layerId)}:${encodePart(annotationId)}`,
  }
}

export function isImageEditV3Ref(ref: ApplicationRef): boolean {
  return ref.id.startsWith(V3_REF_PREFIX)
}

export function splitImageEditV3DocumentRef(ref: ApplicationRef): { documentId: string } {
  const [documentId] = parts(ref, 'image_edit.document', 1)
  return { documentId }
}

export function splitImageEditV3LayerRef(
  ref: ApplicationRef,
  expectedKind: 'image_edit.layer' | 'image_edit.group' | 'image_edit.mask' = 'image_edit.layer',
): { documentId: string; layerId: string } {
  const [documentId, layerId] = parts(ref, expectedKind, 2)
  return { documentId, layerId }
}

export function splitImageEditV3ResourceRef(ref: ApplicationRef): {
  documentId: string
  resourceId: string
} {
  const [documentId, resourceId] = parts(ref, 'image_edit.resource', 2)
  return { documentId, resourceId }
}

export function splitImageEditV3AnnotationRef(ref: ApplicationRef): {
  documentId: string
  layerId: string
  annotationId: string
} {
  const [documentId, layerId, annotationId] = parts(ref, 'image_mark.annotation', 3)
  return { documentId, layerId, annotationId }
}

export function findImageEditV3LiveLayer(
  document: ImageEditDocumentV3,
  layerId: string,
): ImageEditLiveLayerLocationV3 | null {
  const visit = (
    layers: readonly ImageEditLayerV3[],
    parentId: string | null,
    ancestors: ImageEditGroupLayerV3[],
  ): ImageEditLiveLayerLocationV3 | null => {
    for (let index = 0; index < layers.length; index += 1) {
      const layer = layers[index]
      if (layer.id === layerId) return { layer, parentId, index, ancestors }
      if (layer.type === 'group') {
        const nested = visit(layer.children, layer.id, [...ancestors, layer])
        if (nested) return nested
      }
    }
    return null
  }
  return visit(document.layers, null, [])
}

export function collectImageEditV3LiveLayers(
  document: ImageEditDocumentV3,
): ImageEditLiveLayerLocationV3[] {
  const result: ImageEditLiveLayerLocationV3[] = []
  const visit = (
    layers: readonly ImageEditLayerV3[],
    parentId: string | null,
    ancestors: ImageEditGroupLayerV3[],
  ): void => {
    layers.forEach((layer, index) => {
      result.push({ layer, parentId, index, ancestors })
      if (layer.type === 'group') visit(layer.children, layer.id, [...ancestors, layer])
    })
  }
  visit(document.layers, null, [])
  return result
}
