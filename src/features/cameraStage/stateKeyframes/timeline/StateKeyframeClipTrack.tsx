import React, { useMemo } from 'react'
import { getCameraObjects } from '../../domain/cameraUtils'
import type { StageObject } from '../../domain/sceneTypes'
import type { StageStateKeyframe } from '../../domain/stateKeyframeTypes'
import type { StateKeyframeTransitionPatch } from '../../store/stateKeyframeSlice'
import { buildClipLayout } from './stateKeyframeClipGeometry'
import { STATE_KEYFRAME_CLIP_TRACK_HEIGHT } from './stateKeyframeTimelineLayout'
import { formatStateKeyframeTimecode } from './stateKeyframeTimecodeFormat'
import StaticClipBlock from './StaticClipBlock'
import TransitionClipBlock from './TransitionClipBlock'
import { useKeyframeTimeDrag } from './useKeyframeTimeDrag'

const DRAG_BADGE_TOP = -20

interface StateKeyframeClipTrackProps {
  stateKeyframes: StageStateKeyframe[]
  objects: StageObject[]
  pxPerSecond: number
  contentWidth: number
  fps: number
  selectedStateKeyframeId: string | null
  /** 框选出的多个关键帧 id（含拖拽中的实时预览），命中的菱形高亮 */
  multiSelectedStateKeyframeIds: readonly string[]
  currentTime: number
  onSelectStateKeyframe: (id: string) => void
  onRenameStateKeyframe: (id: string, name: string) => void
  onRemoveStateKeyframe: (id: string) => void
  onMoveStateKeyframeTime: (id: string, time: number) => void
  onUpdateStateKeyframeTiming: (id: string, patch: { transitionDuration?: number }) => void
  onUpdateStateKeyframeTransition: (id: string, patch: StateKeyframeTransitionPatch) => void
  onUpdateStateKeyframeCamera: (id: string, cameraId: string | null) => void
  onUpdateStateKeyframeContinuity: (id: string, continuity: StageStateKeyframe['continuity']) => void
}

/** 零时长关键帧轨道：菱形可按帧拖动，区间宽度完全由相邻关键帧的绝对时间派生。 */
const StateKeyframeClipTrack: React.FC<StateKeyframeClipTrackProps> = ({
  stateKeyframes,
  objects,
  pxPerSecond,
  contentWidth,
  fps,
  selectedStateKeyframeId,
  multiSelectedStateKeyframeIds,
  currentTime,
  onSelectStateKeyframe,
  onRenameStateKeyframe,
  onRemoveStateKeyframe,
  onMoveStateKeyframeTime,
  onUpdateStateKeyframeTiming,
  onUpdateStateKeyframeTransition,
  onUpdateStateKeyframeCamera,
  onUpdateStateKeyframeContinuity,
}) => {
  const cameras = useMemo(() => getCameraObjects(objects), [objects])
  const drag = useKeyframeTimeDrag({
    stateKeyframes,
    fps,
    pxPerSecond,
    onCommit: onMoveStateKeyframeTime,
  })
  const layoutStateKeyframes = useMemo(() => {
    if (!drag.preview) return stateKeyframes
    return stateKeyframes.map((stateKeyframe) => stateKeyframe.id === drag.preview?.stateKeyframeId ? { ...stateKeyframe, time: drag.preview.time } : stateKeyframe)
  }, [drag.preview, stateKeyframes])
  const layout = useMemo(() => buildClipLayout(layoutStateKeyframes, pxPerSecond), [layoutStateKeyframes, pxPerSecond])
  const multiSelectedSet = useMemo(() => new Set(multiSelectedStateKeyframeIds), [multiSelectedStateKeyframeIds])
  const playheadStateKeyframeId = useMemo(() => {
    const epsilon = 1 / (2 * Math.max(1, fps))
    return layoutStateKeyframes.find((stateKeyframe) => Math.abs(stateKeyframe.time - currentTime) <= epsilon)?.id ?? null
  }, [currentTime, fps, layoutStateKeyframes])

  return (
    <div className="relative shrink-0" style={{ width: contentWidth, height: STATE_KEYFRAME_CLIP_TRACK_HEIGHT }}>
      {stateKeyframes.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-text-muted">
          移动播放头后点击工具栏「+」记录状态
        </div>
      )}
      {layout.map((block) => {
        const stateKeyframe = layoutStateKeyframes[block.index]
        if (block.kind === 'static') {
          const dragging = drag.preview?.stateKeyframeId === block.stateKeyframeId
          return (
            <StaticClipBlock
              key={`keyframe-${block.stateKeyframeId}`}
              stateKeyframe={stateKeyframe}
              block={block}
              selected={block.stateKeyframeId === selectedStateKeyframeId || multiSelectedSet.has(block.stateKeyframeId)}
              isPlayhead={playheadStateKeyframeId === block.stateKeyframeId}
              fps={fps}
              onSelect={() => onSelectStateKeyframe(block.stateKeyframeId)}
              onRename={(name) => onRenameStateKeyframe(block.stateKeyframeId, name)}
              onRemove={() => onRemoveStateKeyframe(block.stateKeyframeId)}
              dragHandlers={{
                onPointerDown: (event) => drag.beginDrag(event, block.stateKeyframeId),
                onPointerMove: drag.handlePointerMove,
                onPointerUp: drag.handlePointerUp,
                onPointerCancel: drag.handlePointerCancel,
              }}
              dragging={dragging}
              consumeClickSuppression={drag.consumeClickSuppression}
              cameras={cameras}
              onSelectCamera={(cameraId) => onUpdateStateKeyframeCamera(block.stateKeyframeId, cameraId)}
              onUpdateContinuity={(continuity) => onUpdateStateKeyframeContinuity(block.stateKeyframeId, continuity)}
            />
          )
        }
        return (
          <TransitionClipBlock
            key={`transition-${block.stateKeyframeId}`}
            stateKeyframe={stateKeyframe}
            nextStateKeyframe={layoutStateKeyframes[block.index + 1]}
            stateKeyframeIndex={block.index}
            block={block}
            objects={objects}
            fps={fps}
            updateStateKeyframeTiming={onUpdateStateKeyframeTiming}
            updateStateKeyframeTransition={onUpdateStateKeyframeTransition}
          />
        )
      })}

      {drag.preview && (
        <div
          className="pointer-events-none absolute z-40 -translate-x-1/2 whitespace-nowrap rounded bg-brand-500 px-1.5 py-0.5 font-mono text-3xs font-medium text-white shadow"
          style={{ left: drag.preview.time * pxPerSecond, top: DRAG_BADGE_TOP }}
        >
          {formatStateKeyframeTimecode(drag.preview.time, 'secondsFrames', fps)}
        </div>
      )}
    </div>
  )
}

export default StateKeyframeClipTrack
