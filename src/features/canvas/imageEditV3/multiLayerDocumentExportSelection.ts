import type { ApplicationRef } from '@/core/application-control'
import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import {
  imageEditV3AnnotationRef,
  imageEditV3GroupRef,
  imageEditV3LayerRef,
} from '@/features/imageEdit/v3/application/imageEditLiveSessionRegistry'
import type { ImageEditorAnnotationSelectionV3 } from '@/features/imageEdit/v3/store/imageEditorInteractionStoreV3'
import { findImageEditLayerLocationV3 } from '@/features/imageEdit/v3/editor/layerTreeV3'

export type MultiLayerDocumentExportTargetRef = ApplicationRef & {
  kind: 'image_edit.layer' | 'image_edit.group' | 'image_mark.annotation'
}

export type MultiLayerDocumentExportSelection =
  | { ready: true; targetRef: MultiLayerDocumentExportTargetRef; label: string }
  | { ready: false; reason: string }

export function resolveMultiLayerDocumentExportSelection(input: {
  document: ImageEditDocumentV3
  selectedLayerIds: readonly string[]
  annotationSelection?: ImageEditorAnnotationSelectionV3 | null
}): MultiLayerDocumentExportSelection {
  const bitDepth = input.document.color.bitDepth
  if (bitDepth === 'float16' || bitDepth === 'float32') {
    return { ready: false, reason: '浮点精度文档暂不支持导出到画布' }
  }
  if (input.document.color.hdrMetadata) {
    return { ready: false, reason: 'HDR 文档暂不支持导出到画布' }
  }
  if (input.selectedLayerIds.length !== 1) {
    return {
      ready: false,
      reason: input.selectedLayerIds.length === 0 ? '请先选择一个图层或元素' : '一次只能导出一个图层或元素',
    }
  }
  const location = findImageEditLayerLocationV3(input.document.layers, input.selectedLayerIds[0])
  if (!location) return { ready: false, reason: '所选图层已不存在，请重新选择' }
  const layer = location.layer
  if (layer.type === 'raster') {
    return {
      ready: true,
      targetRef: { ...imageEditV3LayerRef(input.document.id, layer.id), kind: 'image_edit.layer' },
      label: layer.name,
    }
  }
  if (layer.type === 'group') {
    return {
      ready: true,
      targetRef: { ...imageEditV3GroupRef(input.document.id, layer.id), kind: 'image_edit.group' },
      label: layer.name,
    }
  }
  if (layer.type === 'effect') {
    return { ready: false, reason: '效果层依赖其他图层，暂不支持单独导出' }
  }
  if (layer.type === 'adjustment') {
    return { ready: false, reason: '调整层依赖其他图层，暂不支持单独导出' }
  }
  const annotation = input.annotationSelection
  if (!annotation || annotation.layerId !== layer.id) {
    return { ready: false, reason: '请在标注图层中选择一个具体元素' }
  }
  const item = layer.annotations.find((candidate) => candidate.id === annotation.annotationId)
  if (!item) return { ready: false, reason: '所选标注元素已不存在，请重新选择' }
  return {
    ready: true,
    targetRef: {
      ...imageEditV3AnnotationRef(input.document.id, layer.id, item.id),
      kind: 'image_mark.annotation',
    },
    label: layer.name,
  }
}
