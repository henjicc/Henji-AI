import React from 'react'
import { Pause, Play, Repeat, SkipBack } from 'lucide-react'
import { UiIconButton } from '@/components/ui'
import { useCameraStageStore } from '../store/cameraStageStore'

/** 状态关键帧时间轴复用的播放、回首帧与循环控制。 */
export const PlaybackButtons: React.FC<{ canPlay?: boolean }> = ({ canPlay }) => {
  const playing = useCameraStageStore((state) => state.playback.playing)
  const loop = useCameraStageStore((state) => state.playback.loop)
  const trackCount = useCameraStageStore((state) => state.animation.tracks.length)
  const playbackEnabled = canPlay ?? trackCount > 0
  const play = useCameraStageStore((state) => state.play)
  const pause = useCameraStageStore((state) => state.pause)
  const stop = useCameraStageStore((state) => state.stop)
  const toggleLoop = useCameraStageStore((state) => state.toggleLoop)

  return (
    <div className="flex items-center gap-1">
      <UiIconButton showBorder={false} appearance="hover-only" className="h-7 w-7" title="回到起点" onClick={stop}>
        <SkipBack size={14} />
      </UiIconButton>
      <UiIconButton showBorder={false} appearance="hover-only" className="h-7 w-7" disabled={!playbackEnabled}
        title={playing ? '暂停' : '播放'} onClick={() => (playing ? pause() : play())}>
        {playing ? <Pause size={15} /> : <Play size={15} />}
      </UiIconButton>
      <UiIconButton showBorder={false} appearance="hover-only" active={loop} className="h-7 w-7"
        title="循环播放" onClick={toggleLoop}>
        <Repeat size={14} />
      </UiIconButton>
    </div>
  )
}
