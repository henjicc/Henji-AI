import { compileVideoEditCode } from './videoEditCodeState'
import { trialVideoEditCodeFrames } from './videoEditCodeTrial'
import { createVideoEditSequence, videoEditComposition, type VideoEditDocument } from '@/core/videoEdit/document'
import { makeVideoEditItemClip } from '@/core/videoEdit/projectItems'
import type { StyleKit } from '@/core/videoEdit/styleKit'
import { createLogger } from '@/core/logging'
const logger = createLogger('features.videoEdit.styleKits')
export async function renderStyleKitPreview(kit: StyleKit, sampleId: string, size: { width: number; height: number }, signal: AbortSignal): Promise<Blob> {
  const sample = kit.samples.find(value => value.id === sampleId); if (!sample) throw new Error('风格组件不存在。')
  const source = sample.source.replace('width: 1920, height: 1080', `width: ${size.width}, height: ${size.height}`)
  const program = await compileVideoEditCode(source, signal); signal.throwIfAborted()
  if (program.kind !== 'generator' || program.languageVersion !== 3) throw new Error('风格组件需使用 v3 生成器。')
  const versionId = crypto.randomUUID(); const definitionId = crypto.randomUUID(); const itemId = crypto.randomUUID()
  const sequence = { ...createVideoEditSequence('风格预览'), ...size, styleKitId: kit.id }
  const code = { definitionId, versionId, parameters: {} }
  const document: VideoEditDocument = { format: 'henji-video-project', version: 2, id: crypto.randomUUID(), name: '风格预览', revision: 0, media: [], bins: [], items: [{ id: itemId, name: sample.name, kind: 'code', code }], sequences: [sequence], styleKits: [kit], codeMaterials: [{ id: definitionId, name: sample.name, defaultVersionId: versionId, versions: [{ id: versionId, source, apiVersion: 1, languageVersion: 3 }] }] }
  sequence.clips = [makeVideoEditItemClip(document, itemId, sequence.id, { frame: 0 }, () => program)]
  const frame = Math.min(sequence.clips[0].duration - 1, Math.round(Math.min(program.durationSeconds / 2, .15 + kit.tokens.motion.enterDuration) * sequence.frameRate.numerator / sequence.frameRate.denominator))
  const bitmap = await trialVideoEditCodeFrames([{ document: videoEditComposition(document, sequence.id), frame }], signal, true)
  if (!bitmap) throw new Error('风格预览没有返回画面。')
  try { signal.throwIfAborted(); const width = Math.min(640, bitmap.width); const canvas = new OffscreenCanvas(width, Math.max(1, Math.round(bitmap.height * width / bitmap.width))); const context = canvas.getContext('2d'); if (!context) throw new Error('无法生成风格预览。'); context.drawImage(bitmap, 0, 0, canvas.width, canvas.height); return await canvas.convertToBlob({ type: 'image/png' }) }
  catch (error) { if (!signal.aborted) logger.warn('style_kit.preview.failed', '风格预览失败', { error }); throw error }
  finally { bitmap.close() }
}
