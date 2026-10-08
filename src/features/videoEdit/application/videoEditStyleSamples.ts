import { normalizeCodeMaterialFiles } from '@/core/videoEdit/codeMaterial/sources'
import { resizeCodeMaterialCanvas } from '@/core/videoEdit/codeElementBake'
import { styleKitSchema, type StyleKit } from '@/core/videoEdit/styleKit'
import { createVideoEditPlacedCodeItems } from './videoEditCodeService'
import { readVideoEditCodeMetadata } from './videoEditCodeState'
import { requireVideoEditInstance, setVideoEditView } from './videoEditService'
import { placeVideoEditDrop, type VideoEditDropPlacement } from './videoEditDrop'
import { createLogger } from '@/core/logging'
import { availableStyleKitFonts } from '@/core/videoEdit/styleKitPresets'
import { loadFontLibrary } from '@/platform/fonts'
const logger = createLogger('features.videoEdit.styleKits')
/** Compile/trial, snapshot binding and timeline insertion publish as one project edit. */
export async function insertVideoEditStyleSample(projectId: string, sequenceId: string, kit: StyleKit, sampleId: string, placement?: VideoEditDropPlacement, signal?: AbortSignal): Promise<string[]> {
  const owner = requireVideoEditInstance(projectId); const sequence = owner.document.sequences.find(value => value.id === sequenceId)
  const baseline = owner.document
  const checked = styleKitSchema.parse(kit.id.startsWith('builtin:') ? availableStyleKitFonts(kit, (await loadFontLibrary()).faces) : kit); signal?.throwIfAborted()
  if (requireVideoEditInstance(projectId) !== owner || owner.document !== baseline) throw new Error('原剪辑在检查期间已修改，请重新插入。')
  const sample = checked.samples.find(value => value.id === sampleId)
  if (!sequence || !sample) throw new Error('请选择原序列与风格组件。')
  const existing = owner.document.styleKits?.find(value => value.id === checked.id)
  const snapshot = { ...checked, id: existing ? checked.id : crypto.randomUUID(), revision: existing ? existing.revision + 1 : 0 }
  const files = normalizeCodeMaterialFiles(sample.source)
  const source = { ...files, files: { ...files.files, [files.entry]: resizeCodeMaterialCanvas(files.files[files.entry], { width: Math.round(sequence.width * sequence.pixelAspectRatio.numerator / sequence.pixelAspectRatio.denominator), height: sequence.height }) } }
  let ids: string[] = []
  logger.info('style_kit.insert_sample.start', '添加风格组件', { context: { projectId, sequenceId, sampleId } })
  try {
    await createVideoEditPlacedCodeItems(projectId, [{ ...source, name: sample.name }], (document, itemIds) => {
      const styled = { ...document, styleKits: [...(document.styleKits ?? []).filter(value => value.id !== snapshot.id), snapshot], sequences: document.sequences.map(value => value.id === sequenceId ? { ...value, styleKitId: snapshot.id } : value) }
      const result = placeVideoEditDrop(styled, itemIds, sequenceId, placement ?? { frame: owner.activeSequenceId === sequenceId ? owner.frame : 0, mode: 'top' }, { targetTrackIds: owner.targetTrackIds, codeMetadata: readVideoEditCodeMetadata(owner, styled) })
      ids = result.document.sequences.find(value => value.id === sequenceId)!.clips.filter(clip => itemIds.includes(clip.itemId)).map(clip => clip.id); return result.document
    }, signal)
    if (owner.activeSequenceId === sequenceId) setVideoEditView(projectId, { selection: ids[0] ?? null })
    logger.info('style_kit.insert_sample.completed', '风格组件已添加', { context: { projectId, sequenceId, clipIds: ids } }); return ids
  } catch (error) { logger.error('style_kit.insert_sample.failed', '风格组件添加失败', { error, context: { projectId, sequenceId } }); throw error }
}
