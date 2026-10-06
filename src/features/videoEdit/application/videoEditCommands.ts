import { VIDEO_EDIT_COMMANDS, type VideoEditCommandId, type VideoEditCommandScope } from '@/core/videoEdit/commands'
import { placeVideoEditItems } from '@/core/videoEdit/projectItems'
import { videoEditDuration, type VideoEditSequence } from '@/core/videoEdit/document'
import { videoEditTransitionClipIds } from '@/core/videoEdit/transitions'
import { assertVideoEditClipsEditable } from '@/core/videoEdit/lockedTracks'
import { expandVideoEditSelection, videoEditPickRelations, type VideoEditRelations } from '@/core/videoEdit/timelineSelection'
import { applyVideoEditTimelineEdit, type VideoEditClipboard, type VideoEditTimelineEdit } from '@/core/videoEdit/timelineEdits'
import { videoEditSyncCorrections } from '@/core/videoEdit/linkSync'
import { appendVideoEditSequence, createVideoEditProject, focusVideoEditPanel, getActiveVideoEditSequence, requireVideoEditInstance, listVideoEditInstances, saveVideoEdit, setVideoEditProjectView, setVideoEditTimelineView, setVideoEditView, videoEditProgramCommandIdentity, switchVideoEditSequence, undoVideoEdit, type VideoEditInstance } from './videoEditService'
import { chooseVideoEditMedia } from './videoEditMedia'
import { exportVideoEdit } from './videoEditExport'
import { readVideoEditSource, updateVideoEditSource, pauseVideoEditSourceForProgram, restoreVideoEditSourcePause, videoEditSourceCommandIdentity, matchesVideoEditSourceCommand, type VideoEditSourceCommandIdentity, type VideoEditSourceState } from './videoEditSource'
import { readVideoEditCodeMetadata } from './videoEditCodeState'
import { copyVideoEditTimeline, executeVideoEditTimelineEdit, readVideoEditClipboard, resizeVideoEditTracks, separateVideoEditAudio } from './videoEditTimeline'
import { videoEditTimelineViewport } from './videoEditTimelineViewport'
import { VIDEO_EDIT_TRACK_HEIGHT_DEFAULT, VIDEO_EDIT_TRACK_HEIGHT_MAX, VIDEO_EDIT_TRACK_HEIGHT_MIN, videoEditAdjacentPoint, videoEditClipsAtFrame, videoEditEditPoints } from '@/core/videoEdit/timelineNavigation'
import { videoEditMoveTrackMap } from '@/core/videoEdit/timelineEdits'
import { createVideoEditMarker } from './videoEditTimedContent'
import { createVideoEditBin } from './videoEditProjectItems'
import { applyVideoEditDefaultTransitions, selectVideoEditTransition, selectedVideoEditTransitionId, videoEditDefaultTransitionTargets, type VideoEditDefaultTransitionRequest } from './videoEditTransitions'
import { deleteVideoEditTransition } from './videoEditCompositing'

/** Premiere 轨道高度键：每次 8px；展开所有轨道到 96px，最小化到最小高度。 */
const TRACK_HEIGHT_STEP = 8
const trackResizes = {
  increase_video_tracks: ['video', (height: number) => height + TRACK_HEIGHT_STEP], decrease_video_tracks: ['video', (height: number) => height - TRACK_HEIGHT_STEP],
  increase_audio_tracks: ['audio', (height: number) => height + TRACK_HEIGHT_STEP], decrease_audio_tracks: ['audio', (height: number) => height - TRACK_HEIGHT_STEP],
  expand_all_tracks: ['all', () => 96], minimize_all_tracks: ['all', () => VIDEO_EDIT_TRACK_HEIGHT_MIN],
} as const satisfies Partial<Record<VideoEditCommandId, readonly ['video' | 'audio' | 'all', (height: number) => number]>>
const STEP_DISTANCE = { step_back: -1, step_forward: 1, step_back_five: -5, step_forward_five: 5 } as const
const NUDGES = { nudge_left: [-1, 0], nudge_right: [1, 0], nudge_left_five: [-5, 0], nudge_right_five: [5, 0], nudge_up: [0, 1], nudge_down: [0, -1] } as const
const FOCUS_PANELS = { focus_project: 'project', focus_source: 'source', focus_timeline: 'timeline', focus_program: 'program', focus_effects: 'effects' } as const
const TRANSITION_COMMANDS: Partial<Record<VideoEditCommandId, VideoEditDefaultTransitionRequest>> = { apply_video_transition: { mode: 'playhead', medium: 'video' }, apply_audio_transition: { mode: 'playhead', medium: 'audio' }, apply_default_transitions: { mode: 'selection' } }
const NAVIGATIONS = new Set<VideoEditCommandId>(['go_prev_edit', 'go_next_edit', 'go_prev_edit_any', 'go_next_edit_any', 'go_start', 'go_end', 'go_in', 'go_out', 'next_marker', 'prev_marker'])
/** 素材面板自己的视图状态，只在素材面板里响应。 */
const PROJECT_PANEL_COMMANDS = new Set<VideoEditCommandId>(['project_list_view', 'project_icon_view', 'project_toggle_view'])
export interface VideoEditCommandContext { readonly projectId?: string; readonly sequenceId?: string; readonly scope: VideoEditCommandScope; readonly clipIds: readonly string[]; readonly itemIds: readonly string[]; readonly frame: number }
interface ContextState { owner?: VideoEditInstance; document?: VideoEditInstance['document']; source?: VideoEditSourceState; sourceCommand?: VideoEditSourceCommandIdentity; targetTrackIds: string[]; clipboard?: VideoEditClipboard }
const contexts = new WeakMap<VideoEditCommandContext, ContextState>()
/**
 * The timeline selection is already the edit set: pickers expand linked partners per Linked
 * Selection/Alt before storing it. Explicit `clipIds` (razor click) expand only when `linked` is set.
 */
