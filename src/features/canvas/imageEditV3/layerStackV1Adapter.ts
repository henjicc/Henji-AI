import { ingestImageEditorV3Source } from '@/commands/imageEditorV3'
import {
  createImageEditDocumentV3,
  createImageEditRasterLayerV3,
} from '@/core/imageEdit/v3/documentFactory'
import type { ImageEditColorModeV3 } from '@/core/imageEdit/v3/colorTypes'
import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import type { ImageEditRasterLayerV3 } from '@/core/imageEdit/v3/layerTypes'
import type { ImageEditorV3ResourceDescriptor } from '@/platform/contracts/imageEditorV3'
import {
  validateLayerStackDocument,
  type LayerStackDocumentV1,
  type LayerStackMediaResourceV1,
} from '../domain/layerStack'
import { createImageMarkV3ColorMode } from '@/features/imageMark/standalone/imageMarkV3Source'

export const CANVAS_EDIT_V3_LAYER_STACK_OPTION = 'layerStackDocumentV1'

export class LayerStackV1ImportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LayerStackV1ImportError'
  }
}

export interface ImportedLayerStackV1DocumentV3 {
  document: ImageEditDocumentV3
  resourceDescriptors: readonly ImageEditorV3ResourceDescriptor[]
}

interface ImportLayerStackV1Options {
  document: LayerStackDocumentV1
  documentId: string
  signal?: AbortSignal
  ingestSource?: typeof ingestImageEditorV3Source
}

function sameColorMode(left: ImageEditColorModeV3, right: ImageEditColorModeV3): boolean {
  return left.workingSpace === right.workingSpace
    && left.bitDepth === right.bitDepth
    && left.transferFunction === right.transferFunction
    && left.iccProfileResourceId === right.iccProfileResourceId
    && JSON.stringify(left.hdrMetadata) === JSON.stringify(right.hdrMetadata)
}

function requireReadyResource(
  resources: ReadonlyMap<string, LayerStackMediaResourceV1>,
  resourceId: string,
): LayerStackMediaResourceV1 {
  const resource = resources.get(resourceId)
  if (!resource || resource.status !== 'ready' || !resource.filePath) {
    throw new LayerStackV1ImportError(`图层资源不可用：${resourceId}`)
  }
  return resource
}

export function serializeLayerStackV1ForImageEditor(
  document: LayerStackDocumentV1,
): string {
  return JSON.stringify(validateLayerStackDocument(document))
}

export function readLayerStackV1ImageEditorOption(
  options: Readonly<DynamicValueMap>,
): LayerStackDocumentV1 | null {
  const raw = options[CANVAS_EDIT_V3_LAYER_STACK_OPTION]
  if (raw === undefined) return null
  if (typeof raw !== 'string') {
    throw new LayerStackV1ImportError('图层分离结果必须使用稳定 JSON 传入新版编辑器')
  }
  try {
    return validateLayerStackDocument(JSON.parse(raw) as LayerStackDocumentV1)
  } catch (error) {
    throw new LayerStackV1ImportError(
      error instanceof Error ? `图层分离结果无效：${error.message}` : '图层分离结果无效',
    )
  }
}

/**
 * LayerStackDocumentV1 永久保留读取，但编辑时只投影成 V3 栅格图层。
 * V1 像素资源互不共享，placement 尺寸与源尺寸一致，因此这里只需要平移矩阵。
 */
export async function importLayerStackV1AsImageEditDocumentV3(
  options: ImportLayerStackV1Options,
): Promise<ImportedLayerStackV1DocumentV3> {
  const source = validateLayerStackDocument(options.document)
  if (source.status !== 'ready') {
    throw new LayerStackV1ImportError('图层分离结果存在缺失资源，请先恢复资源后再编辑')
  }
  const ingest = options.ingestSource ?? ingestImageEditorV3Source
  const resources = new Map(source.resources.map((resource) => [resource.resourceId, resource]))
  const ordered = [...source.layers].sort((left, right) => left.order - right.order)
  const descriptors: ImageEditorV3ResourceDescriptor[] = []
  const layers: ImageEditRasterLayerV3[] = []
  let documentColor: ImageEditColorModeV3 | null = null

  for (const layer of ordered) {
    const legacyResource = requireReadyResource(resources, layer.resourceId)
    const managed = await ingest({
      requestId: `image-editor-v3:layer-stack:${options.documentId}:${layer.sourceOutputIndex}`,
      source: { kind: 'local-path', filePath: legacyResource.filePath as string },
    }, options.signal)
    if (
      managed.metadata.width !== layer.placement.width
      || managed.metadata.height !== layer.placement.height
    ) {
      throw new LayerStackV1ImportError(`图层资源尺寸已变化：${layer.name}`)
    }
    if (layer.role === 'content' && !managed.metadata.hasAlpha) {
      throw new LayerStackV1ImportError(`内容图层已丢失透明通道：${layer.name}`)
    }
    const color = createImageMarkV3ColorMode(managed.metadata)
    if (
      color.workingSpace !== 'srgb'
      || color.transferFunction !== 'srgb'
      || color.hdrMetadata !== null
    ) {
      throw new LayerStackV1ImportError(`V1 图层资源不再符合 sRGB 契约：${layer.name}`)
    }
    if (documentColor && !sameColorMode(documentColor, color)) {
      throw new LayerStackV1ImportError('V1 图层资源颜色契约不一致，不能无损合入同一 V3 文档')
    }
    documentColor = color
    descriptors.push(managed.resource)
    const raster = createImageEditRasterLayerV3(layer.layerId, layer.name, managed.resource.resourceRef)
    raster.visible = layer.visible
    raster.opacity = layer.opacity
    raster.blendMode = layer.blendMode
    raster.transform = [1, 0, 0, 1, layer.placement.x, layer.placement.y]
    layers.push(raster)
  }

  if (!documentColor || layers.length === 0) {
    throw new LayerStackV1ImportError('图层分离结果没有可导入的图层')
  }
  const document = createImageEditDocumentV3({
    width: source.canvas.width,
    height: source.canvas.height,
    documentId: options.documentId,
    color: documentColor,
  })
  document.layers = layers
  return { document, resourceDescriptors: descriptors }
}
