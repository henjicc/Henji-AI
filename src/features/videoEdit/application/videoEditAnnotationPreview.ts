import { createLogger } from '@/core/logging'
import { videoEditComposition, type VideoEditComposition, type VideoEditDocument } from '@/core/videoEdit/document'
import { trialVideoEditCodeFrames } from './videoEditCodeTrial'
import { VideoEditPreviewQueue } from './videoEditPreviewTask'

const logger = createLogger('features.videoEdit.annotations')
const queue = new VideoEditPreviewQueue()
const inputs = new WeakMap<VideoEditDocument, Map<string, { key: string; composition: VideoEditComposition }>>()

/** Annotation status/thread changes do not change pixels. Share the key calculation across rows. */
export function videoEditAnnotationPreviewInput(document: VideoEditDocument, sequenceId: string): { key: string; composition: VideoEditComposition } {
  let sequences = inputs.get(document)
  if (!sequences) { sequences = new Map(); inputs.set(document, sequences) }
  let input = sequences.get(sequenceId)
  if (!input) {
    const composition = videoEditComposition(document, sequenceId)
    const key = JSON.stringify({ ...composition, revision: 0, annotations: [], sequences: composition.sequences?.map(sequence => ({ ...sequence, annotations: [] })) })
    input = { key, composition }; sequences.set(sequenceId, input)
  }
  return input
}

export async function renderVideoEditAnnotationPreview(composition: VideoEditComposition, frame: number, signal: AbortSignal): Promise<Blob> {
  const context = { sequenceId: composition.id, revision: composition.revision, frame }; const started = performance.now()
  logger.debug('批注缩略图开始', { event: 'video_edit.annotation_preview.start', context })
  try {
    const blob = await queue.run(signal, '取帧等待过久，请重试。', async active => {
      const bitmap = await trialVideoEditCodeFrames([{ document: composition, frame }], active, true)
      if (!bitmap) throw new Error('没有缩略帧。')
      let canvas: OffscreenCanvas
      try {
        active.throwIfAborted()
        canvas = new OffscreenCanvas(160, Math.max(1, Math.round(bitmap.height * 160 / bitmap.width)))
        const context = canvas.getContext('2d'); if (!context) throw new Error('无法生成缩略帧。')
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      } finally { bitmap.close() }
      const blob = await canvas.convertToBlob({ type: 'image/png' }); active.throwIfAborted()
      return blob
    })
    logger.debug('批注缩略图完成', { event: 'video_edit.annotation_preview.completed', context: { ...context, durationMs: performance.now() - started } })
    return blob
  } catch (error) {
    logger[signal.aborted ? 'debug' : 'warn']('批注缩略图未完成', { event: 'video_edit.annotation_preview.failed', error, context: { ...context, cancelled: signal.aborted, durationMs: performance.now() - started } })
    throw error
  }
}
