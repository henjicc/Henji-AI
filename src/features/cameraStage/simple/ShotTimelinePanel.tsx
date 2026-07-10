import React, { useEffect, useState } from 'react'
import { CAMERA_STAGE_TIMELINE_HEX } from '@/core/theme/colorTokens'
import { useCameraStageStore } from '../store/cameraStageStore'
import { PlaybackButtons } from '../timeline/PlaybackControls'
import TimeRuler from '../timeline/TimeRuler'
import { clampPxPerSecond, timeToX } from '../timeline/timeScale'
import { TIMELINE_RULER_HEIGHT } from '../timeline/timelineLayout'
import TransitionDetailPanel from './TransitionDetailPanel'
import ShotClipTrack from './timeline/ShotClipTrack'
import ShotTimecodeText from './timeline/ShotTimecodeText'
import { buildClipLayout, findClipAtTime } from './timeline/shotClipGeometry'
import { SHOT_CLIP_TRACK_HEIGHT } from './timeline/shotTimelineLayout'

/**
 * 简易模式时间轴面板：工具条（播放控制 + 时间码）→ 时间标尺（可拖 scrub）→ 比例块轨道 → 播放头竖线贯穿。
 * 块宽反映真实时长；过渡细节入口暂沿用旧抽屉（1.3 替换为块上方参数气泡），保证功能不断档。
 */

/** 简易模式时间轴固定像素密度；缩放能力在 2.3 打磨阶段接入 */
const SHOT_TRACK_PX_PER_SECOND = 120
/** 轨道内容最小宽度，避免空/极短工程时轨道过窄 */
const MIN_CONTENT_WIDTH = 320

const ShotTimelinePanel: React.FC = () => {
  const shots = useCameraStageStore((state) => state.shots)
  const objects = useCameraStageStore((state) => state.objects)
  const selectedShotId = useCameraStageStore((state) => state.selectedShotId)
  const currentTime = useCameraStageStore((state) => state.playback.currentTime)
  const duration = useCameraStageStore((state) => state.animation.duration)
  const fps = useCameraStageStore((state) => state.animation.fps)
  const addShot = useCameraStageStore((state) => state.addShot)
  const selectShot = useCameraStageStore((state) => state.selectShot)
  const removeShot = useCameraStageStore((state) => state.removeShot)
  const updateShotName = useCameraStageStore((state) => state.updateShotName)
  const updateShotTransition = useCameraStageStore((state) => state.updateShotTransition)
  const setSelectedShotIdOnly = useCameraStageStore((state) => state.setSelectedShotIdOnly)
  const seek = useCameraStageStore((state) => state.seek)

  const [expandedTransitionId, setExpandedTransitionId] = useState<string | null>(null)

  const pxPerSecond = clampPxPerSecond(SHOT_TRACK_PX_PER_SECOND)
  const contentWidth = Math.max(MIN_CONTENT_WIDTH, timeToX(duration, pxPerSecond))

  // 选中跟随播放头，但只在静止段内跟（重要记录 003 前置逻辑）：
  // 只 set selectedShotId，不调用 selectShot，避免重复应用快照污染撤销历史。
  useEffect(() => {
    const layout = buildClipLayout(shots, 1)
    const block = findClipAtTime(layout, currentTime)
    if (!block || block.kind !== 'static' || block.shotId === selectedShotId) return
    setSelectedShotIdOnly(block.shotId)
  }, [shots, currentTime, selectedShotId, setSelectedShotIdOnly])

  return (
    <div className="flex h-full min-h-0 flex-col bg-app">
      <div className="flex h-9 shrink-0 items-center gap-3 border-b border-border-dark bg-surface-dark px-2">
        <PlaybackButtons canPlay={shots.length > 0 && duration > 0} />
        <ShotTimecodeText currentTime={currentTime} duration={duration} fps={fps} />
        <span className="ml-auto text-xs text-text-muted">镜头卡</span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="relative inline-block min-w-full">
          <TimeRuler
            duration={duration}
            pxPerSecond={pxPerSecond}
            contentWidth={contentWidth}
            mode="seconds"
            fps={fps}
            onScrub={seek}
          />
          <ShotClipTrack
            shots={shots}
            pxPerSecond={pxPerSecond}
            contentWidth={contentWidth}
            selectedShotId={selectedShotId}
            currentTime={currentTime}
            onSelectShot={selectShot}
            onRenameShot={updateShotName}
            onRemoveShot={removeShot}
            onOpenTransition={(id) => setExpandedTransitionId((current) => (current === id ? null : id))}
            onAddShot={addShot}
          />
          <div
            className="pointer-events-none absolute z-20"
            style={{
              left: timeToX(currentTime, pxPerSecond),
              top: 0,
              height: TIMELINE_RULER_HEIGHT + SHOT_CLIP_TRACK_HEIGHT,
              borderLeft: `1px solid ${CAMERA_STAGE_TIMELINE_HEX.playhead}`,
            }}
          >
            <div
              className="absolute top-0"
              style={{
                left: 0,
                transform: 'translateX(-50%)',
                width: 0,
                height: 0,
                borderLeft: '5px solid transparent',
                borderRight: '5px solid transparent',
                borderTop: `7px solid ${CAMERA_STAGE_TIMELINE_HEX.playhead}`,
              }}
            />
          </div>
        </div>
      </div>

      {expandedTransitionId && (() => {
        const index = shots.findIndex((shot) => shot.id === expandedTransitionId)
        const shot = shots[index]
        const nextShot = shots[index + 1]
        return shot && nextShot ? (
          <div className="max-h-56 min-h-0 shrink-0 overflow-y-auto border-t border-border-dark">
            <TransitionDetailPanel
              shot={shot}
              nextShot={nextShot}
              shotIndex={index}
              objects={objects}
              onDetailChange={(objectId, detail) => updateShotTransition(shot.id, { perObject: { [objectId]: detail } })}
              onCameraMoveChange={(objectId, move) => updateShotTransition(shot.id, { cameraMoves: { [objectId]: move } })}
            />
          </div>
        ) : null
      })()}
    </div>
  )
}

export default ShotTimelinePanel
