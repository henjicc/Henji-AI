import { VIDEO_EDIT_LEVEL_FLOOR_DB, type VideoEditAudioLevel } from '../engine/videoEditAudioMeter'

const decibelsOf = (value: number): number => 20 * Math.log10(Math.max(value, 1e-5))
const label = (value: number): string => value > 0 ? `${Math.max(-96, decibelsOf(value)).toFixed(1)} dBFS` : '−∞ dBFS'
/** 显示范围 −60..0 dBFS。 */
const fill = (peak: number): number => Math.max(0, Math.min(1, (decibelsOf(peak) - VIDEO_EDIT_LEVEL_FLOOR_DB) / -VIDEO_EDIT_LEVEL_FLOOR_DB))
/** 设计稿电平色：正常为成功色，−6 dBFS 以上警示色，过载（> 0 dBFS）危险色。 */
const tone = (peak: number): string => peak > 1 ? 'bg-danger-solid' : decibelsOf(peak) > -6 ? 'bg-warning-solid' : 'bg-success-solid'

/**
 * 播放电平：每声道一条纵向条，读数放在悬停提示。`surface`：`panel` 是音频仪表面板里的宽条（底槽比面板暗一级），
 * `media` 是压在媒体底上的细条（底槽用固定媒体叠层令牌）。无障碍名称、`role="meter"` 与每声道 `data-peak`/`data-rms` 是验收读数。
 */
export function VideoEditLevelMeter({ levels, title, surface = 'media', className = '' }: { levels: readonly VideoEditAudioLevel[]; title: string; surface?: 'media' | 'panel'; className?: string }): React.ReactElement {
  const track = surface === 'panel' ? 'w-2.5 bg-gap' : 'w-1 bg-media-control'
  return <div className={`flex gap-0.5 ${className}`} aria-label={title}>
    {levels.map((level, index) => <div key={index} className={`relative h-full overflow-hidden rounded-hairline ${track}`} data-video-edit-level-channel={index} data-peak={level.peak} data-rms={level.rms}
      title={`${levels.length === 1 ? '单声道' : index === 0 ? '左声道' : '右声道'} 峰值 ${label(level.peak)} · RMS ${label(level.rms)}`}
      role="meter" aria-label={`${title}${index === 0 ? '左' : '右'}声道峰值`} aria-valuemin={-96} aria-valuemax={0} aria-valuenow={level.peak > 0 ? Math.max(-96, Math.min(0, decibelsOf(level.peak))) : -96}>
      <div className={`absolute inset-x-0 bottom-0 ${tone(level.peak)}`} style={{ height: `${fill(level.peak) * 100}%` }} />
    </div>)}
  </div>
}
