import { videoEditBinSchema, videoEditItemSchema, type VideoEditItem } from '@/core/videoEdit/document'
import { makeVideoEditItemClip, makeVideoEditItemSequence, removeVideoEditBins, removeVideoEditItems, videoEditItemUsage, type VideoEditSequenceSettings } from '@/core/videoEdit/projectItems'
import { editVideoProject, requireVideoEditInstance, setVideoEditView, switchVideoEditSequence } from './videoEditService'
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
  const item = makeVideoEditGraphicItem(input, sequence)
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
    if (ids.some(id => !document.items.some(item => item.id === id))) throw new Error('项目项不存在。')
    if (values.name && ids.length !== 1) throw new Error('请逐个重命名项目项。')
    return { ...document, items: document.items.map(item => ids.includes(item.id) ? videoEditItemSchema.parse({ ...item, ...values, ...(values.binId === null ? { binId: undefined } : {}) }) : item) }
  })
}
export function deleteVideoEditItems(projectId: string, ids: string[]): void { editVideoProject(projectId, document => removeVideoEditItems(document, ids)) }
export function deleteVideoEditBins(projectId: string, ids: string[]): void { editVideoProject(projectId, document => removeVideoEditBins(document, ids)) }
export function appendVideoEditItems(projectId: string, itemIds: string[], sequenceId: string, placement?: { frame: number; track?: number }): string[] {
  const instance = requireVideoEditInstance(projectId)
  let frame = placement?.frame ?? (instance.activeSequenceId === sequenceId ? instance.frame : instance.sequenceViews.get(sequenceId)?.frame ?? 0)
  const clips = itemIds.map(itemId => { const clip = makeVideoEditItemClip(instance.document, itemId, sequenceId, { frame, track: placement?.track }, readVideoEditCodeMetadata(instance, instance.document)); frame += clip.duration; return clip })
  editVideoProject(projectId, document => ({ ...document, sequences: document.sequences.map(sequence => sequence.id === sequenceId ? { ...sequence, clips: [...sequence.clips, ...clips] } : sequence) }))
  if (instance.activeSequenceId === sequenceId && clips.length) setVideoEditView(projectId, { selection: clips.at(-1)!.id })
  return clips.map(clip => clip.id)
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
