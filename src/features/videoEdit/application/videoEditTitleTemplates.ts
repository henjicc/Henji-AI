import { z } from 'zod'
import { captureTitleTemplate, instantiateTitleTemplate, type TitleTemplate, type TitleTemplateParameters } from '@/core/videoEdit/titleTemplates'
import { makeVideoEditItemClip } from '@/core/videoEdit/projectItems'
import { assertVideoEditClipsEditable } from '@/core/videoEdit/lockedTracks'
import { resolveVideoEditDropMode } from '@/core/videoEdit/dropPlacement'
import { applyVideoEditTimelineEditResult } from '@/core/videoEdit/timelineEdits'
import { editVideoProject, editVideoSequence, requireVideoEditInstance, setVideoEditView } from './videoEditService'
import { requireTitleTemplate, useTitleTemplateLibrary } from './videoEditTitleTemplateLibrary'
import type { VideoEditDropPlacement } from './videoEditDrop'
import { videoEditEdgeTracks } from '@/core/videoEdit/tracks'
import { createLogger } from '@/core/logging'

const logger = createLogger('features.videoEdit.titleTemplates')

export const TITLE_TEMPLATE_DRAG_MIME = 'application/x-henji-title-template'
export const titleTemplateDragSchema = z.object({ kind: z.literal('title_template'), templateId: z.string().min(1).max(100) }).strict()
export function writeTitleTemplateDrag(transfer: DataTransfer, templateId: string): void { requireTitleTemplate(templateId); transfer.setData(TITLE_TEMPLATE_DRAG_MIME, JSON.stringify({ kind: 'title_template', templateId })); transfer.effectAllowed = 'copy' }
/** Item creation, track creation and placement are a single document transaction. */
export function applyTitleTemplate(projectId: string, sequenceId: string, template: TitleTemplate | string, parameters: Partial<TitleTemplateParameters> = {}, placement?: VideoEditDropPlacement): string[] {
  logger.info('title_template.apply.start', '应用动态图形标题模板', { context: { projectId, sequenceId } })
  try { const ids = placeTitleTemplate(projectId, sequenceId, template, parameters, placement); logger.info('title_template.apply.completed', '标题模板已添加', { context: { projectId, sequenceId, clipIds: ids } }); return ids }
  catch (error) { logger.error('title_template.apply.failed', '标题模板应用失败', { error, context: { projectId, sequenceId } }); throw error }
}
function placeTitleTemplate(projectId: string, sequenceId: string, template: TitleTemplate | string, parameters: Partial<TitleTemplateParameters>, placement?: VideoEditDropPlacement): string[] {
  const owner = requireVideoEditInstance(projectId); const value = typeof template === 'string' ? requireTitleTemplate(template) : template
  const ids: string[] = []
  editVideoProject(projectId, document => {
    const sequence = document.sequences.find(sequence => sequence.id === sequenceId)
    if (!sequence) throw new Error('原标题落点序列不存在。')
    const snapshots = instantiateTitleTemplate(value, parameters, sequence)
    const frame = placement?.frame ?? (owner.activeSequenceId === sequenceId ? owner.frame : 0)
    const track = placement?.track ?? sequence.tracks.filter(track => track.kind === 'video' && !track.locked && track.enabled).sort((a, b) => b.index - a.index)[0]?.index
    const added = placement?.newTrack === 'video' ? videoEditEdgeTracks(sequence, 'video', new Set(snapshots.map(clip => clip.track)).size) : []
    if (placement?.newTrack === 'audio' || (!added.length && track === undefined)) throw new Error('标题需要可用的视频轨道。')
    const base = added[0]?.index ?? track!; const layers = [...new Set(snapshots.map(clip => clip.track))].sort((a, b) => a - b)
    const first = [...sequence.tracks, ...added].find(track => track.index === base)
    if (!first || first.kind !== 'video' || first.locked) throw new Error('模板目标轨道必须是未锁定的视频轨。')
    const lanes = [...sequence.tracks, ...added].filter(track => track.kind === 'video' && track.index >= base && !track.locked && (track.index === base || track.enabled)).sort((a, b) => a.index - b.index)
    if (lanes.length < layers.length) { const extra = videoEditEdgeTracks({ tracks: [...sequence.tracks, ...added] }, 'video', layers.length - lanes.length); added.push(...extra); lanes.push(...extra) }
    const trackMap = new Map(layers.map((layer, index) => [layer, lanes[index].index]))
    const next = { ...document, items: [...document.items], sequences: document.sequences.map(candidate => candidate.id === sequenceId ? { ...candidate, tracks: [...candidate.tracks, ...added] } : candidate) }
    const groupId = crypto.randomUUID()
    const clips = snapshots.map(snapshot => {
      const itemId = crypto.randomUUID(); next.items.push({ id: itemId, name: snapshot.name, kind: snapshot.kind, ...(snapshot.graphic ? { graphic: structuredClone(snapshot.graphic) } : {}) })
      const clip = { ...makeVideoEditItemClip(next, itemId, sequenceId, { frame: frame + snapshot.start, track: trackMap.get(snapshot.track), duration: snapshot.duration }), ...snapshot, id: crypto.randomUUID(), itemId, groupId, start: frame + snapshot.start, track: trackMap.get(snapshot.track)! }
      ids.push(clip.id); return clip
    })
    const targetSequence = next.sequences.find(value => value.id === sequenceId)!
    const mode = placement?.mode ?? 'top'
    const resolved = resolveVideoEditDropMode(mode === 'top' ? { ...targetSequence, tracks: targetSequence.tracks.map(track => ({ ...track, locked: track.locked || !track.enabled })) } : targetSequence, clips, { frame, mode, targetTrackIds: owner.targetTrackIds })
    const result = applyVideoEditTimelineEditResult({ ...document, items: next.items }, sequenceId, { kind: 'place', mode: resolved.mode, frame: resolved.frame, clipboard: { projectId, frameRate: sequence.frameRate, clips: resolved.clips, annotations: [] }, newTracks: [...added, ...resolved.newTracks], ...(resolved.mode === 'insert' ? { targetTracks: [...new Set(resolved.clips.map(clip => clip.track))] } : {}) })
    ids.splice(0, ids.length, ...(result.selectedClipIds ?? []))
    return { ...next, sequences: next.sequences.map(candidate => candidate.id === sequenceId ? result.sequence : candidate) }
  })
  if (owner.activeSequenceId === sequenceId) setVideoEditView(projectId, { selection: ids[0] ?? null })
  return ids
}
export function saveTitleTemplateSelection(projectId: string, sequenceId: string, clipIds: readonly string[], name: string): TitleTemplate {
  const sequence = requireVideoEditInstance(projectId).document.sequences.find(sequence => sequence.id === sequenceId)
  if (!sequence || !clipIds.length || clipIds.some(id => !sequence.clips.some(clip => clip.id === id))) throw new Error('请选择原序列中的文字或图形组合。')
  const template = captureTitleTemplate(name, sequence, sequence.clips.filter(clip => clipIds.includes(clip.id)))
  const library = useTitleTemplateLibrary.getState(); library.replace([...library.templates, template]); return template
}
/** Parameter editing retains clip/item identities and enters the same undo stack as graphic-object editing. */
export function editTitleTemplateSelection(projectId: string, sequenceId: string, clipIds: readonly string[], parameters: Partial<TitleTemplateParameters>, gesture?: import('./videoEditService').VideoEditGesture): void {
  editVideoSequence(projectId, sequenceId, sequence => {
    assertVideoEditClipsEditable(sequence, [...clipIds])
    const clips = sequence.clips.filter(clip => clipIds.includes(clip.id)); const template = captureTitleTemplate('标题', sequence, clips); const start = Math.min(...clips.map(clip => clip.start))
    if (clips.length !== clipIds.length) throw new Error('原选中标题已有移除，请重新选择。')
    const snapshots = instantiateTitleTemplate(template, parameters, sequence)
    const edited = clips.map((clip, index) => {
      const snapshot = snapshots[index]
      snapshot.graphic?.objects.forEach((object, objectIndex) => { object.id = clip.graphic!.objects[objectIndex].id })
      return { ...clip, ...snapshot, start: start + snapshot.start, track: clip.track }
    })
    return { ...sequence, clips: sequence.clips.map(clip => edited.find(value => value.id === clip.id) ?? clip) }
  }, gesture)
}
