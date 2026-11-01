import { createLogger } from '@/core/logging'
import { requireVideoEditBuiltinEffect } from '@/core/videoEdit/builtinEffects'
import type { CodeMaterialMetadataReader } from '@/core/videoEdit/codeMaterialDocument'
import type { VideoEditClip, VideoEditDocument, VideoEditSequence } from '@/core/videoEdit/document'
import { instantiateVideoEditEffects } from './videoEditCompositing'
import { placeVideoEditDrop, type VideoEditDropPlacement } from './videoEditDrop'
import { resolveVideoEditLibraryEffects } from './videoEditEffectPresets'
import { makeVideoEditGraphicItem } from './videoEditProjectItems'
import { readVideoEditCodeMetadata, withVideoEditCodeMetadata } from './videoEditCodeState'
import { editVideoProject, requireVideoEditInstance, setVideoEditView } from './videoEditService'

const logger = createLogger('features.videoEdit.generators')

export interface VideoEditGeneratorPlacement { document: VideoEditDocument; clipId: string; placedClips: VideoEditClip[]; resultSequence: VideoEditSequence }
/**
 * 生成器拖到轨道空白处：新建一段整幅图形片段（铺满序列画面的不透明黑色矩形，同 PR 的颜色遮罩），生成器作为它效果链的第一项。
 * 落点、覆盖与插入沿用拖入素材的同一套规则（`placeVideoEditDrop`），拖动中的虚影与松手结果由同一次计算给出。
 * 底色为黑：光效、下落线条、波形这类背景透明的生成器本来就要叠在暗底上看。
 */
export function placeVideoEditGenerator(source: VideoEditDocument, sequenceId: string, builtinId: string, placement: VideoEditDropPlacement, options: { targetTrackIds: readonly string[]; codeMetadata?: CodeMaterialMetadataReader }): VideoEditGeneratorPlacement {
  const definition = requireVideoEditBuiltinEffect(builtinId)
  if (definition.stage !== 'generator') throw new Error(`“${definition.name}”不是生成器，请拖到片段上。`)
  const sequence = source.sequences.find(value => value.id === sequenceId)
  if (!sequence) throw new Error('原落点序列已移除，请重新拖入。')
  const item = makeVideoEditGraphicItem({ kind: 'solid', name: definition.name }, sequence, source.id)
  const placed = placeVideoEditDrop({ ...source, items: [...source.items, item] }, [item.id], sequenceId, placement, { targetTrackIds: options.targetTrackIds, ...(options.codeMetadata ? { codeMetadata: options.codeMetadata } : {}) })
  const clipId = placed.selectedClip
  if (!clipId) throw new Error('这里放不下新片段，请拖到未锁定的画面轨道。')
  const templates = resolveVideoEditLibraryEffects(builtinId)!.effects
  const clips = placed.resultSequence.clips.map(clip => clip.id === clipId ? { ...clip, effects: [...instantiateVideoEditEffects(templates, clip.duration), ...(clip.effects ?? [])] } : clip)
  const resultSequence = { ...placed.resultSequence, clips }
  return { document: { ...placed.document, sequences: placed.document.sequences.map(value => value.id === sequenceId ? resultSequence : value) }, clipId, placedClips: placed.placedClips.map(clip => clips.find(value => value.id === clip.id) ?? clip), resultSequence }
}

/** 松手：新建素材项与片段、加上生成器，一步撤销；选中新片段，效果控件里接着调。返回片段 ID。 */
export async function dropVideoEditGenerator(projectId: string, sequenceId: string, builtinId: string, placement: VideoEditDropPlacement): Promise<string> {
  const owner = requireVideoEditInstance(projectId)
  let clipId = ''
  const context = { projectId, sequenceId, builtinId, frame: placement.frame, track: placement.track ?? null, newTrack: placement.newTrack ?? null }
  logger.info('开始创建生成器片段', { event: 'video_edit.generator.drop.start', context })
  try {
    await withVideoEditCodeMetadata(() => editVideoProject(projectId, document => {
      const placed = placeVideoEditGenerator(document, sequenceId, builtinId, placement, { targetTrackIds: owner.targetTrackIds, codeMetadata: readVideoEditCodeMetadata(owner, document) })
      clipId = placed.clipId
      return placed.document
    }))
    if (owner.activeSequenceId === sequenceId) setVideoEditView(projectId, { selection: clipId })
    logger.info('生成器已拖入时间线', { event: 'video_edit.generator.drop.completed', context: { ...context, clipId } })
    return clipId
  } catch (error) {
    logger.error('生成器片段创建失败', { event: 'video_edit.generator.drop.failed', context, error })
    throw error
  }
}
