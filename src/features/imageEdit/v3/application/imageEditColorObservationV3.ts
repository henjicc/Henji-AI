import { imageEditOutputSizeV3, createImageEditIdV3, type ImageEditDocumentV3, type ImageEditLayerV3 } from '@/core/imageEdit/v3'
import { computeColorStatistics, type ColorStatistics } from '@/core/imaging/adjustments/colorStatistics'
import { suggestColorGradeAutoColor } from '@/core/imaging/adjustments/autoGrade'
import { createLogger } from '@/core/logging'
import type { ImageEditorV3ResourceDescriptor } from '@/platform/contracts/imageEditorV3'
import { ImageEditorViewportCompositeClientV3 } from '../execution/viewportCompositeClientV3'
import { findImageEditV3LiveLayer } from './imageEditDocumentRefs'
import { readImageEditDocumentInstanceV3, requireImageEditDocumentInstanceV3 } from './imageEditDocumentInstances'

const logger = createLogger('features.imageEdit.color_observation')
export type ImageEditColorObservationStage = 'before_grade' | 'document'
export interface ImageEditColorObservation { statistics: ColorStatistics; stage: ImageEditColorObservationStage; revision: number }
export type ImageEditColorPixelReader = (document: ImageEditDocumentV3, resources: readonly ImageEditorV3ResourceDescriptor[], signal: AbortSignal) => Promise<{ pixels: Uint8ClampedArray; width: number; height: number }>

/** `before_grade` hides the target color grade layer only; layers below and above keep rendering as in the document. */
export function projectImageEditColorObservationDocumentV3(document: ImageEditDocumentV3, layerId: string | undefined, stage: ImageEditColorObservationStage): ImageEditDocumentV3 {
  if (stage === 'document') return document
  if (!layerId) throw new Error('调色前读数需要指定一个全能调色调整层')
  const location = findImageEditV3LiveLayer(document, layerId)
  // A color grade is either its own adjustment layer or an adjustment filter on a layer (filter id); both switch off the same way.
  const isFilter = (layer: ImageEditLayerV3): boolean => layer.filters.some(filter => filter.id === layerId && filter.operationType === 'adjustment' && filter.effectId === 'color_grade')
  const contains = (layers: readonly ImageEditLayerV3[]): boolean => layers.some(layer => isFilter(layer) || layer.type === 'group' && contains(layer.children))
  const isLayer = location?.layer.type === 'adjustment' && location.layer.adjustmentId === 'color_grade'
  if (!isLayer && !contains(document.layers)) throw new Error('请指定一个全能调色调整层')
  const hide = (layers: readonly ImageEditLayerV3[]): ImageEditLayerV3[] => layers.map(layer => {
    if (isLayer && layer.id === layerId) return { ...layer, visible: false }
    const next = isFilter(layer) ? { ...layer, filters: layer.filters.map(filter => filter.id === layerId ? { ...filter, enabled: false } : filter) } : layer
    return next.type === 'group' ? { ...next, children: hide(next.children) } : next
  })
  return { ...document, layers: hide(document.layers) }
}

/** The composited document at ≤256 px through the same viewport kernel as thumbnails (never the display queue). */
export const readImageEditColorPixelsV3: ImageEditColorPixelReader = async (document, resources, signal) => {
  const client = new ImageEditorViewportCompositeClientV3({ sessionId: document.id, purpose: 'thumbnail', resourceBudgetConsumerId: createImageEditIdV3('color-observation') })
  try {
    const size = imageEditOutputSizeV3(document.geometry)
    const zoom = Math.min(1, 256 / Math.max(size.width, size.height))
    const width = Math.max(1, Math.round(size.width * zoom)); const height = Math.max(1, Math.round(size.height * zoom))
    const result = await client.render({
      document, resourceDescriptors: resources, quality: 'stable', renderGeneration: document.revision,
      cameraSequence: 0, geometryHash: JSON.stringify(document.geometry), viewportKey: 'color-observation',
      viewport: { documentX: 0, documentY: 0, width, height, zoom, devicePixelRatio: 1 },
      coverage: 'document', phase: 'target', analysisRequested: true,
      preferredMip: Math.max(0, Math.floor(Math.log2(1 / zoom))), overscanViewports: 0, forwardPrefetchViewports: 0,
    })
    try {
      signal.throwIfAborted()
      const surface = new OffscreenCanvas(width, height); const context = surface.getContext('2d')
      if (!context) throw new Error('无法读取图片颜色')
      const scaleX = width / size.width * 2 ** result.mip, scaleY = height / size.height * 2 ** result.mip
      for (const { bitmap, outputRect } of result.tiles) context.drawImage(bitmap, outputRect.x * scaleX, outputRect.y * scaleY, outputRect.width * scaleX, outputRect.height * scaleY)
      return { pixels: context.getImageData(0, 0, width, height).data, width, height }
    } finally { result.release() }
  } finally { client.dispose() }
}

/** Read-only color readout of the current image document (or the image beneath one color grade layer). */
export async function observeImageEditColorV3(documentId: string, options: { layerId?: string; stage?: ImageEditColorObservationStage; scopes?: boolean; signal?: AbortSignal; reader?: ImageEditColorPixelReader } = {}): Promise<ImageEditColorObservation> {
  const signal = options.signal ?? new AbortController().signal
  const { bus } = requireImageEditDocumentInstanceV3(documentId)
  const start = bus.getSnapshot().document
  const stage = options.stage ?? 'document'
  const document = projectImageEditColorObservationDocumentV3(start, options.layerId, stage)
  const resources = readImageEditDocumentInstanceV3(documentId)?.resourceDescriptors ?? []
  logger.info('图片颜色读数开始', { event: 'image_edit.color.observe.start', context: { documentId, stage } })
  try {
    const sampled = await (options.reader ?? readImageEditColorPixelsV3)(document, resources, signal)
    if (bus.getSnapshot().document.revision !== start.revision) throw new Error('图片已变化，请重新读取颜色')
    const statistics = computeColorStatistics(sampled.pixels, sampled.width, sampled.height, { scopes: options.scopes })
    logger.info('图片颜色读数完成', { event: 'image_edit.color.observe.completed', context: { documentId, stage } })
    return { statistics, stage, revision: start.revision }
  } catch (error) { logger.warn('图片颜色读数失败', { event: 'image_edit.color.observe.failed', error, context: { documentId } }); throw error }
}

/**
 * Automatic correction for one color grade layer: analyzes the picture beneath that layer (the layer hidden) and returns
 * absolute slider values for white balance and exposure. The caller merges them into the layer's params in one write.
 */
export async function suggestImageEditColorV3(document: ImageEditDocumentV3, layerId: string, resources: readonly ImageEditorV3ResourceDescriptor[], signal: AbortSignal, reader: ImageEditColorPixelReader = readImageEditColorPixelsV3): Promise<Record<string, number>> {
  const projected = projectImageEditColorObservationDocumentV3(document, layerId, 'before_grade')
  logger.info('图片自动校色开始', { event: 'image_edit.color.auto.start', context: { documentId: document.id, layerId } })
  try {
    const sampled = await reader(projected, resources, signal)
    const parameters = suggestColorGradeAutoColor(sampled.pixels, 255, sampled.width)
    logger.info('图片自动校色完成', { event: 'image_edit.color.auto.completed', context: { documentId: document.id, layerId } })
    return parameters
  } catch (error) { logger.warn('图片自动校色失败', { event: 'image_edit.color.auto.failed', error, context: { documentId: document.id } }); throw error }
}
