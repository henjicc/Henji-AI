import { HENJI_DRAG_DATA_MIME, readHenjiDragData } from '@/contexts/dragDataTransfer'
import { getPlatform } from '@/platform/runtime'
import { importVideoEditSources, type VideoEditImportSource } from './videoEditMedia'
import { editVideoProject, requireVideoEditInstance, setVideoEditView } from './videoEditService'
import { placeVideoEditItems, videoEditSequenceFromItem, type VideoEditSequenceSettings } from '@/core/videoEdit/projectItems'
import type { VideoEditClip, VideoEditDocument } from '@/core/videoEdit/document'
import type { CodeMaterialMetadataReader } from '@/core/videoEdit/codeMaterialDocument'
import { readVideoEditCodeMetadata } from './videoEditCodeState'
import { VIDEO_EDIT_SOURCE_DRAG_MIME, videoEditSourceRangeSchema, placeVideoEditSourceRange, type VideoEditSourceRange } from './videoEditSourceRange'
import { CODE_ASSET_DRAG_MIME, readCodeAssetDrag } from '@/features/assets/drag/assetDragPayload'
import { importVideoEditCodeAsset } from './videoEditCodeAssets'
import { importVideoEditPathsAndFolders } from './videoEditFolderImport'
import { videoEditEdgeTracks } from '@/core/videoEdit/tracks'
import { rescaleVideoEditFrame, type VideoEditRatio } from '@/core/videoEdit/time'

export const VIDEO_EDIT_ITEM_DRAG_MIME = 'application/x-henji-video-edit-items'
export type VideoEditDropInput = { kind: 'items'; projectId: string; itemIds: string[] } | { kind: 'sources'; sources: VideoEditImportSource[] } | { kind: 'code_asset'; assetId: string } | VideoEditSourceRange
/**
 * 正在从素材面板拖出的素材项。拖动经过时间线时浏览器不让读拖拽数据（只能读类型），
 * 时间线按这份记录预演落点、画出片段虚影（所见即所得）；松手或取消后清空。
 */