export function captureVideoEditCommandContext(projectId: string | undefined, scope: VideoEditCommandScope, options: { clipIds?: string[]; linked?: VideoEditRelations; itemIds?: string[]; frame?: number; includeClipboard?: boolean } = {}): VideoEditCommandContext {
  const owner = projectId ? requireVideoEditInstance(projectId) : undefined
  const sequence = owner && getActiveVideoEditSequence(owner)
  let clipIds: string[] = []
  if (sequence && owner) clipIds = options.clipIds ? expandVideoEditSelection(sequence, options.clipIds, options.linked ?? false) : owner.selectedClipIds.slice()
  const context = Object.freeze({ projectId, sequenceId: owner?.activeSequenceId, scope, clipIds: Object.freeze(clipIds), itemIds: Object.freeze(options.itemIds?.slice() ?? owner?.selectedItemIds.slice() ?? []), frame: options.frame ?? owner?.frame ?? 0 })
  contexts.set(context, { owner, document: owner?.document, source: owner ? readVideoEditSource(owner.document.id) : undefined, sourceCommand: owner && scope === 'source' ? videoEditSourceCommandIdentity(owner.document.id) : undefined, targetTrackIds: owner?.targetTrackIds.slice() ?? [], clipboard: owner && options.includeClipboard !== false ? readVideoEditClipboard(owner.document.id) : undefined })
  return context
}
function stateOf(context: VideoEditCommandContext): ContextState {
  const state = contexts.get(context)
  if (!state) throw new Error('剪辑命令上下文已失效。')
  if (state.owner && (requireVideoEditInstance(context.projectId!) !== state.owner || state.owner.document !== state.document || state.owner.activeSequenceId !== context.sequenceId)) throw new Error('原剪辑或序列已改变，请重新选择操作。')
  if (state.sourceCommand && !matchesVideoEditSourceCommand(context.projectId!, state.sourceCommand)) throw new Error('源素材已有后续操作，请重新选择命令。')
  return state
}
function selection(context: VideoEditCommandContext) { const owner = stateOf(context).owner!; return getActiveVideoEditSequence(owner).clips.filter(clip => context.clipIds.includes(clip.id)) }
function sourceItem(context: VideoEditCommandContext): string | undefined { return context.scope === 'source' ? stateOf(context).source?.itemId : getActiveVideoEditSequence(stateOf(context).owner!).clips.find(clip => clip.id === context.clipIds[0])?.itemId }
/** Source and project placements also return the audio tracks a multi-track item needs (task 2.6); their clips are already on target tracks. */
function placeClipboard(context: VideoEditCommandContext): { clipboard: VideoEditClipboard; newTracks?: VideoEditSequence['tracks'] } {
  const { owner, source } = stateOf(context); if (!owner) throw new Error('请先打开剪辑。')
  if (context.scope !== 'source' && context.scope !== 'project') { const clipboard = stateOf(context).clipboard; if (!clipboard) throw new Error('请先复制片段。'); return { clipboard } }
  const sequence = getActiveVideoEditSequence(owner); const items = context.scope === 'source' ? source?.itemId ? [source.itemId] : [] : [...context.itemIds]
  if (!items.length) throw new Error('请选择要放入序列的源素材或素材项。')
  const target = (kind: 'video' | 'audio'): number | undefined => sequence.tracks.find(track => stateOf(context).targetTrackIds.includes(track.id) && track.kind === kind)?.index
  const videoTrack = target('video'); const audioTrack = target('audio')
  for (const itemId of items) {
    const item = owner.document.items.find(item => item.id === itemId)
    if ((item?.kind === 'audio' ? audioTrack : videoTrack) === undefined) throw new Error('请选择对应的目标轨道。')
  }
  const range = context.scope === 'source' && source && owner.document.items.find(item => item.id === items[0])?.kind !== 'image' ? { sourceInUs: source.inUs ?? 0, ...(source.outUs !== null ? { sourceOutUs: source.outUs } : {}) } : {}
  const placed = placeVideoEditItems(owner.document, items, sequence.id, { frame: 0, ...(videoTrack !== undefined ? { videoTrack } : {}), ...(audioTrack !== undefined ? { audioTrack } : {}), ...range }, readVideoEditCodeMetadata(owner, owner.document))
  const tracks = [...sequence.tracks, ...placed.addedTracks]
  return { clipboard: { projectId: owner.document.id, frameRate: sequence.frameRate, clips: placed.clips, annotations: [], tracks: tracks.map(track => ({ index: track.index, kind: track.kind })) }, ...(placed.addedTracks.length ? { newTracks: placed.addedTracks } : {}) }
}
function clipboardTrackMap(context: VideoEditCommandContext, clipboard: VideoEditClipboard): Record<number, number> {
  const owner = stateOf(context).owner!; const sequence = getActiveVideoEditSequence(owner); const mapping: Record<number, number> = {}
  for (const kind of ['video', 'audio'] as const) {
    const sources = [...new Set(clipboard.clips.filter(clip => (clip.kind === 'audio' ? 'audio' : 'video') === kind).map(clip => clip.track))].sort((a, b) => a - b)
    if (!sources.length) continue
    const targets = sequence.tracks.filter(track => track.kind === kind).sort((a, b) => a.index - b.index)
    const start = targets.findIndex(track => stateOf(context).targetTrackIds.includes(track.id))
    if (start < 0) throw new Error('请选择对应的目标轨道。')
    const sourceTracks = (clipboard.tracks ?? sources.map(index => ({ index, kind }))).filter(track => track.kind === kind).sort((a, b) => a.index - b.index)
    const sourceStart = sourceTracks.findIndex(track => track.index === sources[0])
    for (const track of sources) {
      const sourceIndex = sourceTracks.findIndex(value => value.index === track)
      if (sourceStart < 0 || sourceIndex < 0) throw new Error('剪贴板片段的源轨道无效。')
      const destination = targets[start + sourceIndex - sourceStart]
      if (!destination) throw new Error('剪贴板轨道超出可用目标轨道。')
      mapping[track] = destination.index
    }
  }
  return mapping
}
function contextTargetTracks(context: VideoEditCommandContext): number[] { const state = stateOf(context); return getActiveVideoEditSequence(state.owner!).tracks.filter(track => state.targetTrackIds.includes(track.id)).map(track => track.index) }
/** 目标轨道；没有目标轨道时按全部轨道（导航与标记片段）。 */
function navigationTracks(context: VideoEditCommandContext): number[] | undefined { const targets = contextTargetTracks(context); return targets.length ? targets : undefined }
function targetClipsAtFrame(context: VideoEditCommandContext) {
  const sequence = getActiveVideoEditSequence(stateOf(context).owner!)
  return videoEditClipsAtFrame(sequence.clips, context.frame, navigationTracks(context) ?? sequence.tracks.map(track => track.index))
}
/** Premiere 导航键的落点；没有可去的位置时给出原因。 */
function navigationTarget(context: VideoEditCommandContext, id: VideoEditCommandId): { frame?: number; reason: string } {
  const owner = stateOf(context).owner!; const sequence = getActiveVideoEditSequence(owner)
  const limit = Math.floor(sequence.fps * 1800)
  if (id === 'go_start') return { frame: 0, reason: '' }
  if (id === 'go_end') return { frame: Math.min(limit, videoEditDuration(sequence)), reason: '' }
  if (id === 'go_in') return { frame: owner.inFrame ?? undefined, reason: '序列没有入点。' }
  if (id === 'go_out') return { frame: owner.outFrame === null ? undefined : owner.outFrame - 1, reason: '序列没有出点。' }
  if (id === 'next_marker' || id === 'prev_marker') return { frame: videoEditAdjacentPoint([...new Set((sequence.markers ?? []).map(mark => mark.frame))].sort((a, b) => a - b), context.frame, id === 'prev_marker' ? -1 : 1), reason: '这个方向没有标记。' }
  const any = id === 'go_prev_edit_any' || id === 'go_next_edit_any'
  return { frame: videoEditAdjacentPoint(videoEditEditPoints(sequence, any ? undefined : navigationTracks(context)), context.frame, id === 'go_prev_edit' || id === 'go_prev_edit_any' ? -1 : 1), reason: '这个方向没有编辑点。' }
}
/** Ctrl+L：所选片段已有链接就解除，否则链接（Premiere 的“链接”是开关）。 */
function linkToggle(context: VideoEditCommandContext): 'link' | 'unlink' { return selection(context).some(clip => clip.linkId) ? 'unlink' : 'link' }
function timelineIntent(context: VideoEditCommandContext, id: VideoEditCommandId): VideoEditTimelineEdit | undefined {
  const clips = [...context.clipIds]
  if (id === 'lift' || id === 'extract') {
    const owner = stateOf(context).owner!; const sequence = getActiveVideoEditSequence(owner)
    if (owner.inFrame === null && owner.outFrame === null) throw new Error('请先设置序列入点或出点。')
    return { kind: 'range', from: owner.inFrame ?? 0, to: owner.outFrame ?? videoEditDuration(sequence), tracks: contextTargetTracks(context), ripple: id === 'extract' }
  }
  if (id === 'ripple_trim_prev' || id === 'ripple_trim_next') {
    const crossing = targetClipsAtFrame(context).filter(clip => clip.start < context.frame)
    if (!crossing.length) throw new Error('播放头处的目标轨道没有可修剪的片段。')
    // 各轨片段的起点／终点不同时取最靠近播放头的编辑点，不删掉另一条轨道上播放头之外的内容。
    const from = id === 'ripple_trim_prev' ? Math.max(...crossing.map(clip => clip.start)) : context.frame
    const to = id === 'ripple_trim_prev' ? context.frame : Math.min(...crossing.map(clip => clip.start + clip.duration))
    return { kind: 'range', from, to, tracks: [...new Set(crossing.map(clip => clip.track))], ripple: true }
  }
  if (id in NUDGES) {
    const [delta, lanes] = NUDGES[id as keyof typeof NUDGES]
    if (!clips.length) throw new Error('请先选择片段。')
    if (!lanes) return { kind: 'adjust', clipIds: clips, linked: false, mode: 'move', delta }
    const owner = stateOf(context).owner!; const sequence = getActiveVideoEditSequence(owner)
    const primary = sequence.clips.find(clip => clip.id === (owner.selection && clips.includes(owner.selection) ? owner.selection : clips[0]))!
    const kind = primary.kind === 'audio' ? 'audio' : 'video'
    const ordered = sequence.tracks.filter(track => track.kind === kind).sort((a, b) => a.index - b.index)
    // 画面轨编号越大越靠上，声音轨编号越大越靠下。
    const target = ordered[ordered.findIndex(track => track.index === primary.track) + (kind === 'video' ? lanes : -lanes)]
    if (!target) throw new Error('没有可移动到的同类轨道。')
    return { kind: 'adjust', clipIds: clips, linked: false, mode: 'move', delta: 0, trackMap: videoEditMoveTrackMap(sequence, clips, primary.id, target.index) }
  }
  if (id === 'paste' || id === 'insert' || id === 'overwrite' || id === 'paste_insert') {
    const { clipboard, newTracks } = placeClipboard(context)
    // Source and project placements already sit on the target tracks (and on tracks they add).
    return { kind: 'place', clipboard, mode: id === 'paste_insert' ? 'insert' : id, frame: context.frame, ...(context.scope === 'source' || context.scope === 'project' ? newTracks ? { newTracks } : {} : { trackMap: clipboardTrackMap(context, clipboard) }), targetTracks: contextTargetTracks(context) }
  }
  if (id === 'split') return { kind: 'split', clipIds: clips, linked: false, frame: context.frame }
  if (id === 'split_tracks') return { kind: 'split', clipIds: getActiveVideoEditSequence(stateOf(context).owner!).clips.filter(clip => contextTargetTracks(context).includes(clip.track) && context.frame > clip.start && context.frame < clip.start + clip.duration).map(clip => clip.id), linked: videoEditPickRelations(stateOf(context).owner!.linkedSelection !== false), frame: context.frame }
  if (id === 'delete' || id === 'ripple_delete') return { kind: 'delete', clipIds: clips, linked: false, ripple: id === 'ripple_delete', targetTracks: contextTargetTracks(context) }
  if (id === 'link' || id === 'unlink' || id === 'group' || id === 'ungroup') return { kind: id, clipIds: clips, linked: false }
  if (id === 'move_into_sync' || id === 'slip_into_sync') return { kind: 'sync', clipIds: clips, mode: id === 'move_into_sync' ? 'move' : 'slip' }
}
export function videoEditCommandState(context: VideoEditCommandContext, id: VideoEditCommandId): { enabled: boolean; reason?: string; checked?: boolean } {
  try {
    const descriptor = VIDEO_EDIT_COMMANDS.find(command => command.id === id)!
    if (!descriptor.scopes.includes('global') && !descriptor.scopes.includes(context.scope)) return { enabled: false, reason: '此命令不适用于当前面板。' }
    const { owner, source } = stateOf(context)
    if (id === 'new_project') return { enabled: true }
    if (!owner) return { enabled: false, reason: '请先打开剪辑。' }
    const sequence = getActiveVideoEditSequence(owner)
    if (id === 'undo' || id === 'redo') return { enabled: Boolean(id === 'undo' ? owner.past.length : owner.future.length), reason: '没有可恢复的编辑。' }
    const tools = { select_tool: 'select', razor_tool: 'razor', hand_tool: 'hand', track_tool: 'track' } as const
    if (id in tools) return { enabled: true, checked: owner.tool === tools[id as keyof typeof tools] }
    if (id === 'toggle_snapping') return { enabled: true, checked: owner.snapping }
    if (id === 'toggle_linked_selection') return { enabled: true, checked: owner.linkedSelection !== false }
    if (id === 'export') return { enabled: sequence.clips.length > 0 && !owner.busy, reason: '序列没有可导出的片段或正在导出。' }
    if (id in FOCUS_PANELS || id === 'maximize_panel' || id === 'deselect_all') return { enabled: true }
    if (PROJECT_PANEL_COMMANDS.has(id)) return { enabled: false, reason: '请在素材面板中使用。' }
    if (id === 'new_bin') return { enabled: owner.document.bins.length < 200, reason: '素材箱数量已达上限。' }
    if (id === 'open_in_source') return { enabled: owner.document.items.some(item => context.itemIds.includes(item.id) && item.mediaId), reason: '请先选择有源文件的素材项。' }
    if (NAVIGATIONS.has(id)) { const target = navigationTarget(context, id); return { enabled: target.frame !== undefined, reason: target.reason } }
    if (id === 'mark_clip' || id === 'select_clip_at_playhead') return { enabled: targetClipsAtFrame(context).length > 0, reason: '播放头处的目标轨道没有片段。' }
    if (id === 'add_marker') return { enabled: (sequence.markers?.length ?? 0) < 500, reason: '序列最多500个标记。' }
    if (id === 'clear_in' || id === 'clear_out' || id === 'clear_in_out') {
      const [inPoint, outPoint] = context.scope === 'source' ? [source?.inUs ?? null, source?.outUs ?? null] : [owner.inFrame, owner.outFrame]
      return { enabled: id === 'clear_in' ? inPoint !== null : id === 'clear_out' ? outPoint !== null : inPoint !== null || outPoint !== null, reason: '没有可清除的入出点。' }
    }
    if (id === 'toggle_link') return selection(context).length ? videoEditCommandState(context, linkToggle(context)) : { enabled: false, reason: '请先选择片段。' }
    if (id === 'cut') return videoEditCommandState(context, 'delete')
    if (id in trackResizes) {
      const [kind, resize] = trackResizes[id as keyof typeof trackResizes]
      return { enabled: sequence.tracks.some(track => (kind === 'all' || track.kind === kind) && Math.max(VIDEO_EDIT_TRACK_HEIGHT_MIN, Math.min(VIDEO_EDIT_TRACK_HEIGHT_MAX, Math.round(resize(track.height ?? VIDEO_EDIT_TRACK_HEIGHT_DEFAULT)))) !== (track.height ?? VIDEO_EDIT_TRACK_HEIGHT_DEFAULT)), reason: '轨道高度已到上限或下限。' }
    }
    if (id === 'zoom_to_sequence' || id === 'previous_screen' || id === 'next_screen') return { enabled: Boolean(videoEditTimelineViewport(owner.document.id, sequence.id)), reason: '请先显示时间线面板。' }
    if (['play_pause', 'play_forward', 'play_reverse', 'play_stop', 'step_back', 'step_forward', 'step_back_five', 'step_forward_five', 'mark_in', 'mark_out'].includes(id) && context.scope === 'source') {
      const item = owner.document.items.find(item => item.id === source?.itemId); const media = owner.document.media.find(media => media.id === item?.mediaId)
      return { enabled: Boolean(media && media.kind !== 'image' && (source?.status === 'ready' || id === 'play_stop' && source?.status === 'loading')), reason: '请先打开可以播放的源素材。' }
    }
    const transitionRequest = TRANSITION_COMMANDS[id]
    if (transitionRequest) {
      const pairs = videoEditDefaultTransitionTargets(owner, transitionRequest, context.clipIds, context.frame)
      if (!pairs.length) return { enabled: false, reason: transitionRequest.mode === 'selection' ? '所选片段不能放这种过渡。' : '目标轨道上没有可放过渡的片段。' }
      assertVideoEditClipsEditable(sequence, pairs.flatMap(videoEditTransitionClipIds))
      return { enabled: true }
    }
    // 选中时间线上的过渡块（没有选中片段）时，Delete／Backspace 删除这个过渡（PR）。
    if ((id === 'delete' || id === 'ripple_delete') && !context.clipIds.length && selectedVideoEditTransitionId(owner)) return { enabled: true }
    if (['split', 'delete', 'ripple_delete', 'link', 'unlink', 'group', 'ungroup', 'separate_audio'].includes(id)) {
      const clips = selection(context)
      if (!clips.length) return { enabled: false, reason: '请先选择片段。' }
      assertVideoEditClipsEditable(sequence, context.clipIds)
      if (id === 'split' && !clips.some(clip => context.frame > clip.start && context.frame < clip.start + clip.duration)) return { enabled: false, reason: '播放头不在所选片段内部。' }
      // Splitting only adds a bounded right half; deletion only removes owned data.
      // Their display state must not clone/compile the project or allocate edit IDs every video frame.
      if (id === 'split') return { enabled: sequence.clips.length + clips.filter(clip => context.frame > clip.start && context.frame < clip.start + clip.duration).length <= 500, reason: '拆分后片段超过剪辑上限。' }
      if (id === 'delete') return { enabled: true }
      if ((id === 'link' || id === 'group') && clips.length < 2) return { enabled: false, reason: '请至少选择两个片段。' }
      if (id === 'unlink' || id === 'ungroup') return { enabled: clips.some(clip => id === 'unlink' ? clip.linkId : clip.groupId), reason: '所选片段没有该关联。' }
      if (id === 'separate_audio') return { enabled: clips.every(clip => clip.kind === 'video' && !clip.sourceComponent && owner.document.media.find(media => media.id === owner.document.items.find(item => item.id === clip.itemId)?.mediaId)?.hasAudio !== false) && sequence.tracks.some(track => track.kind === 'audio' && !track.locked), reason: '请选择带声音且尚未拆开的视频和未锁定的声音轨道。' }
    }
    if (id === 'split_tracks') {
      const clips = sequence.clips.filter(clip => contextTargetTracks(context).includes(clip.track) && context.frame > clip.start && context.frame < clip.start + clip.duration)
      assertVideoEditClipsEditable(sequence, expandVideoEditSelection(sequence, clips.map(clip => clip.id), videoEditPickRelations(owner.linkedSelection !== false)))
      if (!clips.length) return { enabled: false, reason: '目标轨道没有可拆分的片段。' }
    }
    if (id === 'move_into_sync' || id === 'slip_into_sync') {
      if (!context.clipIds.length) return { enabled: false, reason: '请先选择片段。' }
      if (!videoEditSyncCorrections(sequence, context.clipIds).size) return { enabled: false, reason: '所选片段与链接片段没有失步。' }
    }
    if (id === 'copy' || id === 'locate_project' || id === 'locate_effects') return { enabled: context.clipIds.length > 0, reason: '请先选择片段。' }
    if (id === 'locate_source') return { enabled: Boolean(owner.document.items.find(item => item.id === sourceItem(context))?.mediaId), reason: '此片段没有源媒体文件。' }
    const intent = timelineIntent(context, id)
    if (intent) applyVideoEditTimelineEdit(owner.document, sequence.id, intent, readVideoEditCodeMetadata(owner, owner.document))
    return { enabled: true }
  } catch (error) { return { enabled: false, reason: error instanceof Error ? error.message : String(error) } }
}
export async function executeVideoEditCommand(context: VideoEditCommandContext, id: VideoEditCommandId): Promise<void> {
  const available = videoEditCommandState(context, id)
  if (!available.enabled) throw new Error(available.reason ?? '此命令当前不可用。')
  const { owner, source } = stateOf(context)
  if (id === 'new_project') { await createVideoEditProject(); return }
  const projectId = owner!.document.id; const sequenceId = context.sequenceId!; const sequence = getActiveVideoEditSequence(owner!)
  const transitionRequest = TRANSITION_COMMANDS[id]
  if (transitionRequest) { await applyVideoEditDefaultTransitions(projectId, sequenceId, videoEditDefaultTransitionTargets(owner!, transitionRequest, context.clipIds, context.frame)); return }
  const transitionId = (id === 'delete' || id === 'ripple_delete') && !context.clipIds.length ? selectedVideoEditTransitionId(owner!) : undefined
  if (transitionId) { await deleteVideoEditTransition(projectId, sequenceId, transitionId); selectVideoEditTransition(projectId, null); return }
  const intent = timelineIntent(context, id)
  if (intent) { executeVideoEditTimelineEdit(projectId, sequenceId, intent); if (intent.kind === 'place') focusVideoEditPanel(projectId, 'timeline'); return }
  switch (id) {
    case 'new_sequence': { const id = appendVideoEditSequence(projectId); switchVideoEditSequence(projectId, id); return }
    case 'import': await chooseVideoEditMedia(projectId, owner!.selectedBinId || undefined); return
    case 'save': await saveVideoEdit(projectId); return
    case 'undo': case 'redo': undoVideoEdit(projectId, id === 'redo'); return
    case 'export': await exportVideoEdit(projectId); return
    case 'select_tool': case 'razor_tool': case 'hand_tool': case 'track_tool': setVideoEditTimelineView(projectId, { tool: ({ select_tool: 'select', razor_tool: 'razor', hand_tool: 'hand', track_tool: 'track' } as const)[id] }); return
    case 'toggle_snapping': setVideoEditTimelineView(projectId, { snapping: !owner!.snapping }); return
    case 'toggle_linked_selection': setVideoEditTimelineView(projectId, { linkedSelection: owner!.linkedSelection === false }); return
    case 'focus_project': case 'focus_source': case 'focus_timeline': case 'focus_program': case 'focus_effects': focusVideoEditPanel(projectId, FOCUS_PANELS[id]); return
    // 面板组最大化属于布局，由剪辑页拿着停靠区执行；素材视图属于素材面板。命令层无事可做。
    case 'maximize_panel': case 'project_list_view': case 'project_icon_view': case 'project_toggle_view': return
    case 'new_bin': { const binId = createVideoEditBin(projectId, `素材箱 ${owner!.document.bins.length + 1}`, owner!.selectedBinId || undefined); setVideoEditProjectView(projectId, { selectedBinId: binId, selectedItemIds: [] }); return }
    case 'open_in_source': await updateVideoEditSource(projectId, { itemId: owner!.document.items.find(item => context.itemIds.includes(item.id) && item.mediaId)!.id }); focusVideoEditPanel(projectId, 'source'); return
    case 'go_prev_edit': case 'go_next_edit': case 'go_prev_edit_any': case 'go_next_edit_any': case 'go_start': case 'go_end': case 'go_in': case 'go_out': case 'next_marker': case 'prev_marker':
      setVideoEditView(projectId, { frame: navigationTarget(context, id).frame!, playing: false }); return
    case 'mark_clip': { const clips = targetClipsAtFrame(context); setVideoEditTimelineView(projectId, { inFrame: Math.min(...clips.map(clip => clip.start)), outFrame: Math.max(...clips.map(clip => clip.start + clip.duration)) }); return }
    case 'select_clip_at_playhead': setVideoEditTimelineView(projectId, { selectedClipIds: expandVideoEditSelection(sequence, targetClipsAtFrame(context).map(clip => clip.id), videoEditPickRelations(owner!.linkedSelection !== false)) }); return
    case 'add_marker': createVideoEditMarker(projectId, sequenceId, { frame: context.frame, name: `标记 ${(sequence.markers?.length ?? 0) + 1}` }); return
    case 'clear_in': case 'clear_out': case 'clear_in_out': {
      const clearIn = id !== 'clear_out'; const clearOut = id !== 'clear_in'
      if (context.scope === 'source') await updateVideoEditSource(projectId, { ...(clearIn ? { inUs: null } : {}), ...(clearOut ? { outUs: null } : {}) })
      else setVideoEditTimelineView(projectId, { ...(clearIn ? { inFrame: null } : {}), ...(clearOut ? { outFrame: null } : {}) })
      return
    }
    case 'deselect_all': if (context.scope === 'project') setVideoEditProjectView(projectId, { selectedItemIds: [] }); else setVideoEditTimelineView(projectId, { selectedClipIds: [] }); return
    case 'toggle_link': await executeVideoEditCommand(context, linkToggle(context)); return
    case 'cut': copyVideoEditTimeline(projectId, sequenceId, [...context.clipIds], false); executeVideoEditTimelineEdit(projectId, sequenceId, { kind: 'delete', clipIds: [...context.clipIds], linked: false, ripple: false }); return
    case 'zoom_to_sequence': videoEditTimelineViewport(projectId, sequenceId)!.zoomToSequence(); return
    case 'previous_screen': case 'next_screen': videoEditTimelineViewport(projectId, sequenceId)!.showScreen(id === 'next_screen' ? 1 : -1); return
    case 'increase_video_tracks': case 'decrease_video_tracks': case 'increase_audio_tracks': case 'decrease_audio_tracks': case 'expand_all_tracks': case 'minimize_all_tracks': { const [kind, resize] = trackResizes[id]; resizeVideoEditTracks(projectId, sequenceId, kind, resize); return }
    case 'zoom_in': case 'zoom_out': setVideoEditTimelineView(projectId, { zoom: Math.max(.1, Math.min(20, owner!.zoom * (id === 'zoom_in' ? 1.25 : .8))) }); return
    case 'select_all': if (context.scope === 'project') setVideoEditProjectView(projectId, { selectedItemIds: owner!.document.items.map(item => item.id) }); else setVideoEditTimelineView(projectId, { selectedClipIds: sequence.clips.map(clip => clip.id) }); return
    case 'copy': copyVideoEditTimeline(projectId, sequenceId, [...context.clipIds], false); return
    case 'separate_audio': await separateVideoEditAudio(projectId, sequenceId, [...context.clipIds], sequence.tracks.find(track => track.kind === 'audio' && !track.locked && stateOf(context).targetTrackIds.includes(track.id))?.index ?? sequence.tracks.find(track => track.kind === 'audio' && !track.locked)!.index, undefined, false); return
    case 'locate_project': { const item = owner!.document.items.find(item => item.id === sourceItem(context))!; setVideoEditProjectView(projectId, { selectedItemIds: [item.id], selectedBinId: item.binId ?? '' }); focusVideoEditPanel(projectId, 'project'); return }
    case 'locate_source': await updateVideoEditSource(projectId, { itemId: sourceItem(context), playing: false }); focusVideoEditPanel(projectId, 'source'); return
    case 'locate_effects': setVideoEditTimelineView(projectId, { selectedClipIds: [...context.clipIds] }, context.clipIds[0]); focusVideoEditPanel(projectId, 'effects'); return
    case 'mark_in': case 'mark_out': {
      if (context.scope === 'source') {
        const media = owner!.document.media.find(media => media.id === owner!.document.items.find(item => item.id === source!.itemId)?.mediaId)!
        const fps = media.frameRate ? media.frameRate.numerator / media.frameRate.denominator : sequence.fps
        const timeUs = media.kind === 'video' ? source!.presentedTimeUs : source!.timeUs
        if (id === 'mark_in') await updateVideoEditSource(projectId, { inUs: timeUs, ...(source!.outUs !== null && source!.outUs <= timeUs ? { outUs: null } : {}) })
        else { const outUs = Math.min(Math.round(media.durationSeconds * 1e6), media.kind === 'video' ? Math.round((Math.round(timeUs / 1e6 * fps) + 1) / fps * 1e6) : Math.round(timeUs + 1e6 / fps)); await updateVideoEditSource(projectId, { outUs, ...(source!.inUs !== null && source!.inUs >= outUs ? { inUs: null } : {}) }) }
      } else if (id === 'mark_in') setVideoEditTimelineView(projectId, { inFrame: context.frame, ...(owner!.outFrame !== null && owner!.outFrame <= context.frame ? { outFrame: null } : {}) })
      else { const outFrame = Math.min(Math.floor(sequence.fps * 1800), context.frame + 1); setVideoEditTimelineView(projectId, { outFrame, ...(owner!.inFrame !== null && owner!.inFrame >= outFrame ? { inFrame: null } : {}) }) }
      return
    }
    case 'play_pause': case 'play_stop': case 'play_forward': case 'play_reverse': {
      const playing = id === 'play_pause' ? !(context.scope === 'source' ? source!.playing : owner!.playing) : id !== 'play_stop'
      const playbackDirection = id === 'play_reverse' ? -1 : 1
      if (context.scope === 'source') await updateVideoEditSource(projectId, { playing, playbackDirection })
      else {
        const command = videoEditProgramCommandIdentity(projectId)
        const wasPlaying = owner!.playing
        const pause = playing ? await pauseVideoEditSourceForProgram(projectId) : undefined
        try {
          stateOf(context)
          if (videoEditProgramCommandIdentity(projectId) !== command) throw new Error('节目已有后续控制，请重试当前命令。')
          setVideoEditView(projectId, { playing, playbackDirection })
        } catch (error) {
          if (pause && !wasPlaying && listVideoEditInstances().includes(owner!) && videoEditProgramCommandIdentity(projectId) === command && matchesVideoEditSourceCommand(projectId, pause.afterCommand)) await restoreVideoEditSourcePause(projectId, pause)
          throw error
        }
      }
      return
    }
    case 'step_back': case 'step_forward': case 'step_back_five': case 'step_forward_five': {
      const direction = STEP_DISTANCE[id]
      if (context.scope === 'source') {
        const media = owner!.document.media.find(media => media.id === owner!.document.items.find(item => item.id === source!.itemId)?.mediaId)!
        const fps = media.frameRate ? media.frameRate.numerator / media.frameRate.denominator : sequence.fps
        const frame = Math.max(0, Math.min(Math.ceil(media.durationSeconds * fps - 1e-6) - 1, Math.round((media.kind === 'video' ? source!.presentedTimeUs : source!.timeUs) / 1e6 * fps) + direction))
        await updateVideoEditSource(projectId, { timeUs: Math.min(Math.round(media.durationSeconds * 1e6), Math.round((frame + (media.kind === 'video' ? .5 : 0)) / fps * 1e6)), playing: false })
      } else setVideoEditView(projectId, { frame: Math.max(0, Math.min(videoEditDuration(sequence) - 1, context.frame + direction)), playing: false })
      return
    }
  }
}
