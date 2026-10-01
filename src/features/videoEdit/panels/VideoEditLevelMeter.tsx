import type { VideoEditAudioLevel } from '../engine/videoEditAudioMeter'

export function VideoEditLevelMeter({ levels, title }: { levels: readonly VideoEditAudioLevel[]; title: string }): React.ReactElement {
  const decibels = (value: number): string => value > 0 ? `${Math.max(-96, 20 * Math.log10(value)).toFixed(1)} dBFS` : '−∞ dBFS'
  return <div className="flex min-w-0 gap-2 text-2xs tabular-nums text-text-muted" aria-label={title}>
    {levels.map((level, index) => <div key={index} className="flex min-w-0 flex-1 items-center gap-1" data-video-edit-level-channel={index} data-peak={level.peak} data-rms={level.rms}>
      <span>{levels.length === 1 ? '单声道' : index === 0 ? 'L' : 'R'}</span>
      <div className="relative h-2 min-w-8 flex-1 overflow-hidden bg-panel" role="meter" aria-label={`${title}${index === 0 ? '左' : '右'}声道峰值`} aria-valuemin={-96} aria-valuemax={0} aria-valuenow={level.peak > 0 ? Math.max(-96, Math.min(0, 20 * Math.log10(level.peak))) : -96}>
        <div className={`h-full ${level.peak > 1 ? 'bg-danger' : 'bg-accent'}`} style={{ width: `${Math.max(0, Math.min(1, (20 * Math.log10(Math.max(level.peak, 1e-5)) + 60) / 60)) * 100}%` }} />
      </div>
      <span title={`RMS ${decibels(level.rms)}`}>{decibels(level.peak)}</span>
    </div>)}
  </div>
}
