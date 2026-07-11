import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import { UiIconButton } from '@/components/ui'
import { CAMERA_STAGE_TIMELINE_HEX } from '@/core/theme/colorTokens'
import { useCameraStageStore } from '../store/cameraStageStore'
import { PlaybackButtons } from '../timeline/PlaybackControls'
import TimeRuler from '../timeline/TimeRuler'
import { clampPxPerSecond, timeToX, xToTime, type TimeRulerMode } from '../timeline/timeScale'
import { TIMELINE_RULER_HEIGHT } from '../timeline/timelineLayout'
import ShotClipTrack from './timeline/ShotClipTrack'
import ShotTimecodeText from './timeline/ShotTimecodeText'
import { formatCompactShotTimecode, type ShotTimecodeMode } from './timeline/shotTimecodeFormat'
import { quantizeToFrame } from './timeline/shotClipGeometry'
import { SHOT_CLIP_TRACK_HEIGHT } from './timeline/shotTimelineLayout'
import { useShotMarqueeSelect } from './timeline/useShotMarqueeSelect'

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
  const moveShotTime = useCameraStageStore((state) => state.moveShotTime)
  const updateShotName = useCameraStageStore((state) => state.updateShotName)
  const updateShotTiming = useCameraStageStore((state) => state.updateShotTiming)
  const updateShotTransition = useCameraStageStore((state) => state.updateShotTransition)
  const updateShotCamera = useCameraStageStore((state) => state.updateShotCamera)
  const updateShotContinuity = useCameraStageStore((state) => state.updateShotContinuity)
  const setSelectedShotIdOnly = useCameraStageStore((state) => state.setSelectedShotIdOnly)
  const selectedShotIds = useCameraStageStore((state) => state.selectedShotIds)
  const setSelectedShotIds = useCameraStageStore((state) => state.setSelectedShotIds)
  const removeShots = useCameraStageStore((state) => state.removeShots)
  const seek = useCameraStageStore((state) => state.seek)

  // 简易模式与专业模式保持一致：焦点不在输入控件时，空格播放/暂停。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.code !== 'Space' || event.repeat) return
      const target = event.target as HTMLElement | null
      const tagName = target?.tagName
      if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT' || target?.isContentEditable) return
      const state = useCameraStageStore.getState()
      if (state.shots.length === 0 || state.animation.duration <= 0) return
      event.preventDefault()
      if (state.playback.playing) state.pause()
      else state.play()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const scrollRef = useRef<HTMLDivElement>(null)
  /** 用户是否已手动滚轮缩放过：一旦为 true，停止随时长变化自动自适应铺满，尊重用户当前缩放 */
  const userZoomedRef = useRef(false)
  const [pxPerSecond, setPxPerSecond] = useState(clampPxPerSecond(120))
  const [viewportWidth, setViewportWidth] = useState(MIN_CONTENT_WIDTH)
  const [timecodeMode, setTimecodeMode] = useState<ShotTimecodeMode>('secondsFrames')

  // 初始自适应：面板挂载 / 可视宽度变化 / 总时长变化时，取 clampPxPerSecond(可视宽度 / 总时长)
  // 让整条时间轴默认尽量铺满可见区域；用户手动缩放过后不再介入。
  useLayoutEffect(() => {
    const container = scrollRef.current
    if (!container) return undefined
    const applyAutoFit = (): void => {
      const visibleWidth = container.clientWidth
      if (visibleWidth <= 0) return
      setViewportWidth(visibleWidth)
      if (userZoomedRef.current || duration <= 0) return
      setPxPerSecond(clampPxPerSecond(visibleWidth / duration))
    }
    applyAutoFit()
    const observer = new ResizeObserver(applyAutoFit)
    observer.observe(container)
    return () => observer.disconnect()
  }, [duration])

  // 轨道在最后一个关键帧之后始终保留至少一屏空白，允许播放头进入未来时间。
  const contentWidth = Math.max(MIN_CONTENT_WIDTH, timeToX(duration, pxPerSecond) + viewportWidth)
  const rulerDuration = xToTime(contentWidth, pxPerSecond)
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

  // 播放头吸附到某关键帧时同步选中，但不重复应用快照。
  useEffect(() => {
    const epsilon = 1 / (2 * Math.max(1, fps))
    const shot = shots.find((item) => Math.abs(item.time - currentTime) <= epsilon)
    if (!shot || shot.id === selectedShotId) return
    setSelectedShotIdOnly(shot.id)
  }, [shots, currentTime, fps, selectedShotId, setSelectedShotIdOnly])

  const marquee = useShotMarqueeSelect({
    containerRef: scrollRef,
    shots,
    pxPerSecond,
    onCommit: setSelectedShotIds,
  })
  // 拖拽中显示实时预览集合，松手后显示已提交集合
  const highlightedShotIds = marquee.previewIds ?? selectedShotIds

  // Delete/Backspace 删除框选或当前选中的关键帧；Escape 清空框选。
  // 挂在面板容器上（React 冒泡）并 stopPropagation，避免触发全局"删除选中场景对象"快捷键。
  const handlePanelKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>): void => {
    const target = event.target as HTMLElement
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return
    if (event.key === 'Escape') {
      if (useCameraStageStore.getState().selectedShotIds.length > 0) {
        event.stopPropagation()
        setSelectedShotIds([])
      }
      return
    }
    if (event.key !== 'Delete' && event.key !== 'Backspace') return
    const state = useCameraStageStore.getState()
    const ids = state.selectedShotIds.length > 0
      ? state.selectedShotIds
      : state.selectedShotId
        ? [state.selectedShotId]
        : []
    if (ids.length === 0) return
    event.preventDefault()
    event.stopPropagation()
    removeShots(ids)
  }, [removeShots, setSelectedShotIds])

  return (
    <div className="flex h-full min-h-0 flex-col bg-app" onKeyDown={handlePanelKeyDown}>
      <div className="flex h-9 shrink-0 items-center gap-3 border-b border-border-dark bg-surface-dark px-2">
        <PlaybackButtons canPlay={shots.length > 0 && duration > 0} />
        <ShotTimecodeText
          currentTime={currentTime}
          duration={duration}
          fps={fps}
          mode={timecodeMode}
          onModeChange={setTimecodeMode}
        />
        <UiIconButton
          showBorder={false}
          appearance="hover-only"
          className="ml-4 h-7 w-7"
          title="在播放头位置添加关键帧"
          onClick={addShot}
        >
          <Plus size={16} />
        </UiIconButton>
        <span className="ml-auto text-xs text-text-muted">状态关键帧</span>
      </div>

      <div
        ref={scrollRef}
        tabIndex={0}
        className="min-h-0 flex-1 select-none overflow-auto outline-none"
        onWheel={handleWheel}
        onPointerDown={marquee.handlePointerDown}
        onPointerMove={marquee.handlePointerMove}
        onPointerUp={marquee.handlePointerUp}
        onPointerCancel={marquee.handlePointerCancel}
      >
        <div className="relative inline-block min-w-full">
          <TimeRuler
            duration={rulerDuration}
            pxPerSecond={pxPerSecond}
            contentWidth={contentWidth}
            mode={rulerMode}
            fps={fps}
            formatLabel={(time) => formatCompactShotTimecode(time, timecodeMode, fps)}
            onScrub={(time) => seek(quantizeToFrame(time, fps))}
          />
          <ShotClipTrack
            shots={shots}
            objects={objects}
            pxPerSecond={pxPerSecond}
            contentWidth={contentWidth}
            fps={fps}
            selectedShotId={selectedShotId}
            multiSelectedShotIds={highlightedShotIds}
            currentTime={currentTime}
            onSelectShot={selectShot}
            onRenameShot={updateShotName}
            onRemoveShot={removeShot}
            onUpdateShotTiming={updateShotTiming}
            onUpdateShotTransition={updateShotTransition}
            onUpdateShotCamera={updateShotCamera}
            onMoveShotTime={moveShotTime}
            onUpdateShotContinuity={updateShotContinuity}
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

      {marquee.rect && (
        <div
          className="pointer-events-none fixed z-50 border border-accent bg-accent/10"
          style={{
            left: marquee.rect.left,
            top: marquee.rect.top,
            width: marquee.rect.width,
            height: marquee.rect.height,
          }}
        />
      )}
    </div>
  )
}

export default ShotTimelinePanel
