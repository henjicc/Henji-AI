import { imageEditOutputSizeV3, createImageEditIdV3, type ImageEditDocumentV3, type ImageEditLayerV3 } from '@/core/imageEdit/v3'
import type { ImageEditorV3ResourceDescriptor } from '@/platform/contracts/imageEditorV3'
import type { ImageEditorV3PackageThumbnailSnapshot } from '../editor/types'
import type { ImageEditorViewportCompositeClientV3 } from './viewportCompositeClientV3'
import type { ImageEditorPreviewClientV3 } from './imageEditorPreviewClientV3'
import { acquireImageEditorSessionResourceBudgetV3 } from './imageEditorSessionResourceBudgetV3'
import { acquireImageEditorResourceLeaseV3 } from './imageEditorResourcePressureV3'

export async function renderImageEditorThumbnailV3(
  client: Pick<ImageEditorViewportCompositeClientV3, 'render'>,
  createSourcelessClient: () => Pick<ImageEditorPreviewClientV3, 'render' | 'dispose'>,
  document: ImageEditDocumentV3,
  resourceDescriptors: readonly ImageEditorV3ResourceDescriptor[],
  signal: AbortSignal,
  sessionId = document.id,
): Promise<ImageEditorV3PackageThumbnailSnapshot> {
  const hasSource = (layers: readonly ImageEditLayerV3[]): boolean => layers.some((layer) =>
    layer.type === 'group' ? hasSource(layer.children) : layer.type === 'raster' && layer.source.kind === 'resource')
  if (hasSource(document.layers)) return renderImageEditorViewportThumbnailV3(client, document, resourceDescriptors, signal, sessionId)
  // 无图片资源时不存在独立源几何；保留原空画笔/纯标注能力。两路只分流一次，永不互相 fallback。
  signal.throwIfAborted()
  const plain = createSourcelessClient()
  const onAbort = (): void => plain.dispose()
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    const result = await plain.render({ document, resourceDescriptors, quality: 'stable', maxDimension: 512 })
    try {
      signal.throwIfAborted()
      if (!result.thumbnail) throw new Error('未生成图片缩略图')
      const { bytes, mediaType } = result.thumbnail
      return { documentId: document.id, revision: document.revision, bytes: bytes.slice(0), mediaType,
        extension: mediaType === 'image/webp' ? 'webp' : 'png' }
    } finally { result.release() }
  } finally { signal.removeEventListener('abort', onAbort); plain.dispose() }
}

/** 仅拼接已经合成的成品瓦片；图层、原图几何及效果全部交给唯一 viewport 内核。 */
export async function renderImageEditorViewportThumbnailV3(
  client: Pick<ImageEditorViewportCompositeClientV3, 'render'>,
  document: ImageEditDocumentV3,
  resourceDescriptors: readonly ImageEditorV3ResourceDescriptor[],
  signal: AbortSignal,
  sessionId = document.id,
): Promise<ImageEditorV3PackageThumbnailSnapshot> {
  signal.throwIfAborted()
  const size = imageEditOutputSizeV3(document.geometry)
  const zoom = Math.min(1, 512 / Math.max(size.width, size.height))
  const width = Math.max(1, Math.round(size.width * zoom)), height = Math.max(1, Math.round(size.height * zoom))
  const result = await client.render({
    document, resourceDescriptors, quality: 'stable', renderGeneration: document.revision,
    cameraSequence: 0, geometryHash: JSON.stringify(document.geometry), viewportKey: 'thumbnail',
    viewport: { documentX: 0, documentY: 0, width, height, zoom, devicePixelRatio: 1 },
    coverage: 'document', phase: 'target', analysisRequested: true,
    preferredMip: Math.max(0, Math.floor(Math.log2(1 / zoom))),
    overscanViewports: 0, forwardPrefetchViewports: 0,
  })
  const sessionBudget = acquireImageEditorSessionResourceBudgetV3(sessionId, { consumerId: createImageEditIdV3('thumbnail-encoding') })
  let encodingLease: ReturnType<typeof acquireImageEditorResourceLeaseV3> | undefined
  try {
    signal.throwIfAborted()
    // 成品位图由 viewport 持有；另外登记受限 Canvas2D、编码与 ArrayBuffer 的峰值。
    encodingLease = acquireImageEditorResourceLeaseV3(sessionBudget.budget, 'viewport-composite', 'in-flight', width * height * 4 * 3, 'lower-mip')
    const surface = new OffscreenCanvas(width, height)
    const context = surface.getContext('2d')
    if (!context) throw new Error('无法生成图片缩略图')
    const scaleX = width / size.width * 2 ** result.mip, scaleY = height / size.height * 2 ** result.mip
    for (const { bitmap, outputRect } of result.tiles) {
      context.drawImage(bitmap, outputRect.x * scaleX, outputRect.y * scaleY,
        outputRect.width * scaleX, outputRect.height * scaleY)
    }
    const blob = await surface.convertToBlob({ type: 'image/webp', quality: 0.85 })
    const bytes = await blob.arrayBuffer()
    signal.throwIfAborted()
    return { documentId: document.id, revision: document.revision, bytes,
      mediaType: blob.type === 'image/webp' ? 'image/webp' : 'image/png',
      extension: blob.type === 'image/webp' ? 'webp' : 'png' }
  } finally { encodingLease?.release(); sessionBudget.release(); result.release() }
}
