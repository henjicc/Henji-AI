import type { ImageEditorDiagnosticBundleRequest } from '@/core/logging/diagnosticBundle'
import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import type { ImageEditLayerV3 } from '@/core/imageEdit/v3/layerTypes'
import type { ImageEditorV3ResourceDescriptor } from '@/platform/contracts/imageEditorV3'
import type { ImageEditorHostProfileIdV3 } from '../application/imageEditorHostProfiles'

export function createImageEditorDiagnosticSummaryV3(
  document: ImageEditDocumentV3,
  host: ImageEditorHostProfileIdV3,
  resources: readonly ImageEditorV3ResourceDescriptor[],
): ImageEditorDiagnosticBundleRequest {
  const layers: ImageEditorDiagnosticBundleRequest['layers'] = {
    raster: 0,
    annotation: 0,
    effect: 0,
    adjustment: 0,
    group: 0,
    masked: 0,
    hidden: 0,
    locked: 0,
    annotationObjects: 0,
    effectIds: [],
  }
  const visit = (entries: readonly ImageEditLayerV3[]): void => {
    for (const layer of entries) {
      layers[layer.type] += 1
      if (layer.mask) layers.masked += 1
      if (!layer.visible) layers.hidden += 1
      if (layer.locked) layers.locked += 1
      if (layer.type === 'annotation') layers.annotationObjects += layer.annotations.length
      if (layer.type === 'effect') layers.effectIds.push(layer.effectId)
      if (layer.type === 'group') visit(layer.children)
    }
  }
  visit(document.layers)
  return {
    host,
    documentId: document.id,
    revision: document.revision,
    source: {
      mediaTypes: [...new Set(resources.map((resource) => resource.mediaType).filter(
        (value): value is string => Boolean(value),
      ))],
      width: document.geometry.width,
      height: document.geometry.height,
      byteLength: resources.reduce((total, resource) => total + resource.byteLength, 0),
    },
    layers,
  }
}
