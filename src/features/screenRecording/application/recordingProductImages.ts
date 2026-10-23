import { ingestImageEditorV3Source, saveImageEditorV3Document, loadImageEditorV3Document } from '@/commands/imageEditorV3'
import { createImageEditDocumentV3, createImageEditRasterLayerV3, createImageEditTextLayerV3, createImageEditPathLayerV3 } from '@/core/imageEdit/v3/documentFactory'
import { defaultTextStyle, layoutRichText, rectanglePath, type RichTextContent } from '@/core/imaging/vectorContent'
import { BLACK_HEX, WHITE_HEX } from '@/core/theme/colorTokens'
import type { RecordingProductStep } from '@/core/screenRecording/products'
import { createImageDocument, prepareImageEditSourceLocatorV3 } from '@/features/imageEdit'

/** Formal image-document resources and vector text, never a private tutorial file format. */
export async function createRecordingStepImageDocument(step: RecordingProductStep, path: string, signal: AbortSignal): Promise<string> {
  const resource = await ingestImageEditorV3Source({ requestId: crypto.randomUUID(), source: await prepareImageEditSourceLocatorV3(path) }, signal)
  signal.throwIfAborted()
  const width = 1024, imageHeight = Math.round(resource.metadata.height * 960 / resource.metadata.width)
  const ctx = new OffscreenCanvas(1, 1).getContext('2d')!
  const text = (value: string, fontSize: number, y: number): RichTextContent => ({ paragraphs: [{ runs: [{ text: value, style: { ...defaultTextStyle(720), fontSize, fill: { enabled: true, color: BLACK_HEX } } }], align: 'left', direction: 'auto', spaceBefore: 0, spaceAfter: 0 }], box: { x: 32, y, width: 960, height: 0 } })
  const title = text(step.title, 32, 24)
  const measure = (value: string, font: string): number => { ctx.font = font; return ctx.measureText(value).width }
  const heightOf = (value: RichTextContent): number => Math.ceil(layoutRichText(value, measure, { sourceVersion: 'recording-step', time: { kind: 'static' }, referenceGrid: { width, height: 720 }, quality: 'final' }).height)
  const imageY = 40 + heightOf(title)
  const description = text(step.description, 24, imageY + imageHeight + 24)
  const height = Math.ceil(description.box.y + heightOf(description) + 32)
  const document = createImageEditDocumentV3({ width, height })
  const background = createImageEditPathLayerV3(crypto.randomUUID(), '背景', 'shape', { operands: [{ path: rectanglePath(0, 0, width, height), operation: 'replace' }], paint: { fill: { enabled: true, color: WHITE_HEX }, strokes: [], shadows: [] } })
  const image = createImageEditRasterLayerV3(crypto.randomUUID(), step.title, resource.resource.resourceRef)
  const scale = 960 / resource.metadata.width
  image.transform = [scale, 0, 0, scale, 32, imageY]
  document.layers = [background, image, createImageEditTextLayerV3(crypto.randomUUID(), '步骤标题', title), createImageEditTextLayerV3(crypto.randomUUID(), '步骤说明', description)]
  await saveImageEditorV3Document({ requestId: crypto.randomUUID(), document, expectedRevision: 0, resourceRefs: [resource.resource.resourceRef] }, signal)
  // Creation publishes the standard .hjimg package; thereafter cancellation must preserve it.
  const handle = await createImageDocument({ documentId: document.id, emptyUntilRevision: null })
  const read = await loadImageEditorV3Document({ requestId: crypto.randomUUID(), documentRef: `image-edit-v3:${document.id}` })
  if (!read || read.document.layers.length !== 4 || read.document.id !== handle.id) throw new Error('图片文档已保留，但回读校验失败，请从作品列表核对。')
  return handle.id
}
