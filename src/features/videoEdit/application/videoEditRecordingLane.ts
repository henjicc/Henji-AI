import { createLogger } from '@/core/logging'
import type { VideoEditDocument } from '@/core/videoEdit/document'
import { settleVideoEditRecordingTake, videoEditRecordingLane, videoEditRecordingTarget, type VideoEditRecordingLane, type VideoEditRecordingPlacement, type VideoEditRecordingSettled, type VideoEditRecordingTarget } from '@/core/videoEdit/recordingLane'
import { executeVideoEditTimelineEdit, finishVideoEditTimelineTrim, type VideoEditTimelineDrag, type VideoEditTimelineTrimDrag } from './videoEditTimeline'
import { getActiveVideoEditSequence, requireVideoEditInstance, setVideoEditTimelineView } from './videoEditService'
import { updateVideoEditClipProperties } from './videoEditClipProperties'

/**
 * 录制样子里的操作：都是剪辑已有的时间线编辑（拆分、波纹删除、波纹修剪、改名），只是对象换成录屏轨上的一个块
 * （录屏画面片段连同链接的声音）。按钮、菜单与快捷键走这里；新录一段的落点由 `videoEditRecordingTargetAt` 给出，
 * 录制导入放好素材后在同一次编辑里调用 `placeVideoEditRecordingTake` 落定。
 */
const logger = createLogger('features.videoEdit.recordingLane')

export function activeVideoEditRecordingLane(projectId: string): VideoEditRecordingLane {
  return videoEditRecordingLane(getActiveVideoEditSequence(requireVideoEditInstance(projectId)))
}
/** 块连同链接的声音一起选中：时间线选择与“剪辑”样子共用，切过去看到的就是这一组。 */
export function selectVideoEditRecordingBlock(projectId: string, clipId: string | null): void {
  const block = clipId ? activeVideoEditRecordingLane(projectId).blocks.find(value => value.clip.id === clipId) : undefined
  setVideoEditTimelineView(projectId, { selectedClipIds: block ? [block.clip.id, ...block.linked.map(clip => clip.id)] : [] }, block?.clip.id)
}
/** 波纹编辑被别的轨道上横跨这里的内容（同步锁定）拦下时，换成录制样子里读得懂的说明。 */
function laneEditError(error: unknown): unknown {
  return error instanceof Error && error.message.includes('同步锁定') ? new Error('别的轨道上有内容横跨这里（比如垫在下面的背景或配乐），后面的段没法跟着挪。到“剪辑”里处理这一处，或先把那条轨道的同步锁定关掉。', { cause: error }) : error
}
/** 指针下的那一块（不含两端），没有时为空。 */
function blockAtPlayhead(projectId: string) {
  const owner = requireVideoEditInstance(projectId)
  return activeVideoEditRecordingLane(projectId).blocks.find(({ clip }) => owner.frame > clip.start && owner.frame < clip.start + clip.duration)
}
/** 指针处切开：指针下的块与它的声音一起切。 */
export async function splitVideoEditRecordingAtPlayhead(projectId: string): Promise<void> {
  const owner = requireVideoEditInstance(projectId)
  const block = blockAtPlayhead(projectId)
  if (!block) throw new Error('把指针放在某一段中间再切开。')
  await executeVideoEditTimelineEdit(projectId, owner.activeSequenceId, { kind: 'split', clipIds: [block.clip.id, ...block.linked.map(clip => clip.id)], linked: false, frame: owner.frame })
}
/** 删除一块（连同链接的声音），后面的块接上来（波纹删除），不留空隙。 */
export async function deleteVideoEditRecordingBlock(projectId: string, clipId: string): Promise<void> {
  const owner = requireVideoEditInstance(projectId)
  const block = activeVideoEditRecordingLane(projectId).blocks.find(value => value.clip.id === clipId)
  if (!block) throw new Error('先在录屏轨上选中一段。')
  try { await executeVideoEditTimelineEdit(projectId, owner.activeSequenceId, { kind: 'delete', clipIds: [block.clip.id, ...block.linked.map(clip => clip.id)], linked: false, ripple: true }) }
  catch (error) { throw laneEditError(error) }
}
/** 拖块的一端松手：波纹修剪，与剪辑时间线的波纹编辑同一份编辑。 */
export async function finishVideoEditRecordingTrim(handle: VideoEditTimelineDrag, trim: VideoEditTimelineTrimDrag): Promise<void> {
  try { await finishVideoEditTimelineTrim(handle, trim) } catch (error) { throw laneEditError(error) }
}
export function renameVideoEditRecordingBlock(projectId: string, clipId: string, name: string): void {
  const trimmed = name.trim()
  if (!trimmed) return
  updateVideoEditClipProperties(projectId, requireVideoEditInstance(projectId).activeSequenceId, clipId, { name: trimmed })
}
/** 指针在结尾（或之后）时接在末尾，在某段上时从指针处覆盖。认不出录屏轨时抛出原因。 */
export function videoEditRecordingTargetAt(projectId: string, placement?: VideoEditRecordingPlacement): VideoEditRecordingTarget & { sequenceId: string } {
  const owner = requireVideoEditInstance(projectId)
  return { ...videoEditRecordingTarget(getActiveVideoEditSequence(owner), placement ?? { at: 'frame', frame: owner.frame }), sequenceId: owner.activeSequenceId }
}
/** 录制导入在放入素材的同一次编辑里调用：新的一段落定在目标位置，覆盖时切掉被盖住的录屏块与它们的声音。 */
export function placeVideoEditRecordingTake(document: VideoEditDocument, sequenceId: string, takeClipIds: readonly string[], mode: VideoEditRecordingTarget['mode']): VideoEditRecordingSettled {
  try {
    const settled = settleVideoEditRecordingTake(document, sequenceId, takeClipIds)
    logger.info(mode === 'overwrite' ? '新录的一段从指针处覆盖' : '新录的一段接在录屏轨末尾', { event: 'video_edit.recording_take.placed', context: { projectId: document.id, sequenceId, mode, from: settled.from, to: settled.to, covered: settled.covered.length } })
    return settled
  } catch (error) {
    logger.error('新录的一段没能放进录屏轨', { event: 'video_edit.recording_take.failed', error, context: { projectId: document.id, sequenceId, mode } })
    throw error
  }
}
