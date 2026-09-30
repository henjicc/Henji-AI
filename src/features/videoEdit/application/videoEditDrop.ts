import { HENJI_DRAG_DATA_MIME, readHenjiDragData } from '@/contexts/dragDataTransfer'
import { getPlatform } from '@/platform/runtime'
import { importVideoEditPaths, sameVideoEditMediaPath } from './videoEditMedia'
import { appendVideoEditClip, requireVideoEditInstance } from './videoEditService'

export function acceptsVideoEditDrop(transfer: DataTransfer): boolean {
  return transfer.types.includes(HENJI_DRAG_DATA_MIME) || transfer.types.includes('Files')
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
  const sequenceId = requireVideoEditInstance(projectId).activeSequenceId
  await importVideoEditPaths(projectId, paths)
  if (!placement) return
  let frame = placement.frame
  for (const path of paths) {
    const instance = requireVideoEditInstance(projectId)
    const media = instance.document.media.find(item => sameVideoEditMediaPath(item.path, path))
    if (!media) throw new Error('无法找到已导入的素材。')
    appendVideoEditClip(projectId, media.id, { frame, track: placement.track }, sequenceId)
    const selected = instance.document.sequences.find(sequence => sequence.id === sequenceId)?.clips.at(-1)
    frame += selected?.duration ?? 0
  }
}
