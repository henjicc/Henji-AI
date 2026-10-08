import { addressCodeMaterialFiles, normalizeCodeMaterialFiles } from '@/core/videoEdit/codeMaterial/sources'
import { compileVideoEditCode } from './videoEditCodeState'
import { trialVideoEditCodeFrames } from './videoEditCodeTrial'
import { createVideoEditSequence, videoEditComposition, type VideoEditDocument } from '@/core/videoEdit/document'
import { makeVideoEditItemClip } from '@/core/videoEdit/projectItems'
import type { StyleKit } from '@/core/videoEdit/styleKit'
import { createLogger } from '@/core/logging'
import { resizeCodeMaterialCanvas } from '@/core/videoEdit/codeElementBake'
import { runVideoEditPreviewTask } from './videoEditPreviewTask'
const logger = createLogger('features.videoEdit.styleKits')
export async function renderStyleKitPreview(kit: StyleKit, sampleId: string, size: { width: number; height: number }, signal: AbortSignal): Promise<Blob> {
  const context = { kitId: kit.id, sampleId, ...size }; const started = performance.now()
  logger.debug('风格预览开始', { event: 'style_kit.preview.start', context })
  try {
    const blob = await runVideoEditPreviewTask(signal, '风格预览等待过久，请重试。', active => render(kit, sampleId, size, active))
    logger.debug('风格预览完成', { event: 'style_kit.preview.completed', context: { ...context, durationMs: performance.now() - started } })
    return blob
  } catch (error) {
    logger[signal.aborted ? 'debug' : 'warn']('风格预览未完成', { event: 'style_kit.preview.failed', error, context: { ...context, cancelled: signal.aborted, durationMs: performance.now() - started } })
    throw error
  }
}
async function render(kit: StyleKit, sampleId: string, size: { width: number; height: number }, signal: AbortSignal): Promise<Blob> {
  const sample = kit.samples.find(value => value.id === sampleId); if (!sample) throw new Error('风格组件不存在。')
  const files = normalizeCodeMaterialFiles(sample.source)
  const source = { ...files, files: { ...files.files, [files.entry]: resizeCodeMaterialCanvas(files.files[files.entry], size) } }
  const { codeSources, ...manifest } = await addressCodeMaterialFiles(source)
  const program = await compileVideoEditCode(source, signal); signal.throwIfAborted()
  if (program.kind !== 'generator' || program.languageVersion !== 3) throw new Error('风格组件需使用 v3 生成器。')
  const versionId = crypto.randomUUID(); const definitionId = crypto.randomUUID(); const itemId = crypto.randomUUID()
  const sequence = { ...createVideoEditSequence('风格预览'), ...size, styleKitId: kit.id }
  const code = { definitionId, versionId, parameters: {} }
  const document: VideoEditDocument = { format: 'henji-video-project', version: 2, id: crypto.randomUUID(), name: '风格预览', revision: 0, media: [], bins: [], items: [{ id: itemId, name: sample.name, kind: 'code', code }], sequences: [sequence], codeSources, styleKits: [kit], codeMaterials: [{ id: definitionId, name: sample.name, defaultVersionId: versionId, versions: [{ id: versionId, ...manifest, apiVersion: 1, languageVersion: 3 }] }] }
  sequence.clips = [makeVideoEditItemClip(document, itemId, sequence.id, { frame: 0 }, () => program)]
  const frame = Math.min(sequence.clips[0].duration - 1, Math.round(Math.min(program.durationSeconds / 2, .15 + kit.tokens.motion.enterDuration) * sequence.frameRate.numerator / sequence.frameRate.denominator))
  const bitmap = await trialVideoEditCodeFrames([{ document: videoEditComposition(document, sequence.id), frame }], signal, true)
  if (!bitmap) throw new Error('风格预览没有返回画面。')
  let canvas: OffscreenCanvas
  try {
    signal.throwIfAborted()
    const width = Math.min(640, bitmap.width)
    canvas = new OffscreenCanvas(width, Math.max(1, Math.round(bitmap.height * width / bitmap.width)))
    const context = canvas.getContext('2d'); if (!context) throw new Error('无法生成风格预览。')
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  } finally { bitmap.close() }
  const blob = await canvas.convertToBlob({ type: 'image/png' }); signal.throwIfAborted()
  return blob
}
