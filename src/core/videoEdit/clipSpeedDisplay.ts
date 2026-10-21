import { videoEditClipRetimed, videoEditClipSpeedPercent, videoEditClipSpeedRange, type VideoEditClipTiming } from './clipSpeed'

type ClipSpeedDisplay = Pick<VideoEditClipTiming, 'speed' | 'reverse' | 'frameHold' | 'timeRemap'> & { preservePitch?: boolean; pitchSemitones?: number }
const percent = (value: number): number => Math.round(value * 10000) / 100

/** PR 时间线名称后缀：原速正放不标记，倒放用负百分比，最多两位小数且不补零。 */
export function videoEditClipSpeedLabel(clip: ClipSpeedDisplay): string {
  if (clip.frameHold) return '[定格]'
  if (!videoEditClipRetimed(clip)) return ''
  if (clip.timeRemap) return `[${clip.reverse ? '-' : ''}曲线]`
  return `[${clip.reverse ? '-' : ''}${videoEditClipSpeedPercent(clip)}%]`
}

/** 效果控件只读摘要：非默认时显示，速度保持正值，方向与保持音调单独说明。 */
export function videoEditClipSpeedReadout(clip: ClipSpeedDisplay): string {
  if (clip.frameHold) return '帧定格'
  if (!videoEditClipRetimed(clip) && !clip.preservePitch && !clip.pitchSemitones) return ''
  const range = videoEditClipSpeedRange(clip)
  const speed = clip.timeRemap ? `速度曲线 ${percent(range.min)}%–${percent(range.max)}%` : `速度 ${videoEditClipSpeedPercent(clip)}%`
  return [speed, ...(clip.reverse ? ['倒放'] : []), ...(clip.preservePitch ? ['保持音调'] : []), ...(clip.pitchSemitones ? [`变调 ${clip.pitchSemitones > 0 ? '+' : ''}${clip.pitchSemitones} 半音`] : [])].join(' · ')
}
