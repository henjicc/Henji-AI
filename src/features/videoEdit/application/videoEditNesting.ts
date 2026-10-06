import { createLogger } from '@/core/logging'
import { nestVideoEditClips, videoEditNestedFrame } from '@/core/videoEdit/nestedSequences'
import { videoEditNestedComposition } from '@/core/videoEdit/document'
import { expandVideoEditSelection, videoEditPickRelations } from '@/core/videoEdit/timelineSelection'
import { editVideoProject, focusVideoEditPanel, getActiveVideoEditSequence, requireVideoEditInstance, setVideoEditView, switchVideoEditSequence } from './videoEditService'

const logger = createLogger('features.videoEdit.nesting')
export interface VideoEditNestTarget { projectId: string; sequenceId: string; clipIds: string[] }
/** UI and assistants commit the same graph transform in one project history step. */
export function nestVideoEditSelection(target: VideoEditNestTarget, name: string, linked = true): ReturnType<typeof nestVideoEditClips> {
  const owner = requireVideoEditInstance(target.projectId)
  const sequence = owner.document.sequences.find(sequence => sequence.id === target.sequenceId)
  if (!sequence) throw new Error('原序列已移除。')
  const ids = linked ? expandVideoEditSelection(sequence, target.clipIds, videoEditPickRelations(true)) : target.clipIds
  logger.info('开始嵌套片段', { event: 'video_edit.nest.start', context: { projectId: target.projectId, sequenceId: target.sequenceId, count: ids.length } })
  try {
    const result = nestVideoEditClips(owner.document, target.sequenceId, ids, name)
    editVideoProject(target.projectId, () => result.document)
    if (owner.activeSequenceId === target.sequenceId) setVideoEditView(target.projectId, { selection: result.clip.id, playing: false })
    logger.info('片段已嵌套', { event: 'video_edit.nest.completed', context: { projectId: target.projectId, sequenceId: result.sequence.id, count: ids.length } })
    return result
  } catch (error) {
    logger.warn('片段嵌套失败', { event: 'video_edit.nest.failed', error, context: { projectId: target.projectId, sequenceId: target.sequenceId } }); throw error
  }
}
/** Double click and F reuse existing sequence tabs and seek in the child's source clock. */
export function openVideoEditNestedClip(projectId: string, clipId: string, frame?: number): void {
  const owner = requireVideoEditInstance(projectId)
  const parent = getActiveVideoEditSequence(owner)
  const clip = parent.clips.find(clip => clip.id === clipId)
  if (!clip || clip.kind !== 'sequence') throw new Error('请选择当前序列中的嵌套片段。')
  const child = videoEditNestedComposition(parent, clip)!
  const at = videoEditNestedFrame(parent, clip, child, Math.max(clip.start, Math.min(clip.start + clip.duration - 1, frame ?? owner.frame)))
  switchVideoEditSequence(projectId, child.id)
  setVideoEditView(projectId, { frame: at, playing: false, selection: null })
  focusVideoEditPanel(projectId, 'timeline')
}
