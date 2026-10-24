import type { VideoEditComposition } from '@/core/videoEdit/document'
import type { VideoEditClipPropertyKey } from '../application/videoEditClipProperties'

export type VideoEditPropertyFrame = Pick<VideoEditComposition, 'width' | 'height'>

/**
 * 读数按 PR 的单位显示：位置是序列像素（画面中心为宽高的一半），缩放 / 不透明度 / 音量是百分比，旋转是度。
 * 文档里存的仍是归一化数值，换算只发生在界面上。
 */
export interface VideoEditPropertyView { key: VideoEditClipPropertyKey; label: string; unit?: string; step: number; precision: number; toDisplay: (value: number, frame: VideoEditPropertyFrame) => number; fromDisplay: (value: number, frame: VideoEditPropertyFrame) => number }
const percent = { toDisplay: (value: number) => value * 100, fromDisplay: (value: number) => value / 100, unit: '%', step: 1, precision: 1 }
export const VIDEO_EDIT_PROPERTY_VIEWS: Record<VideoEditClipPropertyKey, VideoEditPropertyView> = {
  x: { key: 'x', label: '水平位置', step: 1, precision: 1, toDisplay: (value, frame) => frame.width / 2 + value * frame.width, fromDisplay: (value, frame) => (value - frame.width / 2) / frame.width },
  y: { key: 'y', label: '垂直位置', step: 1, precision: 1, toDisplay: (value, frame) => frame.height / 2 + value * frame.height, fromDisplay: (value, frame) => (value - frame.height / 2) / frame.height },
  scale: { key: 'scale', label: '缩放', ...percent },
  rotation: { key: 'rotation', label: '旋转', unit: '°', step: 1, precision: 1, toDisplay: value => value, fromDisplay: value => value },
  anchorX: { key: 'anchorX', label: '锚点水平', ...percent },
  anchorY: { key: 'anchorY', label: '锚点垂直', ...percent },
  opacity: { key: 'opacity', label: '不透明度', ...percent },
  volume: { key: 'volume', label: '音量', ...percent },
}

/** 按 PR 单位读出一个数值（时间线速度曲线上的读数用）：位置是像素，缩放等是百分比，旋转是度。 */
export function formatVideoEditPropertyValue(key: VideoEditClipPropertyKey, value: number, frame: VideoEditPropertyFrame): string {
  const view = VIDEO_EDIT_PROPERTY_VIEWS[key]
  const factor = 10 ** view.precision
  return `${Math.round(view.toDisplay(value, frame) * factor) / factor}${view.unit ?? ''}`
}
