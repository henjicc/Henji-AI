import { jsonEqual } from '@/core/jsonEqual'
import { CODE_SOURCE_REVERIFY_MS, loadCodeSourceReferences } from '@/core/videoEdit/codeMaterial/sources'
import type { VideoEditComposition, VideoEditDocument } from '@/core/videoEdit/document'
import { collectVideoEditFonts, missingVideoEditFonts, type VideoEditFontUse } from '@/core/videoEdit/fonts'
import type { CodeMaterialMetadataReader } from '@/core/videoEdit/codeMaterialDocument'
import { codeMaterialSource, codeMaterialVersion } from '@/core/videoEdit/codeMaterialDocument'
import { fontLibrarySnapshot, loadFontLibrary, prepareFontPayloads, validateFontName, type FontPayload } from '@/platform/fonts'
import { compileVideoEditCode, VideoEditCodeVersionUnreadable } from './videoEditCodeState'
import { mapWithConcurrency } from '@/utils/mapWithConcurrency'
import { initializeVideoEditCodeSourceRuntime } from './videoEditCodeSourceRuntime'
import { createLogger } from '@/core/logging'
import { GENERIC_FONT_FACES } from '@/core/fonts/catalog'
import { videoEditEffectCodes } from '@/core/videoEdit/compositing'
const logger = createLogger('features.videoEdit.fonts')
export async function videoEditFontUses(document: VideoEditDocument | VideoEditComposition): Promise<VideoEditFontUse[]> {
  initializeVideoEditCodeSourceRuntime()
  const metadata = new Map<string, Awaited<ReturnType<typeof compileVideoEditCode>>>()
  const read: CodeMaterialMetadataReader = instance => metadata.get(instance.versionId)!
  // 只读取传入范围内的字体声明，与参数面板共用按源码内容缓存的元数据。
  const codes = [...document.items.flatMap(item => item.code ? [item.code] : []), ...('clips' in document ? [document, ...(document.sequences ?? [])] : document.sequences).flatMap(sequence => sequence.clips.flatMap(clip => [...(clip.code ? [clip.code] : []), ...(clip.effects ?? []).flatMap(effect => effect.code ? [effect.code] : [])]))]
  const unique = [...new Map(codes.map(instance => [instance.versionId, instance])).values()]
  const programs = await mapWithConcurrency(unique, 4, async instance => {
    await loadCodeSourceReferences(codeMaterialVersion(document, instance), { reuseVerifiedWithinMs: CODE_SOURCE_REVERIFY_MS })
    return [instance.versionId, await compileVideoEditCode(codeMaterialSource(document, instance).compilation)] as const
  })
  for (const [versionId, program] of programs) metadata.set(versionId, program)
  return collectVideoEditFonts(document, read)
}
export async function prepareVideoEditFonts(document: VideoEditDocument | VideoEditComposition): Promise<FontPayload[]> {
  const startedAt = performance.now()
  const uses = await videoEditFontUses(document)
  const usesMs = performance.now() - startedAt
  if (uses.every(use => GENERIC_FONT_FACES.some(face => face.family === use.font))) {
    logger.info('剪辑字体准备完成', { event: 'video_edit.fonts.prepared', context: { documentId: document.id, usesMs, fonts: 0 } })
    return []
  }
  await loadFontLibrary()
  const libraryMs = performance.now() - startedAt - usesMs
  const missing = missingVideoEditFonts(uses, fontLibrarySnapshot().faces)
  if (missing.length) logger.warn('剪辑中有字体缺失，将使用系统无衬线字体', { event: 'video_edit.fonts.missing', context: { documentId: document.id, fonts: missing } })
  const payloads = await prepareFontPayloads([...new Set(uses.map(use => use.font))])
  logger.info('剪辑字体准备完成', { event: 'video_edit.fonts.prepared', context: { documentId: document.id, usesMs, libraryMs, payloadMs: performance.now() - startedAt - usesMs - libraryMs, fonts: payloads.length } })
  return payloads
}
/** Validate only newly written names. Existing missing fonts remain inspectable and editable. */
export function changedVideoEditFonts(before: VideoEditDocument, next: VideoEditDocument, readBefore: CodeMaterialMetadataReader, readNext = readBefore): VideoEditFontUse[] {
  // 只读本次改动涉及的对象，避免改普通片段时顺带读取全工程代码参数。
  const signature = (value: VideoEditDocument['items'][number] | VideoEditDocument['sequences'][number]['clips'][number]): unknown[] => [value.code, value.graphic, 'textStyle' in value ? value.textStyle : undefined, 'effects' in value ? videoEditEffectCodes(value.effects) : []]
  const old = new Map([...before.items, ...before.sequences.flatMap(sequence => sequence.clips)].map(value => [value.id, value]))
  const changed = new Set([...next.items, ...next.sequences.flatMap(sequence => sequence.clips)].filter(value => old.get(value.id) !== value && (!old.has(value.id) || !jsonEqual(signature(old.get(value.id)!), signature(value)))).map(value => value.id))
  const previousSequences = new Map(before.sequences.map(sequence => [sequence.id, sequence]))
  const captionFonts = (sequence: VideoEditDocument['sequences'][number] | undefined): unknown[] => (sequence?.captions ?? []).map(caption => [caption.id, caption.style ? caption.style.fontFamily : 'sans-serif'])
  const changedCaptions = new Set(next.sequences.filter(sequence => {
    const previous = previousSequences.get(sequence.id)
    return previous?.captions !== sequence.captions && !jsonEqual(captionFonts(previous), captionFonts(sequence))
  }).map(sequence => sequence.id))
  if (!changed.size && !changedCaptions.size) return []
  const scope = (document: VideoEditDocument): VideoEditDocument => ({ ...document, items: document.items.filter(item => changed.has(item.id)), sequences: document.sequences.map(sequence => ({ ...sequence, clips: sequence.clips.filter(clip => changed.has(clip.id)), captions: changedCaptions.has(sequence.id) ? sequence.captions : undefined })) })
  // 换版本时原版本可能已读不到（源码缺失或编译不过）：当作原先没有代码字体，新字体全部按新增核对。
  const tolerantBefore: CodeMaterialMetadataReader = instance => {
    try { return readBefore(instance) }
    catch (error) { if (error instanceof VideoEditCodeVersionUnreadable) return { name: '', kind: 'generator', mode: 'static', seed: 0, parameters: [] }; throw error }
  }
  const previous = new Map(collectVideoEditFonts(scope(before), tolerantBefore).map(use => [use.ownerId, use.font]))
  return collectVideoEditFonts(scope(next), readNext).filter(use => previous.get(use.ownerId) !== use.font)
}
export function validateVideoEditFontChanges(before: VideoEditDocument, next: VideoEditDocument, readBefore: CodeMaterialMetadataReader, readNext = readBefore): void {
  for (const use of changedVideoEditFonts(before, next, readBefore, readNext)) validateFontName(use.font)
}