let activeItemDrag: { projectId: string; itemIds: string[] } | null = null
export function writeVideoEditItemDrag(transfer: DataTransfer, projectId: string, itemIds: string[]): void {
  transfer.setData(VIDEO_EDIT_ITEM_DRAG_MIME, JSON.stringify({ projectId, itemIds }))
  activeItemDrag = { projectId, itemIds: [...itemIds] }
}
export function endVideoEditItemDrag(): void { activeItemDrag = null }
export function readActiveVideoEditItemDrag(): { projectId: string; itemIds: readonly string[] } | null { return activeItemDrag }
export function readVideoEditDrop(transfer: DataTransfer): VideoEditDropInput {
  if (transfer.types.includes(CODE_ASSET_DRAG_MIME)) { const assetId = readCodeAssetDrag(transfer); if (!assetId) throw new Error('代码资产引用无效。'); return { kind: 'code_asset', assetId } }
  if (transfer.types.includes(VIDEO_EDIT_SOURCE_DRAG_MIME)) return videoEditSourceRangeSchema.parse(JSON.parse(transfer.getData(VIDEO_EDIT_SOURCE_DRAG_MIME)))
  if (transfer.types.includes(VIDEO_EDIT_ITEM_DRAG_MIME)) {
    const raw: unknown = JSON.parse(transfer.getData(VIDEO_EDIT_ITEM_DRAG_MIME))
    if (typeof raw !== 'object' || raw === null || !('projectId' in raw) || typeof raw.projectId !== 'string' || !('itemIds' in raw) || !Array.isArray(raw.itemIds) || !raw.itemIds.length || raw.itemIds.length > 500 || !raw.itemIds.every(id => typeof id === 'string' && id.length > 0 && id.length <= 100)) throw new Error('素材项拖拽数据无效。')
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
/**
 * 把素材项按落点放进序列（拖放与拖动中的虚影预演共用，保证所见即所得）。
 * 拖进空序列（Premiere“更改序列设置”）：仍放进这条序列、落在松手的位置，序列的画面尺寸与帧率改成第一个素材的，
 * 不另建序列；落点帧按新帧率换算，保持同一时刻。
 */
export function placeVideoEditDrop(source: VideoEditDocument, ids: readonly string[], sequenceId: string, placement: VideoEditDropPlacement, options: { targetTrackIds: readonly string[]; matchEmptySequence?: boolean; sequenceSettings?: VideoEditSequenceSettings; codeMetadata?: CodeMaterialMetadataReader }): { document: VideoEditDocument; selectedClip?: string; placedClips: VideoEditClip[]; frameRate: VideoEditRatio } {
  const original = source.sequences.find(sequence => sequence.id === sequenceId)
  if (!original) throw new Error('原落点序列已移除，请重新拖入。')
  let document = source; let sequence = original; let frame = placement.frame
  if (options.matchEmptySequence && !original.clips.length) {
    const matched = videoEditSequenceFromItem(source, ids[0], options.sequenceSettings, options.codeMetadata)
    sequence = { ...original, width: matched.width, height: matched.height, frameRate: matched.frameRate }
    frame = rescaleVideoEditFrame(placement.frame, original.frameRate, sequence.frameRate)
    document = { ...source, sequences: source.sequences.map(item => item.id === sequenceId ? sequence : item) }
  }
  const target = (kind: 'video' | 'audio'): number | undefined => sequence.tracks.find(track => options.targetTrackIds.includes(track.id) && track.kind === kind)?.index
  // Dropped beyond the outer tracks: the new track takes the place of that kind's target; it is kept only when used.
  const edge = placement.newTrack ? videoEditEdgeTracks(sequence, placement.newTrack, 1)[0] : undefined
  const base = edge ? { ...document, sequences: document.sequences.map(item => item.id === sequenceId ? { ...item, tracks: [...item.tracks, edge] } : item) } : document
  const video = edge?.kind === 'video' ? edge.index : target('video'); const audio = edge?.kind === 'audio' ? edge.index : target('audio')
  // Multi-track sound spreads over consecutive audio tracks from the targeted one (task 2.6).
  const placed = placeVideoEditItems(base, ids, sequenceId, { frame, ...(placement.track !== undefined ? { track: placement.track } : {}), ...(video !== undefined ? { videoTrack: video } : {}), ...(audio !== undefined ? { audioTrack: audio } : {}) }, options.codeMetadata)
  const created = edge && placed.clips.some(clip => clip.track === edge.index) ? [edge] : []
  return {
    document: { ...document, sequences: document.sequences.map(item => item.id === sequenceId ? { ...item, tracks: [...item.tracks, ...created, ...placed.addedTracks], clips: [...item.clips, ...placed.clips] } : item) },
    ...(placed.primaryIds.length ? { selectedClip: placed.primaryIds.at(-1)! } : {}),
    placedClips: placed.clips,
    frameRate: sequence.frameRate,
  }
}
/** Placement is captured before metadata I/O; switching projects cannot redirect a drop. */
/** `newTrack`: dropped above the top video track / below the bottom audio track — a new track of that kind is created (PR). */
export interface VideoEditDropPlacement { frame: number; track?: number; newTrack?: 'video' | 'audio' }
export async function dropVideoEditInput(projectId: string, input: VideoEditDropInput, placement?: VideoEditDropPlacement, binId?: string, options: { sequenceId?: string; createSequenceWhenEmpty?: boolean; sequenceSettings?: VideoEditSequenceSettings; onSkipped?: (count: number) => void } = {}): Promise<string[]> {
  const owner = requireVideoEditInstance(projectId)
  const targetTrackIds = owner.targetTrackIds.slice()
  const sequenceId = options.sequenceId ?? owner.activeSequenceId
  const filterTarget = owner.selection ? { sequenceId, clipId: owner.selection } : undefined
  if (input.kind === 'source_range') {
    if (!placement) throw new Error('请把源范围拖入时间线或节目监视器。')
    return placeVideoEditSourceRange(projectId, input, sequenceId, placement)
  }
  let selectedClip: string | undefined
  if (input.kind === 'items' && input.projectId !== projectId) throw new Error('请先将源文件导入当前剪辑，不能跨剪辑引用素材项。')
  const apply = (source: VideoEditDocument, ids: string[]): VideoEditDocument => {
    if (!placement || !ids.length) return source
    const result = placeVideoEditDrop(source, ids, sequenceId, placement, { targetTrackIds, matchEmptySequence: Boolean(options.createSequenceWhenEmpty), ...(options.sequenceSettings ? { sequenceSettings: options.sequenceSettings } : {}), codeMetadata: readVideoEditCodeMetadata(owner, source) })
    selectedClip = result.selectedClip
    return result.document
  }
  let ids: string[]
  if (input.kind === 'items') ids = input.itemIds
  else if (input.kind === 'code_asset') { const result = await importVideoEditCodeAsset(projectId, input.assetId, { binId, filterTarget, afterImport: apply }); ids = result.itemId ? [result.itemId] : [] }
  else if (input.sources.every(source => source.path && !source.assetId)) {
    // 本地路径可能是文件夹（Premiere：拖入文件夹即按层级建素材箱）。
    const result = await importVideoEditPathsAndFolders(projectId, input.sources.map(source => source.path!), binId, apply)
    ids = result.itemIds
    if (result.skipped) options.onSkipped?.(result.skipped)
  } else ids = await importVideoEditSources(projectId, input.sources, binId, undefined, apply)
  if (input.kind === 'items') editVideoProject(projectId, document => apply(document, ids))
  if (selectedClip && owner.activeSequenceId === sequenceId) setVideoEditView(projectId, { selection: selectedClip })
  return ids
}
