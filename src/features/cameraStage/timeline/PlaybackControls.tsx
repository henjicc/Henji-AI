import React, { useState } from 'react'
import { Pause, Play, Repeat, SkipBack, Spline, ZoomIn } from 'lucide-react'
import { UiIconButton, UiInput, UiOptionButton, UiRangeInput } from '@/components/ui'
import {
  TIMELINE_MAX_PX_PER_SECOND,
  TIMELINE_MIN_PX_PER_SECOND,
  formatTimecode,
  type TimeRulerMode,
} from './timeScale'
import { useCameraStageStore } from '../store/cameraStageStore'

/** 时间轴顶部播放控制条：播放/暂停、回首帧、循环、时间/时长、秒-帧刻度切换、缩放 */

/** 内联时长编辑：平时显示为「5.00s / 150f」文本，点击就地变无边框输入，回车/失焦提交 */
const InlineDuration: React.FC<{
  value: number
  mode: TimeRulerMode
  fps: number
  onChange: (seconds: number) => void
}> = ({ value, mode, fps, onChange }) => {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  const begin = (): void => {
    setDraft(mode === 'frames' ? String(Math.round(value * fps)) : String(value))
    setEditing(true)
  }
  const commit = (): void => {
    const raw = Number.parseFloat(draft)
    if (Number.isFinite(raw)) onChange(mode === 'frames' ? raw / Math.max(1, fps) : raw)
    setEditing(false)
  }

  if (!editing) {
    return (
      <span
        role="button"
        tabIndex={0}
        className="cursor-text rounded px-1 text-text-dark hover:bg-layer"
        title="点击编辑总时长"
        onClick={begin}
      >
        {formatTimecode(value, mode, fps)}
      </span>
    )
  }
  return (
    <UiInput
      autoFocus
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
        else if (event.key === 'Escape') setEditing(false)
      }}
      className="h-5 !w-14 rounded border-0 bg-layer px-1 text-xs tabular-nums"
    />
  )
}

interface PlaybackControlsProps {
  mode: TimeRulerMode
  onModeChange: (mode: TimeRulerMode) => void
  pxPerSecond: number
  onPxPerSecondChange: (value: number) => void
  graphView: boolean
  onGraphViewChange: (value: boolean) => void
}

const PlaybackControls: React.FC<PlaybackControlsProps> = ({
  mode,
  onModeChange,
  pxPerSecond,
  onPxPerSecondChange,
  graphView,
  onGraphViewChange,
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
        <InlineDuration value={duration} mode={mode} fps={fps} onChange={setDuration} />
      </div>

      <div className="ml-auto flex items-center gap-2">
        <UiIconButton
          showBorder={false}
          appearance="hover-only"
          active={graphView}
          className="h-7 w-7"
          title={graphView ? '切回关键帧视图' : '切到曲线（图表编辑器）视图'}
          onClick={() => onGraphViewChange(!graphView)}
        >
          <Spline size={15} />
        </UiIconButton>
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
