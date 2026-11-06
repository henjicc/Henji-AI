import { useLayoutEffect, useRef, useState } from 'react'
import { ownerWindowOf } from '@/utils/crossRealmDom'
import type { VideoEditInstance } from '../application/videoEditService'
import { useVideoEditPlaybackLevels } from '../application/videoEditPlaybackLevels'
import { VideoEditLevelMeter } from './VideoEditLevelMeter'
import { VIDEO_EDIT_LEVEL_FLOOR_DB } from '../engine/videoEditAudioMeter'

/** 刻度：0 到 −54 dBFS，每 6 dB 一格（PR 音频仪表的常用刻度）。 */
const TICKS = [0, -6, -12, -18, -24, -30, -36, -42, -48, -54] as const
const SILENT = [{ peak: 0, rms: 0 }, { peak: 0, rms: 0 }]
/** 面板窄于这个宽度时刻度放不下，只留电平条。 */
const LABELS_MIN_WIDTH = 44
/** 刻度之间至少隔这么高，矮了就隔一个标一个。 */
const TICK_MIN_SPACING = 22

/**
 * 音频仪表（参照 PR）：独立停靠面板，显示正在出声的监视器（节目或源）的电平，左侧 dB 刻度、右侧每声道一条。
 * 不压在画面上：节目画面放大滚动时它不跟着动。刻度都是负的，只写数字省出宽度；面板太窄时只留电平条，太矮时隔一格标一个。
 */
export function VideoEditAudioMetersPanel({ instance }: { instance: VideoEditInstance }): React.ReactElement {
  const { source, levels } = useVideoEditPlaybackLevels(instance.document.id)
  const host = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 96, height: 400 })
  useLayoutEffect(() => {
    const element = host.current
    if (!element) return
    const measure = (): void => setSize(previous => previous.width === element.clientWidth && previous.height === element.clientHeight ? previous : { width: element.clientWidth, height: element.clientHeight })
    measure()
    const Observer = ownerWindowOf(element).ResizeObserver
    const observer = typeof Observer === 'undefined' ? undefined : new Observer(measure)
    observer?.observe(element)
    return () => observer?.disconnect()
  }, [])
  const step = size.height / (TICKS.length - 1) < TICK_MIN_SPACING ? 2 : 1
  return <div ref={host} className="flex h-full min-h-0 justify-center gap-1 px-1 py-3" data-video-edit-panel="audio_meters">
    {size.width >= LABELS_MIN_WIDTH && <div className="relative w-4 shrink-0 text-2xs tabular-nums text-text3" aria-hidden>
      {TICKS.filter((_, index) => index % step === 0).map(db => <span key={db} className="absolute right-0 -translate-y-1/2 leading-none" style={{ top: `${db / VIDEO_EDIT_LEVEL_FLOOR_DB * 100}%` }}>{-db}</span>)}
    </div>}
    <VideoEditLevelMeter surface="panel" className="h-full" levels={levels.length ? levels : SILENT} title={source === 'program' ? '节目播放电平' : '源播放电平'} />
  </div>
}
