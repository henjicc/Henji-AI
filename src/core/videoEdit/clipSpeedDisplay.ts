import { videoEditClipRetimed, videoEditClipSpeedPercent, type VideoEditClipTiming } from './clipSpeed'

type ClipSpeedDisplay = Pick<VideoEditClipTiming, 'speed' | 'reverse'> & { preservePitch?: boolean }

/** PR 时间线名称后缀：原速正放不标记，倒放用负百分比，最多两位小数且不补零。 */
export function videoEditClipSpeedLabel(clip: ClipSpeedDisplay): string {
  if (!videoEditClipRetimed(clip)) return ''
  return `[${clip.reverse ? '-' : ''}${videoEditClipSpeedPercent(clip)}%]`
}

/** 效果控件只读摘要：非默认时显示，速度保持正值，方向与保持音调单独说明。 */
export function videoEditClipSpeedReadout(clip: ClipSpeedDisplay): string {
  if (!videoEditClipRetimed(clip) && !clip.preservePitch) return ''
  return [`速度 ${videoEditClipSpeedPercent(clip)}%`, ...(clip.reverse ? ['倒放'] : []), ...(clip.preservePitch ? ['保持音调'] : [])].join(' · ')
}
