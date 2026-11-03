import type { VideoEditInstance } from '../application/videoEditService'
import { useVideoEditPlaybackLevels } from '../application/videoEditPlaybackLevels'
import { VideoEditLevelMeter } from './VideoEditLevelMeter'
import { VIDEO_EDIT_LEVEL_FLOOR_DB } from '../engine/videoEditAudioMeter'

/** 刻度：0 到 −54 dBFS，每 6 dB 一格（PR 音频仪表的常用刻度）。 */
const TICKS = [0, -6, -12, -18, -24, -30, -36, -42, -48, -54] as const
const SILENT = [{ peak: 0, rms: 0 }, { peak: 0, rms: 0 }]

/**
 * 音频仪表（参照 PR）：独立停靠面板，显示正在出声的监视器（节目或源）的电平，左侧 dB 刻度、右侧每声道一条。
 * 不压在画面上：节目画面放大滚动时它不跟着动。
 */
export function VideoEditAudioMetersPanel({ instance }: { instance: VideoEditInstance }): React.ReactElement {
  const { source, levels } = useVideoEditPlaybackLevels(instance.document.id)
  return <div className="flex h-full min-h-0 justify-center gap-1 px-1 py-3" data-video-edit-panel="audio_meters">
    <div className="relative w-6 shrink-0 text-2xs tabular-nums text-text3" aria-hidden>
      {TICKS.map(db => <span key={db} className="absolute right-0 -translate-y-1/2 leading-none" style={{ top: `${db / VIDEO_EDIT_LEVEL_FLOOR_DB * 100}%` }}>{db}</span>)}
    </div>
    <VideoEditLevelMeter surface="panel" className="h-full" levels={levels.length ? levels : SILENT} title={source === 'program' ? '节目播放电平' : '源播放电平'} />
  </div>
}
