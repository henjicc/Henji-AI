import { HENJI_DRAG_DATA_MIME, readHenjiDragData } from '@/contexts/dragDataTransfer'
import { getPlatform } from '@/platform/runtime'
import { importVideoEditSources, type VideoEditImportSource } from './videoEditMedia'
import { editVideoProject, requireVideoEditInstance, setVideoEditView, switchVideoEditSequence } from './videoEditService'
import { makeVideoEditItemClip, makeVideoEditItemSequence, type VideoEditSequenceSettings } from '@/core/videoEdit/projectItems'
import type { VideoEditDocument } from '@/core/videoEdit/document'

export const VIDEO_EDIT_ITEM_DRAG_MIME = 'application/x-henji-video-edit-items'
export type VideoEditDropInput = { kind: 'items'; projectId: string; itemIds: string[] } | { kind: 'sources'; sources: VideoEditImportSource[] }
export function writeVideoEditItemDrag(transfer: DataTransfer, projectId: string, itemIds: string[]): void {
  transfer.setData(VIDEO_EDIT_ITEM_DRAG_MIME, JSON.stringify({ projectId, itemIds }))
}
export function readVideoEditDrop(transfer: DataTransfer): VideoEditDropInput {
  if (transfer.types.includes(VIDEO_EDIT_ITEM_DRAG_MIME)) {
    const raw: unknown = JSON.parse(transfer.getData(VIDEO_EDIT_ITEM_DRAG_MIME))
    if (typeof raw !== 'object' || raw === null || !('projectId' in raw) || typeof raw.projectId !== 'string' || !('itemIds' in raw) || !Array.isArray(raw.itemIds) || !raw.itemIds.length || raw.itemIds.length > 500 || !raw.itemIds.every(id => typeof id === 'string' && id.length > 0 && id.length <= 100)) throw new Error('项目项拖拽数据无效。')
    return { kind: 'items', projectId: raw.projectId, itemIds: raw.itemIds as string[] }
  }
  const payload = readHenjiDragData(transfer)
  if (payload?.filePath) return { kind: 'sources', sources: [{ path: payload.filePath, ...(payload.assetId ? { assetId: payload.assetId } : {}) }] }
  return { kind: 'sources', sources: videoEditDropPaths(transfer).map(path => ({ path })) }
}

export function acceptsVideoEditDrop(transfer: DataTransfer): boolean {
  return transfer.types.includes(VIDEO_EDIT_ITEM_DRAG_MIME) || transfer.types.includes(HENJI_DRAG_DATA_MIME) || transfer.types.includes('Files')
}
export function videoEditDropPaths(transfer: DataTransfer): string[] {
  const payload = readHenjiDragData(transfer)
  if (payload?.filePath) return [payload.filePath]
  const paths = Array.from(transfer.files).map(file => getPlatform().media.getPathForFile(file)).filter(Boolean)
  if (!paths.length) throw new Error('请拖入本地文件，或先将生成素材保存到磁盘。')
  return paths
}
/** Placement is captured before metadata I/O; switching projects cannot redirect a drop. */
export async function dropVideoEditPaths(projectId: string, paths: string[], placement?: { frame: number; track: number }): Promise<void> {
  await dropVideoEditInput(projectId, { kind: 'sources', sources: paths.map(path => ({ path })) }, placement)
}
export async function dropVideoEditInput(projectId: string, input: VideoEditDropInput, placement?: { frame: number; track: number }, binId?: string, options: { sequenceId?: string; createSequenceWhenEmpty?: boolean; sequenceSettings?: VideoEditSequenceSettings } = {}): Promise<string[]> {
  const owner = requireVideoEditInstance(projectId)
  const sequenceId = options.sequenceId ?? owner.activeSequenceId
  let createdId: string | undefined; let selectedClip: string | undefined
  if (input.kind === 'items' && input.projectId !== projectId) throw new Error('请先将源文件导入当前工程，不能跨工程引用项目项。')
  const apply = (document: VideoEditDocument, ids: string[]): VideoEditDocument => {
    if (!placement || !ids.length) return document
    const sequence = document.sequences.find(sequence => sequence.id === sequenceId)
    if (!sequence) throw new Error('原落点序列已移除，请重新拖入。')
    if (options.createSequenceWhenEmpty) {
      if (sequence.clips.length) throw new Error('原空序列已有新的剪辑，请重新拖入并选择落点。')
      const created = makeVideoEditItemSequence(document, ids, options.sequenceSettings)
      createdId = created.id; selectedClip = created.clips.at(-1)?.id
      return { ...document, sequences: [...document.sequences, created] }
    }
    let frame = placement.frame
    const clips = ids.map(itemId => { const clip = makeVideoEditItemClip(document, itemId, sequenceId, { frame, track: placement.track }); frame += clip.duration; return clip })
    selectedClip = clips.at(-1)?.id
    return { ...document, sequences: document.sequences.map(item => item.id === sequenceId ? { ...item, clips: [...item.clips, ...clips] } : item) }
  }
  const ids = input.kind === 'items' ? input.itemIds : await importVideoEditSources(projectId, input.sources, binId, undefined, apply)
  if (input.kind === 'items') editVideoProject(projectId, document => apply(document, ids))
  if (createdId && owner.activeSequenceId === sequenceId) switchVideoEditSequence(projectId, createdId)
  if (selectedClip && owner.activeSequenceId === (createdId ?? sequenceId)) setVideoEditView(projectId, { selection: selectedClip })
  return ids
}
