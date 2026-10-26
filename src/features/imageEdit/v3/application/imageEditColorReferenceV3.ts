import type { ApplicationRef } from '@/core/application-control/applicationCapabilities'
import { readDocument } from '@/commands/documents'
import { parseCanvasDocumentGraph } from '@/core/canvas/canvasDocumentGraph'
import { readFile } from '@/platform/desktopApi'
import { isLikelyLocalImagePath, toFetchableMediaUrl } from '@/services/imageSource'
import { resolveImageSource } from '../../application/imageSourceCapabilityService'
import { ensureImageEditDocumentInstanceV3 } from './imageEditDocumentLoading'
import { findImageEditDocumentInstanceV3, readImageEditDocumentInstanceV3 } from './imageEditDocumentInstances'
import { readImageEditColorPixelsV3, type ImageEditColorPixelReader } from './imageEditColorObservationV3'
import { splitImageEditV3DocumentRef } from './imageEditDocumentRefs'

/** 校色参考：本机图片文件（界面选择），或助手传入的稳定引用（素材、生成结果、编辑预览、画布节点、另一份图片文档）。 */
export type ImageEditColorReferenceV3 = { kind: 'file'; path: string } | { kind: 'ref'; ref: ApplicationRef }
export const IMAGE_EDIT_COLOR_REFERENCE_KINDS = ['asset', 'generation.result', 'image_edit.preview', 'canvas.node', 'image_edit.document'] as const

const SAMPLE_EDGE = 256

/** 与颜色读数同一尺度（长边 ≤256）的参考画面像素。 */
async function decodeReferenceImage(source: string, signal: AbortSignal): Promise<Uint8ClampedArray> {
  const blob = isLikelyLocalImagePath(source) ? new Blob([await readFile(source)]) : await (await fetch(toFetchableMediaUrl(source), { signal })).blob()
  signal.throwIfAborted()
  const bitmap = await createImageBitmap(blob).catch(() => { throw new Error('参考图片无法解码，请换一张常见格式的图片。') })
  try {
    const scale = Math.min(1, SAMPLE_EDGE / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale)); const height = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = new OffscreenCanvas(width, height); const context = canvas.getContext('2d')
    if (!context) throw new Error('无法读取参考图片颜色')
    context.drawImage(bitmap, 0, 0, width, height)
    return context.getImageData(0, 0, width, height).data
  } finally { bitmap.close() }
}

async function renderReferenceDocument(documentId: string, signal: AbortSignal, reader: ImageEditColorPixelReader): Promise<Uint8ClampedArray> {
  if (!findImageEditDocumentInstanceV3(documentId)) await ensureImageEditDocumentInstanceV3(documentId)
  const instance = readImageEditDocumentInstanceV3(documentId)
  if (!instance) throw new Error('参考图片文档无法打开')
  return (await reader(instance.document, instance.resourceDescriptors, signal)).pixels
}

/** 读取参考画面（≤256 px RGBA8）。图片文档按当前合成结果读取；不修改任何来源。 */
export async function readImageEditColorReferencePixelsV3(reference: ImageEditColorReferenceV3, signal: AbortSignal, reader: ImageEditColorPixelReader = readImageEditColorPixelsV3): Promise<Uint8ClampedArray> {
  if (reference.kind === 'file') return decodeReferenceImage(reference.path, signal)
  const { ref } = reference
  if (ref.kind === 'image_edit.document') return renderReferenceDocument(splitImageEditV3DocumentRef(ref).documentId, signal, reader)
  if (ref.kind === 'canvas.node') {
    const separator = ref.id.indexOf(':')
    if (separator < 1) throw new Error('请使用带画布归属的节点引用（画布ID:节点ID）。')
    const snapshot = await readDocument({ id: ref.id.slice(0, separator) })
    const node = parseCanvasDocumentGraph(snapshot.content, () => undefined).nodes.find(item => item.id === ref.id.slice(separator + 1))
    if (!node) throw new Error('参考节点已删除，请重新选择。')
    const session = node.data.imageEditSession
    if (session && typeof session === 'object' && 'documentRef' in session && typeof session.documentRef === 'string') return renderReferenceDocument(session.documentRef.replace(/^image-edit-v3:/, ''), signal, reader)
    if (typeof node.data.imageUrl !== 'string' || !node.data.imageUrl) throw new Error('参考节点还没有图片。')
    return decodeReferenceImage(node.data.imageUrl, signal)
  }
  if (!(IMAGE_EDIT_COLOR_REFERENCE_KINDS as readonly string[]).includes(ref.kind)) throw new Error(`参考引用只接受 ${IMAGE_EDIT_COLOR_REFERENCE_KINDS.join('、')}。`)
  return decodeReferenceImage((await resolveImageSource(ref)).source, signal)
}
