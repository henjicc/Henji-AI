import { SEMANTIC_IMAGE_LONG_EDGE, scaleSemanticVisual, type SemanticIntentImage } from '@/core/creativeIntent/semanticIntentInput'
import type { VisualEvidence } from '@/core/creativeIntent/schema'

/** Browser's native image codecs; only bytes read through the owning document's managed resource port. */
export async function prepareSemanticImage(bytes: Uint8Array, visual: VisualEvidence): Promise<SemanticIntentImage> {
  const bitmap = await createImageBitmap(new Blob([Uint8Array.from(bytes)]))
  try {
    const rect = visual.frames.length === 1 ? visual.frames[0].attachmentRect : [0, 0, ...visual.size]
    const sx = bitmap.width / visual.size[0], sy = bitmap.height / visual.size[1]
    const [x, y, w, h] = [rect[0] * sx, rect[1] * sy, rect[2] * sx, rect[3] * sy]
    if (w <= 0 || h <= 0 || x < 0 || y < 0 || x + w > bitmap.width + .5 || y + h > bitmap.height + .5) throw new Error('历史附图裁切范围无效，请手动确认指代。')
    const scale = Math.min(1, SEMANTIC_IMAGE_LONG_EDGE / Math.max(w, h))
    const width = Math.max(1, Math.round(w * scale)), height = Math.max(1, Math.round(h * scale))
    const canvas = new OffscreenCanvas(width, height), context = canvas.getContext('2d')
    if (!context) throw new Error('图片编码不可用，请手动确认指代。')
    context.drawImage(bitmap, x, y, w, h, 0, 0, width, height)
    const encoded = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/jpeg', quality: .8 })).arrayBuffer())
    let binary = ''
    for (let offset = 0; offset < encoded.length; offset += 8192) binary += String.fromCharCode(...encoded.subarray(offset, offset + 8192))
    const cropped = { ...visual, size: [width, height] as [number, number], frames: visual.frames.map(frame => ({ ...frame,
      attachmentRect: [(frame.attachmentRect[0] - rect[0]) * width / rect[2], (frame.attachmentRect[1] - rect[1]) * height / rect[3],
        frame.attachmentRect[2] * width / rect[2], frame.attachmentRect[3] * height / rect[3]] as [number, number, number, number] })) }
    return { mimeType: 'image/jpeg', data: btoa(binary), manifest: scaleSemanticVisual(cropped, width, height) }
  } finally { bitmap.close() }
}
