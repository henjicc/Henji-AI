import React from 'react'
import { Clock, Diamond } from 'lucide-react'
import { UiIconButton } from '@/components/ui'
import { KEYFRAME_TIME_EPSILON } from '../domain/animationTypes'
import { getAnimatableGroupByPath } from '../domain/animatableProps'
import { useCameraStageStore } from '../store/cameraStageStore'

/**
 * 属性行行首码表按钮（AE 式打点，作用于整个分组：vec3 的 X/Y/Z 一起打/删）。三态：
 * - 无轨道：灰色钟表，点击=各分量建轨并以当前值当前时间打点
 * - 有轨道但当前时间未全打点：高亮钟表，点击=补齐当前时间各分量点
 * - 当前时间各分量都有点：高亮实心菱形，点击=删除各分量当前时间的点
 */

interface KeyframeStopwatchProps {
  objectId: string
  groupPath: string
  className?: string
}

const KeyframeStopwatch: React.FC<KeyframeStopwatchProps> = ({ objectId, groupPath, className }) => {
  const currentTime = useCameraStageStore((state) => state.playback.currentTime)
  const tracks = useCameraStageStore((state) => state.animation.tracks)
  const toggleKeyframeGroup = useCameraStageStore((state) => state.toggleKeyframeGroup)

  const group = getAnimatableGroupByPath(groupPath)
  const childPaths = group?.children.map((child) => child.path) ?? []

  const hasTrack = tracks.some(
    (track) => track.objectId === objectId && childPaths.includes(track.propertyPath),
  )
  const allKeyedHere =
    !!group &&
    group.children.every((child) => {
      const track = tracks.find((t) => t.objectId === objectId && t.propertyPath === child.path)
      return !!track && track.keyframes.some((kf) => Math.abs(kf.time - currentTime) <= KEYFRAME_TIME_EPSILON)
    })

  const title = !hasTrack
    ? '打关键帧（启用该属性动画）'
    : allKeyedHere
    ? '删除当前时间的关键帧'
    : '在当前时间打关键帧'

  return (
    <UiIconButton
      showBorder={false}
      appearance="hover-only"
      active={hasTrack}
      className={`h-5 w-5 shrink-0 ${className ?? ''}`}
      title={title}
      onClick={() => toggleKeyframeGroup(objectId, groupPath)}
    >
      {allKeyedHere ? <Diamond size={12} fill="currentColor" /> : <Clock size={13} />}
    </UiIconButton>
  )
}

export default KeyframeStopwatch
