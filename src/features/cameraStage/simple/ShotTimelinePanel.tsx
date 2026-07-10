import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { CAMERA_STAGE_TIMELINE_HEX } from '@/core/theme/colorTokens'
import { useCameraStageStore } from '../store/cameraStageStore'
import { PlaybackButtons } from '../timeline/PlaybackControls'
import TimeRuler from '../timeline/TimeRuler'
import { clampPxPerSecond, timeToX, xToTime, type TimeRulerMode } from '../timeline/timeScale'
import { TIMELINE_RULER_HEIGHT } from '../timeline/timelineLayout'
import ShotClipTrack from './timeline/ShotClipTrack'
import ShotTimecodeText from './timeline/ShotTimecodeText'
import { buildClipLayout, findClipAtTime } from './timeline/shotClipGeometry'
import { SHOT_CLIP_TRACK_HEIGHT } from './timeline/shotTimelineLayout'

/**
 * 简易模式时间轴面板：工具条（播放控制 + 时间码）→ 时间标尺（可拖 scrub）→ 比例块轨道 → 播放头竖线贯穿。
 * 块宽反映真实时长；过渡细节走块上方参数气泡（TransitionClipBlock 内接 PanelTrigger，见重要记录 004），
 * 本面板只做编排接线，不再持有过渡抽屉展开态。
 * 2.3：pxPerSecond 由固定常量改为可缩放 state，接入 Alt+滚轮锚点缩放（照抄专业模式 TimelinePanel 的
 * 触发条件与锚点反解算法），并在用户尚未手动缩放前，随面板可视宽度/总时长变化持续自适应铺满。
 */

/** 轨道内容最小宽度，避免空/极短工程时轨道过窄 */
const MIN_CONTENT_WIDTH = 320
/** 缩放到该像素密度以上时，标尺切换为帧刻度（更精细，配合 trim 帧级吸附） */
const FRAME_TICK_PX_PER_SECOND = 200
/** 滚轮缩放系数底数：与专业模式 TimelinePanel 一致，deltaY 越大缩放越快 */
const WHEEL_ZOOM_BASE = 1.0018

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
  const reorderShot = useCameraStageStore((state) => state.reorderShot)
  const updateShotName = useCameraStageStore((state) => state.updateShotName)
  const updateShotTiming = useCameraStageStore((state) => state.updateShotTiming)
  const updateShotTransition = useCameraStageStore((state) => state.updateShotTransition)
  const setSelectedShotIdOnly = useCameraStageStore((state) => state.setSelectedShotIdOnly)
  const seek = useCameraStageStore((state) => state.seek)

  const scrollRef = useRef<HTMLDivElement>(null)
  /** 用户是否已手动滚轮缩放过：一旦为 true，停止随时长变化自动自适应铺满，尊重用户当前缩放 */
  const userZoomedRef = useRef(false)
  const [pxPerSecond, setPxPerSecond] = useState(clampPxPerSecond(120))

  // 初始自适应：面板挂载 / 可视宽度变化 / 总时长变化时，取 clampPxPerSecond(可视宽度 / 总时长)
  // 让整条时间轴默认尽量铺满可见区域；用户手动缩放过后不再介入。
  useLayoutEffect(() => {
    const container = scrollRef.current
    if (!container) return undefined
    const applyAutoFit = (): void => {
      if (userZoomedRef.current || duration <= 0) return
      const visibleWidth = container.clientWidth
      if (visibleWidth <= 0) return
      setPxPerSecond(clampPxPerSecond(visibleWidth / duration))
    }
    applyAutoFit()
    const observer = new ResizeObserver(applyAutoFit)
    observer.observe(container)
    return () => observer.disconnect()
  }, [duration])

  const contentWidth = Math.max(MIN_CONTENT_WIDTH, timeToX(duration, pxPerSecond))
  const rulerMode: TimeRulerMode = pxPerSecond >= FRAME_TICK_PX_PER_SECOND ? 'frames' : 'seconds'

  // Alt+滚轮锚点缩放：指针所在时间点缩放后保持不动（照抄专业模式 TimelinePanel.handleWheel）。
  const handleWheel = useCallback((event: React.WheelEvent<HTMLDivElement>): void => {
    if (!event.altKey) return
    event.preventDefault()
    const scroller = scrollRef.current
    if (!scroller) return
    const rect = scroller.getBoundingClientRect()
    const viewportContentX = event.clientX - rect.left
    if (viewportContentX < 0) return
    const anchorContentX = viewportContentX + scroller.scrollLeft
    const anchorTime = Math.max(0, xToTime(anchorContentX, pxPerSecond))
    const factor = Math.pow(WHEEL_ZOOM_BASE, -event.deltaY)
    const nextPxPerSecond = clampPxPerSecond(pxPerSecond * factor)
    if (Math.abs(nextPxPerSecond - pxPerSecond) < 0.01) return
    userZoomedRef.current = true
    setPxPerSecond(nextPxPerSecond)
    requestAnimationFrame(() => {
      scroller.scrollLeft = Math.max(0, timeToX(anchorTime, nextPxPerSecond) - viewportContentX)
    })
  }, [pxPerSecond])

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

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto" onWheel={handleWheel}>
        <div className="relative inline-block min-w-full">
          <TimeRuler
            duration={duration}
            pxPerSecond={pxPerSecond}
            contentWidth={contentWidth}
            mode={rulerMode}
            fps={fps}
            onScrub={seek}
          />
          <ShotClipTrack
            shots={shots}
            objects={objects}
            pxPerSecond={pxPerSecond}
            contentWidth={contentWidth}
            fps={fps}
            selectedShotId={selectedShotId}
            currentTime={currentTime}
            onSelectShot={selectShot}
            onRenameShot={updateShotName}
            onRemoveShot={removeShot}
            onUpdateShotTiming={updateShotTiming}
            onUpdateShotTransition={updateShotTransition}
            onReorderShot={reorderShot}
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
    </div>
  )
}

export default ShotTimelinePanel
