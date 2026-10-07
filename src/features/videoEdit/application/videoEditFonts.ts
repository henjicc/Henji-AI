import type { VideoEditComposition, VideoEditDocument } from '@/core/videoEdit/document'
import { collectVideoEditFonts, missingVideoEditFonts, type VideoEditFontUse } from '@/core/videoEdit/fonts'
import type { CodeMaterialMetadataReader } from '@/core/videoEdit/codeMaterialDocument'
import { codeMaterialSource } from '@/core/videoEdit/codeMaterialDocument'
import { fontLibrarySnapshot, loadFontLibrary, prepareFontPayloads, validateFontName, type FontPayload } from '@/platform/fonts'
import { compileVideoEditCode } from './videoEditCodeState'
import { createLogger } from '@/core/logging'
import { GENERIC_FONT_FACES } from '@/core/fonts/catalog'
const logger = createLogger('features.videoEdit.fonts')
export async function videoEditFontUses(document: VideoEditDocument | VideoEditComposition): Promise<VideoEditFontUse[]> {
  const metadata = new Map<string, Awaited<ReturnType<typeof compileVideoEditCode>>>()
  const read: CodeMaterialMetadataReader = instance => metadata.get(instance.versionId)!
  // Collect only font parameter declarations; compile through the existing cached compiler worker.
  const codes = [...document.items.flatMap(item => item.code ? [item.code] : []), ...('clips' in document ? [document, ...(document.sequences ?? [])] : document.sequences).flatMap(sequence => sequence.clips.flatMap(clip => [...(clip.code ? [clip.code] : []), ...(clip.effects ?? []).flatMap(effect => effect.code ? [effect.code] : [])]))]
  for (const instance of codes) if (!metadata.has(instance.versionId)) metadata.set(instance.versionId, await compileVideoEditCode(codeMaterialSource(document, instance).source))
  return collectVideoEditFonts(document, read)
}
export async function prepareVideoEditFonts(document: VideoEditDocument | VideoEditComposition): Promise<FontPayload[]> {
  const uses = await videoEditFontUses(document)
  if (uses.every(use => GENERIC_FONT_FACES.some(face => face.family === use.font))) return []
  await loadFontLibrary()
  const missing = missingVideoEditFonts(uses, fontLibrarySnapshot().faces)
  if (missing.length) logger.warn('剪辑中有字体缺失，将使用系统无衬线字体', { event: 'video_edit.fonts.missing', context: { documentId: document.id, fonts: missing } })
  return prepareFontPayloads([...new Set(uses.map(use => use.font))])
}
/** Validate only newly written names. Existing missing fonts remain inspectable and editable. */
export function changedVideoEditFonts(before: VideoEditDocument, next: VideoEditDocument, readBefore: CodeMaterialMetadataReader, readNext = readBefore): VideoEditFontUse[] {
  const previous = new Map(collectVideoEditFonts(before, readBefore).map(use => [use.ownerId, use.font]))
  return collectVideoEditFonts(next, readNext).filter(use => previous.get(use.ownerId) !== use.font)
}
export function validateVideoEditFontChanges(before: VideoEditDocument, next: VideoEditDocument, readBefore: CodeMaterialMetadataReader, readNext = readBefore): void {
  for (const use of changedVideoEditFonts(before, next, readBefore, readNext)) validateFontName(use.font)
}
