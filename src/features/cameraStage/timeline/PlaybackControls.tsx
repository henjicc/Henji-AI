import React from 'react'
import { Pause, Play, Repeat, SkipBack, ZoomIn } from 'lucide-react'
import NumberInput from '@/components/ui/NumberInput'
import { UiIconButton, UiOptionButton, UiRangeInput } from '@/components/ui'
import {
  TIMELINE_MAX_PX_PER_SECOND,
  TIMELINE_MIN_PX_PER_SECOND,
  formatTimecode,
  type TimeRulerMode,
} from './timeScale'
import { useCameraStageStore } from '../store/cameraStageStore'

/** 时间轴顶部播放控制条：播放/暂停、回首帧、循环、时间/时长、秒-帧刻度切换、缩放 */

interface PlaybackControlsProps {
  mode: TimeRulerMode
  onModeChange: (mode: TimeRulerMode) => void
  pxPerSecond: number
  onPxPerSecondChange: (value: number) => void
}

const PlaybackControls: React.FC<PlaybackControlsProps> = ({
  mode,
  onModeChange,
  pxPerSecond,
  onPxPerSecondChange,
}) => {
  const playing = useCameraStageStore((state) => state.playback.playing)
  const currentTime = useCameraStageStore((state) => state.playback.currentTime)
  const loop = useCameraStageStore((state) => state.playback.loop)
  const duration = useCameraStageStore((state) => state.animation.duration)
  const fps = useCameraStageStore((state) => state.animation.fps)
  const trackCount = useCameraStageStore((state) => state.animation.tracks.length)

  const play = useCameraStageStore((state) => state.play)
  const pause = useCameraStageStore((state) => state.pause)
  const stop = useCameraStageStore((state) => state.stop)
  const toggleLoop = useCameraStageStore((state) => state.toggleLoop)
  const setDuration = useCameraStageStore((state) => state.setDuration)

  return (
    <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border-dark bg-surface-dark px-2">
      <UiIconButton
        showBorder={false}
        appearance="hover-only"
        className="h-7 w-7"
        title="回到起点"
        onClick={() => stop()}
      >
        <SkipBack size={14} />
      </UiIconButton>
      <UiIconButton
        showBorder={false}
        appearance="hover-only"
        className="h-7 w-7"
        disabled={trackCount === 0}
        title={playing ? '暂停' : '播放'}
        onClick={() => (playing ? pause() : play())}
      >
        {playing ? <Pause size={15} /> : <Play size={15} />}
      </UiIconButton>
      <UiIconButton
        showBorder={false}
        appearance="hover-only"
        active={loop}
        className="h-7 w-7"
        title="循环播放"
        onClick={() => toggleLoop()}
      >
        <Repeat size={14} />
      </UiIconButton>

      <div className="ml-1 flex items-center gap-1 tabular-nums text-xs text-text-muted">
        <span className="text-text-dark">{formatTimecode(currentTime, mode, fps)}</span>
        <span>/</span>
        <NumberInput
          value={duration}
          step={0.5}
          min={0.1}
          precision={mode === 'frames' ? 0 : 2}
          widthClassName="w-16"
          className="shrink-0"
          commitOnChange
          wheelStep
          onChange={(next) => setDuration(next)}
        />
      </div>

      <div className="ml-auto flex items-center gap-2">
        <div className="flex items-center gap-1">
          <UiOptionButton
            active={mode === 'seconds'}
            onClick={() => onModeChange('seconds')}
            className="px-2 py-1 text-xs"
          >
            秒
          </UiOptionButton>
          <UiOptionButton
            active={mode === 'frames'}
            onClick={() => onModeChange('frames')}
            className="px-2 py-1 text-xs"
          >
            帧
          </UiOptionButton>
        </div>
        <div className="flex items-center gap-1.5">
          <ZoomIn size={13} className="text-text-muted" />
          <UiRangeInput
            className="w-24"
            min={TIMELINE_MIN_PX_PER_SECOND}
            max={TIMELINE_MAX_PX_PER_SECOND}
            step={10}
            value={pxPerSecond}
            onChange={(event) => onPxPerSecondChange(Number(event.target.value))}
          />
        </div>
      </div>
    </div>
  )
}

export default PlaybackControls
