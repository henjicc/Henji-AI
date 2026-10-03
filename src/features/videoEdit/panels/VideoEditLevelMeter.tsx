import type { VideoEditAudioLevel } from '../engine/videoEditAudioMeter'

const decibelsOf = (value: number): number => 20 * Math.log10(Math.max(value, 1e-5))
const label = (value: number): string => value > 0 ? `${Math.max(-96, decibelsOf(value)).toFixed(1)} dBFS` : '−∞ dBFS'
/** 显示范围 −60..0 dBFS。 */
const fill = (peak: number): number => Math.max(0, Math.min(1, (decibelsOf(peak) + 60) / 60))
/** 设计稿电平色：正常为成功色，−6 dBFS 以上警示色，过载（> 0 dBFS）危险色。 */
const tone = (peak: number): string => peak > 1 ? 'bg-danger-solid' : decibelsOf(peak) > -6 ? 'bg-warning-solid' : 'bg-success-solid'

/**
 * 播放电平（界面重设计 3.5，设计稿 VideoEdit）：监视器画面右侧的纵向细条，每声道一条，读数放在悬停提示。
 * 压在媒体底上，底槽用固定媒体叠层令牌。无障碍名称、`role="meter"` 与每声道 `data-peak`/`data-rms` 是验收读数。
 */
export function VideoEditLevelMeter({ levels, title, className = '' }: { levels: readonly VideoEditAudioLevel[]; title: string; className?: string }): React.ReactElement {
  return <div className={`flex gap-0.5 ${className}`} aria-label={title}>
    {levels.map((level, index) => <div key={index} className="relative h-full w-1 overflow-hidden rounded-hairline bg-media-control" data-video-edit-level-channel={index} data-peak={level.peak} data-rms={level.rms}
      title={`${levels.length === 1 ? '单声道' : index === 0 ? '左声道' : '右声道'} 峰值 ${label(level.peak)} · RMS ${label(level.rms)}`}
      role="meter" aria-label={`${title}${index === 0 ? '左' : '右'}声道峰值`} aria-valuemin={-96} aria-valuemax={0} aria-valuenow={level.peak > 0 ? Math.max(-96, Math.min(0, decibelsOf(level.peak))) : -96}>
      <div className={`absolute inset-x-0 bottom-0 ${tone(level.peak)}`} style={{ height: `${fill(level.peak) * 100}%` }} />
    </div>)}
  </div>
}
