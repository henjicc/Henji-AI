import React from 'react'
import { Clock, Diamond } from 'lucide-react'
import { UiIconButton } from '@/components/ui'
import { KEYFRAME_TIME_EPSILON } from '../domain/animationTypes'
import { useCameraStageStore } from '../store/cameraStageStore'

/**
 * 属性行行首码表按钮（AE 式打点）。三态：
 * - 无轨道：灰色钟表，点击=建轨并以当前值当前时间打点
 * - 有轨道但当前时间无点：高亮钟表，点击=在当前时间打点
 * - 当前时间恰有点：高亮实心菱形，点击=删除该点（删空则移除轨道）
 */

interface KeyframeStopwatchProps {
  objectId: string
  path: string
  className?: string
}

const KeyframeStopwatch: React.FC<KeyframeStopwatchProps> = ({ objectId, path, className }) => {
  const currentTime = useCameraStageStore((state) => state.playback.currentTime)
  const track = useCameraStageStore((state) =>
    state.animation.tracks.find((item) => item.objectId === objectId && item.propertyPath === path),
  )
  const toggleKeyframe = useCameraStageStore((state) => state.toggleKeyframe)

  const hasTrack = !!track
  const hasKeyHere =
    !!track && track.keyframes.some((kf) => Math.abs(kf.time - currentTime) <= KEYFRAME_TIME_EPSILON)

  const title = !hasTrack
    ? '打关键帧（启用该属性动画）'
    : hasKeyHere
    ? '删除当前时间的关键帧'
    : '在当前时间打关键帧'

  return (
    <UiIconButton
      showBorder={false}
      appearance="hover-only"
      active={hasTrack}
      className={`h-5 w-5 shrink-0 ${className ?? ''}`}
      title={title}
      onClick={() => toggleKeyframe(objectId, path)}
    >
      {hasKeyHere ? <Diamond size={12} fill="currentColor" /> : <Clock size={13} />}
    </UiIconButton>
  )
}

export default KeyframeStopwatch
