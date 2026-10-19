import type { CodeFramePerformance } from '@/core/videoEdit/codeMaterial/performance'
import { videoEditDuration, type VideoEditComposition } from '@/core/videoEdit/document'
import { videoEditFrameTimecode } from '@/core/videoEdit/timecode'
import { BLACK_HEX, WHITE_HEX } from '@/core/theme/colorTokens'
import { trialVideoEditCodeFrames } from './videoEditCodeTrial'
import { videoEditObservationFrames, videoEditObservationPixelCrop, type VideoEditObservationFrames, type VideoEditObservationRegion } from '@/core/videoEdit/frameObservation'

export interface VideoEditContactSheetRange { startFrame: number; endFrame: number; frameCount: number }
export interface VideoEditContactSheetOptions {
  cropRegion?: VideoEditObservationRegion
  reference?: (frame: number) => { document: VideoEditComposition; frame: number; label: string }
}
export interface VideoEditContactSheetLayout { frames: number[]; columns: number; rows: number; width: number; height: number; cellWidth: number; cellHeight: number }

/** 区间含两端，按整数帧均匀采样；总图长宽均受 3840 像素预算约束。 */
export function videoEditContactSheetLayout(composition: VideoEditComposition, range: VideoEditObservationFrames, maxWidth: number, options: VideoEditContactSheetOptions = {}): VideoEditContactSheetLayout {
  const frames = videoEditObservationFrames(videoEditDuration(composition), range)
  const pairs = options.reference ? 2 : 1
  const columns = Math.ceil(Math.sqrt(frames.length)) * pairs; const rows = Math.ceil(frames.length * pairs / columns)
  const crop = videoEditObservationPixelCrop(composition.width, composition.height, options.cropRegion)
  const cellWidth = Math.max(1, Math.min(options.cropRegion ? maxWidth : crop.width, Math.floor(maxWidth / columns), Math.floor(3840 / rows * crop.width / crop.height)))
  const cellHeight = Math.max(1, Math.min(Math.floor(3840 / rows), Math.round(cellWidth * crop.height / crop.width)))
  return { frames, columns, rows, width: cellWidth * columns, height: cellHeight * rows, cellWidth, cellHeight }
}

/** 逐帧使用正式试渲染队列，及时释放位图；不移动播放头、不产生中间资产。 */
export async function renderVideoEditContactSheet(composition: VideoEditComposition, range: VideoEditObservationFrames, maxWidth: number, signal: AbortSignal, measurements?: CodeFramePerformance[], options: VideoEditContactSheetOptions = {}): Promise<VideoEditContactSheetLayout & { bytes: Uint8Array }> {
  const layout = videoEditContactSheetLayout(composition, range, maxWidth, options)
  const canvas = new OffscreenCanvas(layout.width, layout.height); const context = canvas.getContext('2d')
  if (!context) throw new Error('无法生成联系表图片。')
  context.fillStyle = BLACK_HEX; context.fillRect(0, 0, layout.width, layout.height)
  context.imageSmoothingQuality = 'high'
  const cells = layout.frames.flatMap(frame => [{ document: composition, frame, label: videoEditFrameTimecode(frame, composition.fps) }, ...(options.reference ? [options.reference(frame)] : [])])
  for (const [index, cell] of cells.entries()) {
    signal.throwIfAborted()
    const bitmap = await trialVideoEditCodeFrames([{ document: cell.document, frame: cell.frame }], signal, true, undefined, measurements)
    if (!bitmap) throw new Error(`target 联系表帧 ${cell.frame} 没有渲染结果。`)
    try {
      const x = index % layout.columns * layout.cellWidth; const y = Math.floor(index / layout.columns) * layout.cellHeight
      const crop = videoEditObservationPixelCrop(bitmap.width, bitmap.height, options.cropRegion)
      const scale = Math.min(layout.cellWidth / crop.width, layout.cellHeight / crop.height)
      const width = crop.width * scale; const height = crop.height * scale
      const left = x + (layout.cellWidth - width) / 2; const top = y + (layout.cellHeight - height) / 2
      if (options.cropRegion) context.drawImage(bitmap, crop.x, crop.y, crop.width, crop.height, left, top, width, height)
      else context.drawImage(bitmap, left, top, width, height)
      const fontSize = Math.max(12, Math.min(24, Math.round(layout.cellWidth / 24)))
      const label = cell.label
      context.font = `${fontSize}px sans-serif`; context.textBaseline = 'top'
      context.fillStyle = BLACK_HEX; context.fillRect(x, y, context.measureText(label).width + 8, fontSize + 8)
      context.fillStyle = WHITE_HEX; context.fillText(label, x + 4, y + 4)
    } finally { bitmap.close() }
  }
  signal.throwIfAborted()
  return { ...layout, bytes: new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer()) }
}
