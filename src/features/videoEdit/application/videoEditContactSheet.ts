import { videoEditDuration, type VideoEditComposition } from '@/core/videoEdit/document'
import { videoEditFrameTimecode } from '@/core/videoEdit/timecode'
import { BLACK_HEX, WHITE_HEX } from '@/core/theme/colorTokens'
import { trialVideoEditCodeFrames } from './videoEditCodeTrial'

export interface VideoEditContactSheetRange { startFrame: number; endFrame: number; frameCount: number }
export interface VideoEditContactSheetLayout { frames: number[]; columns: number; rows: number; width: number; height: number; cellWidth: number; cellHeight: number }

/** 区间含两端，按整数帧均匀采样；总图长宽均受 3840 像素预算约束。 */
export function videoEditContactSheetLayout(composition: VideoEditComposition, range: VideoEditContactSheetRange, maxWidth: number): VideoEditContactSheetLayout {
  const duration = videoEditDuration(composition)
  if (!Number.isSafeInteger(range.startFrame) || range.startFrame < 0 || range.startFrame >= duration) throw new Error('target.startFrame 必须位于序列时长内。')
  if (!Number.isSafeInteger(range.endFrame) || range.endFrame <= range.startFrame || range.endFrame >= duration) throw new Error('target.endFrame 必须大于 startFrame 且位于序列时长内（含末帧）。')
  if (!Number.isSafeInteger(range.frameCount) || range.frameCount < 2 || range.frameCount > 12 || range.frameCount > range.endFrame - range.startFrame + 1) throw new Error('target.frameCount 必须为 2–12，且不能超过区间内不同帧的数量。')
  const frames = Array.from({ length: range.frameCount }, (_, index) => Math.round(range.startFrame + (range.endFrame - range.startFrame) * index / (range.frameCount - 1)))
  const columns = Math.ceil(Math.sqrt(frames.length)); const rows = Math.ceil(frames.length / columns)
  const cellWidth = Math.max(1, Math.min(composition.width, Math.floor(maxWidth / columns), Math.floor(3840 / rows * composition.width / composition.height)))
  const cellHeight = Math.max(1, Math.min(Math.floor(3840 / rows), Math.round(cellWidth * composition.height / composition.width)))
  return { frames, columns, rows, width: cellWidth * columns, height: cellHeight * rows, cellWidth, cellHeight }
}

/** 逐帧使用正式试渲染队列，及时释放位图；不移动播放头、不产生中间资产。 */
export async function renderVideoEditContactSheet(composition: VideoEditComposition, range: VideoEditContactSheetRange, maxWidth: number, signal: AbortSignal): Promise<VideoEditContactSheetLayout & { bytes: Uint8Array }> {
  const layout = videoEditContactSheetLayout(composition, range, maxWidth)
  const canvas = new OffscreenCanvas(layout.width, layout.height); const context = canvas.getContext('2d')
  if (!context) throw new Error('无法生成联系表图片。')
  context.fillStyle = BLACK_HEX; context.fillRect(0, 0, layout.width, layout.height)
  context.imageSmoothingQuality = 'high'
  for (const [index, frame] of layout.frames.entries()) {
    signal.throwIfAborted()
    const bitmap = await trialVideoEditCodeFrames([{ document: composition, frame }], signal, true)
    if (!bitmap) throw new Error(`target 联系表帧 ${frame} 没有渲染结果。`)
    try {
      const x = index % layout.columns * layout.cellWidth; const y = Math.floor(index / layout.columns) * layout.cellHeight
      context.drawImage(bitmap, x, y, layout.cellWidth, layout.cellHeight)
      const fontSize = Math.max(12, Math.min(24, Math.round(layout.cellWidth / 24)))
      const label = videoEditFrameTimecode(frame, composition.fps)
      context.font = `${fontSize}px sans-serif`; context.textBaseline = 'top'
      context.fillStyle = BLACK_HEX; context.fillRect(x, y, context.measureText(label).width + 8, fontSize + 8)
      context.fillStyle = WHITE_HEX; context.fillText(label, x + 4, y + 4)
    } finally { bitmap.close() }
  }
  signal.throwIfAborted()
  return { ...layout, bytes: new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer()) }
}
