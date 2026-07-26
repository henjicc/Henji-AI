import React, { useMemo } from 'react'
import { getCameraObjects } from '../../domain/cameraUtils'
import type { StageObject } from '../../domain/sceneTypes'
import type { StageShot } from '../../domain/shotTypes'
import type { ShotTransitionPatch } from '../../store/shotSlice'
import { buildClipLayout } from './shotClipGeometry'
import { SHOT_CLIP_TRACK_HEIGHT } from './shotTimelineLayout'
import { formatShotTimecode } from './shotTimecodeFormat'
import StaticClipBlock from './StaticClipBlock'
import TransitionClipBlock from './TransitionClipBlock'
import { useKeyframeTimeDrag } from './useKeyframeTimeDrag'

const DRAG_BADGE_TOP = -20

interface ShotClipTrackProps {
  shots: StageShot[]
  objects: StageObject[]
  pxPerSecond: number
  contentWidth: number
  fps: number
  selectedShotId: string | null
  /** 框选出的多个关键帧 id（含拖拽中的实时预览），命中的菱形高亮 */
  multiSelectedShotIds: readonly string[]
  currentTime: number
  onSelectShot: (id: string) => void
  onRenameShot: (id: string, name: string) => void
  onRemoveShot: (id: string) => void
  onMoveShotTime: (id: string, time: number) => void
  onUpdateShotTiming: (id: string, patch: { transitionDuration?: number }) => void
  onUpdateShotTransition: (id: string, patch: ShotTransitionPatch) => void
  onUpdateShotCamera: (id: string, cameraId: string | null) => void
  onUpdateShotContinuity: (id: string, continuity: StageShot['continuity']) => void
}

/** 零时长关键帧轨道：菱形可按帧拖动，区间宽度完全由相邻关键帧的绝对时间派生。 */
const ShotClipTrack: React.FC<ShotClipTrackProps> = ({
  shots,
  objects,
  pxPerSecond,
  contentWidth,
  fps,
  selectedShotId,
  multiSelectedShotIds,
  currentTime,
  onSelectShot,
  onRenameShot,
  onRemoveShot,
  onMoveShotTime,
  onUpdateShotTiming,
  onUpdateShotTransition,
  onUpdateShotCamera,
  onUpdateShotContinuity,
}) => {
  const cameras = useMemo(() => getCameraObjects(objects), [objects])
  const drag = useKeyframeTimeDrag({
    shots,
    fps,
    pxPerSecond,
    onCommit: onMoveShotTime,
  })
  const layoutShots = useMemo(() => {
    if (!drag.preview) return shots
    return shots.map((shot) => shot.id === drag.preview?.shotId ? { ...shot, time: drag.preview.time } : shot)
  }, [drag.preview, shots])
  const layout = useMemo(() => buildClipLayout(layoutShots, pxPerSecond), [layoutShots, pxPerSecond])
  const multiSelectedSet = useMemo(() => new Set(multiSelectedShotIds), [multiSelectedShotIds])
  const playheadShotId = useMemo(() => {
    const epsilon = 1 / (2 * Math.max(1, fps))
    return layoutShots.find((shot) => Math.abs(shot.time - currentTime) <= epsilon)?.id ?? null
  }, [currentTime, fps, layoutShots])

  return (
    <div className="relative shrink-0" style={{ width: contentWidth, height: SHOT_CLIP_TRACK_HEIGHT }}>
      {shots.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-text-muted">
          移动播放头后点击工具栏「+」记录状态
        </div>
      )}
      {layout.map((block) => {
        const shot = layoutShots[block.index]
        if (block.kind === 'static') {
          const dragging = drag.preview?.shotId === block.shotId
          return (
            <StaticClipBlock
              key={`keyframe-${block.shotId}`}
              shot={shot}
              block={block}
              selected={block.shotId === selectedShotId || multiSelectedSet.has(block.shotId)}
              isPlayhead={playheadShotId === block.shotId}
              fps={fps}
              onSelect={() => onSelectShot(block.shotId)}
              onRename={(name) => onRenameShot(block.shotId, name)}
              onRemove={() => onRemoveShot(block.shotId)}
              dragHandlers={{
                onPointerDown: (event) => drag.beginDrag(event, block.shotId),
                onPointerMove: drag.handlePointerMove,
                onPointerUp: drag.handlePointerUp,
                onPointerCancel: drag.handlePointerCancel,
              }}
              dragging={dragging}
              consumeClickSuppression={drag.consumeClickSuppression}
              cameras={cameras}
              onSelectCamera={(cameraId) => onUpdateShotCamera(block.shotId, cameraId)}
              onUpdateContinuity={(continuity) => onUpdateShotContinuity(block.shotId, continuity)}
            />
          )
        }
        return (
          <TransitionClipBlock
            key={`transition-${block.shotId}`}
            shot={shot}
            nextShot={layoutShots[block.index + 1]}
            shotIndex={block.index}
            block={block}
            objects={objects}
            fps={fps}
            updateShotTiming={onUpdateShotTiming}
            updateShotTransition={onUpdateShotTransition}
          />
        )
      })}

      {drag.preview && (
        <div
          className="pointer-events-none absolute z-40 -translate-x-1/2 whitespace-nowrap rounded bg-brand-500 px-1.5 py-0.5 font-mono text-3xs font-medium text-white shadow"
          style={{ left: drag.preview.time * pxPerSecond, top: DRAG_BADGE_TOP }}
        >
          {formatShotTimecode(drag.preview.time, 'secondsFrames', fps)}
        </div>
      )}
    </div>
  )
}

export default ShotClipTrack
