import { VIDEO_EDIT_COMMANDS, type VideoEditCommandId, type VideoEditCommandScope } from '@/core/videoEdit/commands'
import { placeVideoEditItems } from '@/core/videoEdit/projectItems'
import { videoEditDuration, type VideoEditSequence } from '@/core/videoEdit/document'
import { assertVideoEditClipsEditable } from '@/core/videoEdit/lockedTracks'
import { expandVideoEditSelection, videoEditPickRelations, type VideoEditRelations } from '@/core/videoEdit/timelineSelection'
import { applyVideoEditTimelineEdit, type VideoEditClipboard, type VideoEditTimelineEdit } from '@/core/videoEdit/timelineEdits'
import { videoEditSyncCorrections } from '@/core/videoEdit/linkSync'
import { appendVideoEditSequence, createVideoEditProject, focusVideoEditPanel, getActiveVideoEditSequence, requireVideoEditInstance, listVideoEditInstances, saveVideoEdit, setVideoEditProjectView, setVideoEditTimelineView, setVideoEditView, videoEditProgramCommandIdentity, switchVideoEditSequence, undoVideoEdit, type VideoEditInstance } from './videoEditService'
import { chooseVideoEditMedia } from './videoEditMedia'
import { exportVideoEdit } from './videoEditExport'
import { readVideoEditSource, updateVideoEditSource, pauseVideoEditSourceForProgram, restoreVideoEditSourcePause, videoEditSourceCommandIdentity, matchesVideoEditSourceCommand, type VideoEditSourceCommandIdentity, type VideoEditSourceState } from './videoEditSource'
import { readVideoEditCodeMetadata } from './videoEditCodeState'
import { copyVideoEditTimeline, executeVideoEditTimelineEdit, readVideoEditClipboard, separateVideoEditAudio } from './videoEditTimeline'

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
  if (state.owner && (requireVideoEditInstance(context.projectId!) !== state.owner || state.owner.document !== state.document || state.owner.activeSequenceId !== context.sequenceId)) throw new Error('原工程或序列已改变，请重新选择操作。')
  if (state.sourceCommand && !matchesVideoEditSourceCommand(context.projectId!, state.sourceCommand)) throw new Error('源素材已有后续操作，请重新选择命令。')
  return state
}
function selection(context: VideoEditCommandContext) { const owner = stateOf(context).owner!; return getActiveVideoEditSequence(owner).clips.filter(clip => context.clipIds.includes(clip.id)) }
function sourceItem(context: VideoEditCommandContext): string | undefined { return context.scope === 'source' ? stateOf(context).source?.itemId : getActiveVideoEditSequence(stateOf(context).owner!).clips.find(clip => clip.id === context.clipIds[0])?.itemId }
/** Source and project placements also return the audio tracks a multi-track item needs (task 2.6); their clips are already on target tracks. */
function placeClipboard(context: VideoEditCommandContext): { clipboard: VideoEditClipboard; newTracks?: VideoEditSequence['tracks'] } {
  const { owner, source } = stateOf(context); if (!owner) throw new Error('请先打开剪辑工程。')
  if (context.scope !== 'source' && context.scope !== 'project') { const clipboard = stateOf(context).clipboard; if (!clipboard) throw new Error('请先复制片段。'); return { clipboard } }
  const sequence = getActiveVideoEditSequence(owner); const items = context.scope === 'source' ? source?.itemId ? [source.itemId] : [] : [...context.itemIds]
  if (!items.length) throw new Error('请选择要放入序列的源素材或项目项。')
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
function timelineIntent(context: VideoEditCommandContext, id: VideoEditCommandId): VideoEditTimelineEdit | undefined {
  const clips = [...context.clipIds]
  if (id === 'paste' || id === 'insert' || id === 'overwrite') {
    const { clipboard, newTracks } = placeClipboard(context)
    // Source and project placements already sit on the target tracks (and on tracks they add).
    return { kind: 'place', clipboard, mode: id, frame: context.frame, ...(context.scope === 'source' || context.scope === 'project' ? newTracks ? { newTracks } : {} : { trackMap: clipboardTrackMap(context, clipboard) }), targetTracks: contextTargetTracks(context) }
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
    if (!owner) return { enabled: false, reason: '请先打开剪辑工程。' }
    const sequence = getActiveVideoEditSequence(owner)
    if (id === 'undo' || id === 'redo') return { enabled: Boolean(id === 'undo' ? owner.past.length : owner.future.length), reason: '没有可恢复的编辑。' }
    const tools = { select_tool: 'select', razor_tool: 'razor', hand_tool: 'hand', track_tool: 'track' } as const
    if (id in tools) return { enabled: true, checked: owner.tool === tools[id as keyof typeof tools] }
    if (id === 'toggle_snapping') return { enabled: true, checked: owner.snapping }
    if (id === 'toggle_linked_selection') return { enabled: true, checked: owner.linkedSelection !== false }
    if (id === 'export') return { enabled: sequence.clips.length > 0 && !owner.busy, reason: '序列没有可导出的片段或正在导出。' }
    if (['play_pause', 'play_forward', 'play_reverse', 'play_stop', 'step_back', 'step_forward', 'mark_in', 'mark_out'].includes(id) && context.scope === 'source') {
      const item = owner.document.items.find(item => item.id === source?.itemId); const media = owner.document.media.find(media => media.id === item?.mediaId)
      return { enabled: Boolean(media && media.kind !== 'image' && (source?.status === 'ready' || id === 'play_stop' && source?.status === 'loading')), reason: '请先打开可以播放的源素材。' }
    }
    if (['split', 'delete', 'ripple_delete', 'link', 'unlink', 'group', 'ungroup', 'separate_audio'].includes(id)) {
      const clips = selection(context)
      if (!clips.length) return { enabled: false, reason: '请先选择片段。' }
      assertVideoEditClipsEditable(sequence, context.clipIds)
      if (id === 'split' && !clips.some(clip => context.frame > clip.start && context.frame < clip.start + clip.duration)) return { enabled: false, reason: '播放头不在所选片段内部。' }
      // Splitting only adds a bounded right half; deletion only removes owned data.
      // Their display state must not clone/compile the project or allocate edit IDs every video frame.
      if (id === 'split') return { enabled: sequence.clips.length + clips.filter(clip => context.frame > clip.start && context.frame < clip.start + clip.duration).length <= 500, reason: '拆分后片段超过工程上限。' }
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
    case 'step_back': case 'step_forward': {
      const direction = id === 'step_back' ? -1 : 1
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
