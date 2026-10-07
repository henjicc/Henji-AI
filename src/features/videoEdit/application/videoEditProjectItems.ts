import { useSettingsStore } from '@/stores/settingsStore'
import type { VideoEditLabel } from '@/core/videoEdit/labels'
import { videoEditBinSchema, videoEditItemSchema, type VideoEditItem } from '@/core/videoEdit/document'
import { placeVideoEditItems, makeVideoEditItemSequence, removeVideoEditBins, removeVideoEditItems, videoEditItemUsage, type VideoEditSequenceSettings } from '@/core/videoEdit/projectItems'
import { editVideoProject, editVideoSequence, requireVideoEditInstance, setVideoEditView, switchVideoEditSequence } from './videoEditService'
import { assertVideoEditClipsEditable } from '@/core/videoEdit/lockedTracks'
import { videoEditAudioMappingSchema, videoEditAudioLayoutSchema, type VideoEditAudioMapping } from '@/core/videoEdit/audioChannels'
import { readVideoEditCodeMetadata } from './videoEditCodeState'
import { createVideoEditGraphic } from '@/core/videoEdit/graphics'

export { videoEditItemUsage }
export type { VideoEditSequenceSettings }
export interface VideoEditGraphicItemInput { kind: 'solid' | 'rect' | 'ellipse' | 'text'; width?: number; height?: number; name?: string; binId?: string }
export function makeVideoEditGraphicItem(input: VideoEditGraphicItemInput, dimensions: { width: number; height: number }): VideoEditItem {
  const graphic = createVideoEditGraphic(input.kind, input.width ?? dimensions.width, input.height ?? dimensions.height)
  return videoEditItemSchema.parse({ id: crypto.randomUUID(), kind: 'graphic', name: input.name ?? graphic.objects[0].name, graphic, ...(input.binId ? { binId: input.binId } : {}) })
}
export function createVideoEditGraphicItem(projectId: string, input: VideoEditGraphicItemInput): string {
  const owner = requireVideoEditInstance(projectId)
  const sequence = owner.document.sequences.find(sequence => sequence.id === owner.activeSequenceId)!
  const item = makeVideoEditGraphicItem(input, sequence ?? useSettingsStore.getState().videoEditSequenceDefaults)
  editVideoProject(projectId, document => ({ ...document, items: [...document.items, item] })); return item.id
}
export function createVideoEditAdjustmentItem(projectId: string, input: { name?: string; binId?: string } = {}): string {
  const item = videoEditItemSchema.parse({ id: crypto.randomUUID(), kind: 'adjustment', name: input.name ?? '调整图层', ...(input.binId ? { binId: input.binId } : {}) })
  editVideoProject(projectId, document => ({ ...document, items: [...document.items, item] })); return item.id
}
export function createVideoEditBin(projectId: string, name: string, parentId?: string): string {
  const bin = videoEditBinSchema.parse({ id: crypto.randomUUID(), name, ...(parentId ? { parentId } : {}) })
  editVideoProject(projectId, document => ({ ...document, bins: [...document.bins, bin] })); return bin.id
}
export function updateVideoEditBin(projectId: string, binId: string, values: { name?: string; parentId?: string | null }): void {
  editVideoProject(projectId, document => {
    if (!document.bins.some(bin => bin.id === binId)) throw new Error('素材箱不存在。')
    return { ...document, bins: document.bins.map(bin => bin.id === binId ? videoEditBinSchema.parse({ ...bin, ...values, ...(values.parentId === null ? { parentId: undefined } : {}) }) : bin) }
  })
}
export function updateVideoEditItems(projectId: string, ids: string[], values: { name?: string; binId?: string | null; tags?: string[] }): void {
  editVideoProject(projectId, document => {
    if (ids.some(id => !document.items.some(item => item.id === id))) throw new Error('素材项不存在。')
    if (values.name && ids.length !== 1) throw new Error('请逐个重命名素材项。')
    return { ...document, items: document.items.map(item => ids.includes(item.id) ? videoEditItemSchema.parse({ ...item, ...values, ...(values.binId === null ? { binId: undefined } : {}) }) : item) }
  })
}
/** PR“标签”：给素材项、素材箱与序列设置颜色标签（`null` 恢复按类型默认），一步编辑。 */
export function setVideoEditLabels(projectId: string, targets: { itemIds?: readonly string[]; binIds?: readonly string[]; sequenceIds?: readonly string[] }, label: VideoEditLabel | null): void {
  const items = new Set(targets.itemIds ?? []); const bins = new Set(targets.binIds ?? []); const sequences = new Set(targets.sequenceIds ?? [])
  const apply = <T extends { id: string; label?: VideoEditLabel }>(value: T): T => { const next = { ...value }; if (label) next.label = label; else delete next.label; return next }
  editVideoProject(projectId, document => {
    if ([...items].some(id => !document.items.some(item => item.id === id)) || [...bins].some(id => !document.bins.some(bin => bin.id === id)) || [...sequences].some(id => !document.sequences.some(sequence => sequence.id === id))) throw new Error('要设置标签的素材已不存在。')
    return { ...document, items: document.items.map(item => items.has(item.id) ? apply(item) : item), bins: document.bins.map(bin => bins.has(bin.id) ? apply(bin) : bin), sequences: document.sequences.map(sequence => sequences.has(sequence.id) ? apply(sequence) : sequence) }
  })
}
/**
 * Premiere "Modify > Audio Channels" on project items: the layout clips placed from now on use (null: Use File).
 * Clips already in sequences keep their own mapping.
 */
