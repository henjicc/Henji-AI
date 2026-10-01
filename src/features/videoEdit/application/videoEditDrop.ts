import { HENJI_DRAG_DATA_MIME, readHenjiDragData } from '@/contexts/dragDataTransfer'
import { getPlatform } from '@/platform/runtime'
import { importVideoEditSources, type VideoEditImportSource } from './videoEditMedia'
import { editVideoProject, requireVideoEditInstance, setVideoEditView, switchVideoEditSequence } from './videoEditService'
import { makeVideoEditItemClip, makeVideoEditItemSequence, type VideoEditSequenceSettings } from '@/core/videoEdit/projectItems'
import type { VideoEditDocument } from '@/core/videoEdit/document'
import { readVideoEditCodeMetadata } from './videoEditCodeState'
import { VIDEO_EDIT_SOURCE_DRAG_MIME, videoEditSourceRangeSchema, placeVideoEditSourceRange, type VideoEditSourceRange } from './videoEditSourceRange'
import { CODE_ASSET_DRAG_MIME, readCodeAssetDrag } from '@/features/assets/drag/assetDragPayload'
import { importVideoEditCodeAsset } from './videoEditCodeAssets'

export const VIDEO_EDIT_ITEM_DRAG_MIME = 'application/x-henji-video-edit-items'
export type VideoEditDropInput = { kind: 'items'; projectId: string; itemIds: string[] } | { kind: 'sources'; sources: VideoEditImportSource[] } | { kind: 'code_asset'; assetId: string } | VideoEditSourceRange
export function writeVideoEditItemDrag(transfer: DataTransfer, projectId: string, itemIds: string[]): void {
  transfer.setData(VIDEO_EDIT_ITEM_DRAG_MIME, JSON.stringify({ projectId, itemIds }))
}
export function readVideoEditDrop(transfer: DataTransfer): VideoEditDropInput {
  if (transfer.types.includes(CODE_ASSET_DRAG_MIME)) { const assetId = readCodeAssetDrag(transfer); if (!assetId) throw new Error('代码资产引用无效。'); return { kind: 'code_asset', assetId } }
  if (transfer.types.includes(VIDEO_EDIT_SOURCE_DRAG_MIME)) return videoEditSourceRangeSchema.parse(JSON.parse(transfer.getData(VIDEO_EDIT_SOURCE_DRAG_MIME)))
  if (transfer.types.includes(VIDEO_EDIT_ITEM_DRAG_MIME)) {
    const raw: unknown = JSON.parse(transfer.getData(VIDEO_EDIT_ITEM_DRAG_MIME))
    if (typeof raw !== 'object' || raw === null || !('projectId' in raw) || typeof raw.projectId !== 'string' || !('itemIds' in raw) || !Array.isArray(raw.itemIds) || !raw.itemIds.length || raw.itemIds.length > 500 || !raw.itemIds.every(id => typeof id === 'string' && id.length > 0 && id.length <= 100)) throw new Error('项目项拖拽数据无效。')
    return { kind: 'items', projectId: raw.projectId, itemIds: raw.itemIds as string[] }
  }
  const payload = readHenjiDragData(transfer)
  if (payload?.assetId) return { kind: 'sources', sources: [{ assetId: payload.assetId }] }
  if (payload?.filePath) return { kind: 'sources', sources: [{ path: payload.filePath }] }
  return { kind: 'sources', sources: videoEditDropPaths(transfer).map(path => ({ path })) }
}

export function acceptsVideoEditDrop(transfer: DataTransfer): boolean {
  return transfer.types.includes(CODE_ASSET_DRAG_MIME) || transfer.types.includes(VIDEO_EDIT_SOURCE_DRAG_MIME) || transfer.types.includes(VIDEO_EDIT_ITEM_DRAG_MIME) || transfer.types.includes(HENJI_DRAG_DATA_MIME) || transfer.types.includes('Files')
}
export function videoEditDropPaths(transfer: DataTransfer): string[] {
  const payload = readHenjiDragData(transfer)
  if (payload?.assetId) throw new Error('素材库拖入须通过正式素材引用解析。')
  if (payload?.filePath) return [payload.filePath]
  const paths = Array.from(transfer.files).map(file => getPlatform().media.getPathForFile(file)).filter(Boolean)
  if (!paths.length) throw new Error('请拖入本地文件，或先将生成素材保存到磁盘。')
  return paths
}
/** Placement is captured before metadata I/O; switching projects cannot redirect a drop. */
export async function dropVideoEditInput(projectId: string, input: VideoEditDropInput, placement?: { frame: number; track?: number }, binId?: string, options: { sequenceId?: string; createSequenceWhenEmpty?: boolean; sequenceSettings?: VideoEditSequenceSettings } = {}): Promise<string[]> {
  const owner = requireVideoEditInstance(projectId)
  const targetTrackIds = owner.targetTrackIds.slice()
  const sequenceId = options.sequenceId ?? owner.activeSequenceId
  const filterTarget = owner.selection ? { sequenceId, clipId: owner.selection } : undefined
  if (input.kind === 'source_range') {
    if (!placement) throw new Error('请把源范围拖入时间线或节目监视器。')
    return placeVideoEditSourceRange(projectId, input, sequenceId, placement)
  }
  let createdId: string | undefined; let selectedClip: string | undefined
  if (input.kind === 'items' && input.projectId !== projectId) throw new Error('请先将源文件导入当前工程，不能跨工程引用项目项。')
  const apply = (document: VideoEditDocument, ids: string[]): VideoEditDocument => {
    if (!placement || !ids.length) return document
    const sequence = document.sequences.find(sequence => sequence.id === sequenceId)
    if (!sequence) throw new Error('原落点序列已移除，请重新拖入。')
    if (options.createSequenceWhenEmpty) {
      if (sequence.clips.length) throw new Error('原空序列已有新的剪辑，请重新拖入并选择落点。')
      const created = makeVideoEditItemSequence(document, ids, options.sequenceSettings, readVideoEditCodeMetadata(owner, document))
      createdId = created.id; selectedClip = created.clips.at(-1)?.id
      return { ...document, sequences: [...document.sequences, created] }
    }
    let frame = placement.frame
    const clips = ids.map(itemId => {
      const kind = document.items.find(item => item.id === itemId)?.kind === 'audio' ? 'audio' : 'video'
      const track = placement.track ?? sequence.tracks.find(track => targetTrackIds.includes(track.id) && track.kind === kind)?.index
      const clip = makeVideoEditItemClip(document, itemId, sequenceId, { frame, track }, readVideoEditCodeMetadata(owner, document)); frame += clip.duration; return clip
    })
    selectedClip = clips.at(-1)?.id
    return { ...document, sequences: document.sequences.map(item => item.id === sequenceId ? { ...item, clips: [...item.clips, ...clips] } : item) }
  }
  let ids: string[]
  if (input.kind === 'items') ids = input.itemIds
  else if (input.kind === 'code_asset') { const result = await importVideoEditCodeAsset(projectId, input.assetId, { binId, filterTarget, afterImport: apply }); ids = result.itemId ? [result.itemId] : [] }
  else ids = await importVideoEditSources(projectId, input.sources, binId, undefined, apply)
  if (input.kind === 'items') editVideoProject(projectId, document => apply(document, ids))
  if (createdId && owner.activeSequenceId === sequenceId) switchVideoEditSequence(projectId, createdId)
  if (selectedClip && owner.activeSequenceId === (createdId ?? sequenceId)) setVideoEditView(projectId, { selection: selectedClip })
  return ids
}
