import type { ApplicationRef } from '@/core/application-control'
import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import type { ImageEditGroupLayerV3, ImageEditLayerV3 } from '@/core/imageEdit/v3/layerTypes'

import type { ImageEditCommandBusV3 } from './imageEditCommandBus'

const V3_REF_PREFIX = 'v3:'

interface LiveSessionRecordV3 {
  registrationId: symbol
  sessionId: string
  bus: ImageEditCommandBusV3
  disposeBusSubscription: () => void
}

export interface ImageEditLiveSessionV3 {
  sessionId: string
  documentId: string
  bus: ImageEditCommandBusV3
}

export interface ImageEditLiveLayerLocationV3 {
  layer: ImageEditLayerV3
  parentId: string | null
  index: number
  ancestors: ImageEditGroupLayerV3[]
}

const sessionsByDocumentId = new Map<string, LiveSessionRecordV3>()
const listeners = new Set<() => void>()
let revision = 0

function emitChange(): void {
  revision += 1
  for (const listener of listeners) listener()
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

/**
 * 只登记当前命令总线的轻量句柄。文档与像素始终由总线/资源库持有，这里不复制任何真相。
 */
export function registerImageEditV3LiveSession(
  sessionId: string,
  bus: ImageEditCommandBusV3,
): () => void {
  const documentId = bus.getSnapshot().document.id
  const registrationId = Symbol(sessionId)
  const previous = sessionsByDocumentId.get(documentId)
  previous?.disposeBusSubscription()
  let lastDocument = bus.getSnapshot().document
  const disposeBusSubscription = bus.subscribe((snapshot) => {
    const current = sessionsByDocumentId.get(documentId)
    if (current?.registrationId !== registrationId || snapshot.document === lastDocument) return
    lastDocument = snapshot.document
    emitChange()
  })
  sessionsByDocumentId.set(documentId, {
    registrationId,
    sessionId,
    bus,
    disposeBusSubscription,
  })
  emitChange()
  return () => {
    const current = sessionsByDocumentId.get(documentId)
    if (current?.registrationId !== registrationId) return
    current.disposeBusSubscription()
    sessionsByDocumentId.delete(documentId)
    emitChange()
  }
}

export function listImageEditV3LiveSessions(): ImageEditLiveSessionV3[] {
  return [...sessionsByDocumentId.entries()].map(([documentId, record]) => ({
    sessionId: record.sessionId,
    documentId,
    bus: record.bus,
  }))
}

export function requireImageEditV3LiveSession(documentId: string): ImageEditLiveSessionV3 {
  const record = sessionsByDocumentId.get(documentId)
  if (!record) throw new Error('NOT_FOUND：目标 V3 图片文档当前未在编辑器中打开。')
  return { sessionId: record.sessionId, documentId, bus: record.bus }
}

export function getImageEditV3LiveRevision(): number {
  return revision
}

export function subscribeImageEditV3LiveSessions(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
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