export function setVideoEditItemAudioChannels(projectId: string, itemIds: string[], layout: VideoEditAudioMapping[] | null): void {
  const parsed = layout === null ? null : videoEditAudioLayoutSchema.parse(layout)
  editVideoProject(projectId, document => {
    if (!itemIds.length || itemIds.some(id => !document.items.some(item => item.id === id))) throw new Error('素材项不存在。')
    return { ...document, items: document.items.map(item => { if (!itemIds.includes(item.id)) return item; const next = { ...item }; if (parsed) next.audioChannels = structuredClone(parsed); else delete next.audioChannels; return videoEditItemSchema.parse(next) }) }
  })
}
/** The source channels one timeline clip reads (null: its file's first stream with its own channels). */
export function setVideoEditClipAudioMapping(projectId: string, sequenceId: string, clipIds: string[], mapping: VideoEditAudioMapping | null): void {
  const parsed = mapping === null ? null : videoEditAudioMappingSchema.parse(mapping)
  editVideoSequence(projectId, sequenceId, sequence => {
    if (!clipIds.length || clipIds.some(id => !sequence.clips.some(clip => clip.id === id))) throw new Error('片段不存在。')
    assertVideoEditClipsEditable(sequence, clipIds)
    return { ...sequence, clips: sequence.clips.map(clip => { if (!clipIds.includes(clip.id)) return clip; const next = { ...clip }; if (parsed) next.audioMapping = structuredClone(parsed); else delete next.audioMapping; return next }) }
  })
}
export function deleteVideoEditItems(projectId: string, ids: string[]): void { editVideoProject(projectId, document => removeVideoEditItems(document, ids)) }
export function deleteVideoEditBins(projectId: string, ids: string[]): void { editVideoProject(projectId, document => removeVideoEditBins(document, ids)) }
export function appendVideoEditItems(projectId: string, itemIds: string[], sequenceId: string, placement?: { frame: number; track?: number }): string[] {
  const instance = requireVideoEditInstance(projectId)
  const frame = placement?.frame ?? (instance.activeSequenceId === sequenceId ? instance.frame : instance.sequenceViews.get(sequenceId)?.frame ?? 0)
  const placed = placeVideoEditItems(instance.document, itemIds, sequenceId, { frame, ...(placement?.track !== undefined ? { track: placement.track } : {}) }, readVideoEditCodeMetadata(instance, instance.document))
  editVideoProject(projectId, document => ({ ...document, sequences: document.sequences.map(sequence => sequence.id === sequenceId ? { ...sequence, tracks: [...sequence.tracks, ...placed.addedTracks], clips: [...sequence.clips, ...placed.clips] } : sequence) }))
  if (instance.activeSequenceId === sequenceId && placed.primaryIds.length) setVideoEditView(projectId, { selection: placed.primaryIds.at(-1)! })
  return placed.clips.map(clip => clip.id)
}
export function createVideoEditSequenceFromItem(projectId: string, itemId: string, settings: VideoEditSequenceSettings = {}): string {
  return createVideoEditSequenceFromItems(projectId, [itemId], settings)
}
export function createVideoEditSequenceFromItems(projectId: string, itemIds: string[], settings: VideoEditSequenceSettings = {}): string {
  const instance = requireVideoEditInstance(projectId)
  const sequence = makeVideoEditItemSequence(instance.document, itemIds, settings, readVideoEditCodeMetadata(instance, instance.document))
  editVideoProject(projectId, document => ({ ...document, sequences: [...document.sequences, sequence] }))
  switchVideoEditSequence(projectId, sequence.id); setVideoEditView(projectId, { selection: sequence.clips[0].id }); return sequence.id
}
