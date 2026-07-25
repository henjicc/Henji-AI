import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CAMERA_STAGE_TIMELINE_HEX } from '@/core/theme/colorTokens'
import { getAnimatablePropByPath } from '../domain/animatableProps'
import { parseKeyframeKey, useCameraStageStore } from '../store/cameraStageStore'
import EasingCurveEditor from './EasingCurveEditor'
import GraphEditor, { type GraphTrack } from './GraphEditor'
import { axisColor } from './graphColors'
import PlaybackControls from './PlaybackControls'
import TimeRuler from './TimeRuler'
import TimelineTrackList from './TimelineTrackList'
import { buildTimelineTree } from './timelineTree'
import { clampPxPerSecond, timeToX, xToTime, type TimeRulerMode } from './timeScale'
import { TIMELINE_LABEL_WIDTH, TIMELINE_MIN_CONTENT_WIDTH, TIMELINE_RULER_HEIGHT, type EasingEditTarget } from './timelineLayout'

/**
 * 时间轴面板：顶部播放控制条 + 单滚动区（sticky 左轨道树 + sticky 顶刻度尺 + 关键帧泳道 + 播放头）。
 * 全部自研（Ui* + 绝对定位），关键帧写操作走 store 动作天然进撤销历史。
 */

const TimelinePanel: React.FC = () => {
  const objects = useCameraStageStore((state) => state.objects)
  const tracks = useCameraStageStore((state) => state.animation.tracks)
  const duration = useCameraStageStore((state) => state.animation.duration)
  const fps = useCameraStageStore((state) => state.animation.fps)
  const currentTime = useCameraStageStore((state) => state.playback.currentTime)
  const selectedId = useCameraStageStore((state) => state.selectedId)
  const selectedKeyframes = useCameraStageStore((state) => state.selectedKeyframes)
  const seek = useCameraStageStore((state) => state.seek)
  const setSelectedKeyframes = useCameraStageStore((state) => state.setSelectedKeyframes)
  const removeKeyframe = useCameraStageStore((state) => state.removeKeyframe)
  const setKeyframesEasing = useCameraStageStore((state) => state.setKeyframesEasing)

  const [mode, setMode] = useState<TimeRulerMode>('seconds')
  const [pxPerSecond, setPxPerSecond] = useState(120)
  const [graphView, setGraphView] = useState(false)
  const [viewportHeight, setViewportHeight] = useState(240)
  const [marquee, setMarquee] = useState<{
    startX: number
    startY: number
    currentX: number
    currentY: number
    additive: boolean
  } | null>(null)
  const [isPanning, setIsPanning] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const panRef = useRef<{ pointerId: number; startX: number; scrollLeft: number } | null>(null)
  const marqueeRef = useRef<typeof marquee>(null)
  const [easing, setEasing] = useState<{ target: EasingEditTarget; anchor: { x: number; y: number } } | null>(
    null,
  )
  marqueeRef.current = marquee

  const selectedSet = useMemo(() => new Set(selectedKeyframes), [selectedKeyframes])
  const contentWidth = Math.max(TIMELINE_MIN_CONTENT_WIDTH, timeToX(duration, pxPerSecond) + 40)
  const tree = useMemo(() => buildTimelineTree(objects, tracks), [objects, tracks])
  const hasTree = tree.length > 0
  const graphHeight = Math.max(160, viewportHeight - TIMELINE_RULER_HEIGHT - 2)

  // 曲线视图绘制「选中对象的 scalar 轨道」（颜色不入曲线）
  const plottedTracks = useMemo<GraphTrack[]>(() => {
    const object = tree.find((item) => item.objectId === selectedId)
    if (!object) return []
    const result: GraphTrack[] = []
    for (const group of object.groups) {
      for (const row of group.childRows) {
        if (getAnimatablePropByPath(row.path)?.valueType !== 'scalar') continue
        result.push({
          objectId: object.objectId,
          path: row.path,
          label: group.isVec3 ? `${group.label}·${row.label}` : group.label,
          track: row.track,
        })
      }
    }
    return result
  }, [tree, selectedId])

  // 曲线视图图高跟随面板高度
  useEffect(() => {
    const element = scrollRef.current
    if (!element) return
    const update = (): void => setViewportHeight(element.clientHeight)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [hasTree])

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>): void => {
      if (event.key === 'Escape') {
        setSelectedKeyframes([])
        return
      }
      if (event.key !== 'Delete' && event.key !== 'Backspace') return
      const selected = useCameraStageStore.getState().selectedKeyframes
      if (selected.length === 0) return
      event.preventDefault()
      for (const key of selected) {
        const parsed = parseKeyframeKey(key)
        if (parsed) removeKeyframe(parsed.objectId, parsed.path, parsed.time)
      }
      setSelectedKeyframes([])
    },
    [removeKeyframe, setSelectedKeyframes],
  )

  const openEasing = useCallback((target: EasingEditTarget, anchor: { x: number; y: number }): void => {
    setEasing({ target, anchor })
  }, [])

  const collectKeysInMarquee = useCallback((rect: DOMRect): string[] => {
    const root = scrollRef.current
    if (!root) return []
    const next = new Set<string>()
    root.querySelectorAll<Element>('[data-keyframe-keys]').forEach((element) => {
      const bounds = element.getBoundingClientRect()
      const intersects =
        bounds.left <= rect.right &&
        bounds.right >= rect.left &&
        bounds.top <= rect.bottom &&
        bounds.bottom >= rect.top
      if (!intersects) return
      const raw = element.getAttribute('data-keyframe-keys') ?? ''
      raw.split(',').filter(Boolean).forEach((key) => next.add(key))
    })
    return [...next]
  }, [])

  const finishMarquee = useCallback((): void => {
    const current = marqueeRef.current
    if (!current) return
    const left = Math.min(current.startX, current.currentX)
    const top = Math.min(current.startY, current.currentY)
    const width = Math.abs(current.currentX - current.startX)
    const height = Math.abs(current.currentY - current.startY)
    if (width < 3 && height < 3) {
      setSelectedKeyframes([])
      setMarquee(null)
      return
    }
    const keys = collectKeysInMarquee(new DOMRect(left, top, width, height))
    if (current.additive) {
      const merged = new Set(useCameraStageStore.getState().selectedKeyframes)
      keys.forEach((key) => merged.add(key))
      setSelectedKeyframes([...merged])
    } else {
      setSelectedKeyframes(keys)
    }
    setMarquee(null)
  }, [collectKeysInMarquee, setSelectedKeyframes])

  const handleWheel = useCallback(
    (event: React.WheelEvent<HTMLDivElement>): void => {
      if (!event.altKey) return
      event.preventDefault()
      const scroller = scrollRef.current
      if (!scroller) return
      const rect = scroller.getBoundingClientRect()
      const viewportContentX = event.clientX - rect.left - TIMELINE_LABEL_WIDTH
      if (viewportContentX < 0) return
      const anchorContentX = viewportContentX + scroller.scrollLeft
      const anchorTime = Math.max(0, xToTime(anchorContentX, pxPerSecond))
      const factor = Math.pow(1.0018, -event.deltaY)
      const nextPxPerSecond = clampPxPerSecond(pxPerSecond * factor)
      if (Math.abs(nextPxPerSecond - pxPerSecond) < 0.01) return
      setPxPerSecond(nextPxPerSecond)
      requestAnimationFrame(() => {
        scroller.scrollLeft = Math.max(0, timeToX(anchorTime, nextPxPerSecond) - viewportContentX)
      })
    },
    [pxPerSecond],
  )

  const shouldStartMarquee = (event: React.PointerEvent<HTMLDivElement>): boolean => {
    if (event.button !== 0) return false
    const target = event.target as Element | null
    if (!target) return false
    if (target.closest('[data-keyframe-keys], [data-graph-handle], [data-timeline-ruler="true"], [role="button"], button, input, textarea, select')) {
      return false
    }
    const scroller = scrollRef.current
    const rect = scroller?.getBoundingClientRect()
    return !!rect && event.clientX - rect.left >= TIMELINE_LABEL_WIDTH
  }

  const handlePointerDownCapture = (event: React.PointerEvent<HTMLDivElement>): void => {
    const scroller = scrollRef.current
    if (!scroller) return
    if (event.button === 1) {
      event.preventDefault()
      event.stopPropagation()
      event.currentTarget.setPointerCapture(event.pointerId)
      panRef.current = { pointerId: event.pointerId, startX: event.clientX, scrollLeft: scroller.scrollLeft }
      setIsPanning(true)
      return
    }
    if (!shouldStartMarquee(event)) return
    event.currentTarget.setPointerCapture(event.pointerId)
    setMarquee({
      startX: event.clientX,
      startY: event.clientY,
      currentX: event.clientX,
      currentY: event.clientY,
      additive: event.shiftKey,
    })
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    const pan = panRef.current
    const scroller = scrollRef.current
    if (pan && scroller) {
      scroller.scrollLeft = pan.scrollLeft - (event.clientX - pan.startX)
      return
    }
    if (!marqueeRef.current) return
    setMarquee((current) => (
      current ? { ...current, currentX: event.clientX, currentY: event.clientY } : current
    ))
  }

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (panRef.current) {
      panRef.current = null
      setIsPanning(false)
      event.currentTarget.releasePointerCapture?.(event.pointerId)
      return
    }
    if (!marqueeRef.current) return
    finishMarquee()
    event.currentTarget.releasePointerCapture?.(event.pointerId)
  }

  // 空格键播放/暂停（编辑器作用域全局；输入框内不拦截、无轨道时不响应）
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return
      if (event.key === 'F9') {
        const selected = useCameraStageStore.getState().selectedKeyframes
        if (selected.length === 0) return
        event.preventDefault()
        const targets = selected
          .map((key) => parseKeyframeKey(key))
          .filter((item): item is { objectId: string; path: string; time: number } => item !== null)
        setKeyframesEasing(targets, 'easeInOut')
        return
      }
      if (event.code !== 'Space') return
      const state = useCameraStageStore.getState()
      if (state.animation.tracks.length === 0) return
      event.preventDefault()
      if (state.playback.playing) state.pause()
      else state.play()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setKeyframesEasing])

  const marqueeBox = marquee
    ? {
        left: Math.min(marquee.startX, marquee.currentX),
        top: Math.min(marquee.startY, marquee.currentY),
        width: Math.abs(marquee.currentX - marquee.startX),
        height: Math.abs(marquee.currentY - marquee.startY),
      }
    : null

  return (
    <div className="flex h-full w-full flex-col bg-app">
      <PlaybackControls
        mode={mode}
        onModeChange={setMode}
        pxPerSecond={pxPerSecond}
        onPxPerSecondChange={(value) => setPxPerSecond(clampPxPerSecond(value))}
        graphView={graphView}
        onGraphViewChange={setGraphView}
      />

      {tree.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-4 text-center text-xs text-text-muted">
          在属性面板点击属性行的码表按钮为该属性打上关键帧后，轨道会出现在这里
        </div>
      ) : (
        <div
          ref={scrollRef}
          className={`relative flex-1 overflow-auto focus:outline-none ${isPanning ? 'cursor-grabbing' : ''}`}
          tabIndex={0}
          onKeyDown={handleKeyDown}
          onWheel={handleWheel}
          onPointerDownCapture={handlePointerDownCapture}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onPointerDown={(event) => {
            // 点击空白（非菱形/非刻度）清空关键帧选择
            if (event.target === event.currentTarget) setSelectedKeyframes([])
          }}
        >
          <div className="relative" style={{ width: TIMELINE_LABEL_WIDTH + contentWidth }}>
            {/* 刻度尺行（sticky 顶） */}
            <div className="sticky top-0 z-20 flex" style={{ height: TIMELINE_RULER_HEIGHT }}>
              <div
                className="sticky left-0 z-30 shrink-0 border-b border-r border-border-dark bg-surface-dark"
                style={{ width: TIMELINE_LABEL_WIDTH, height: TIMELINE_RULER_HEIGHT }}
              />
              <TimeRuler
                duration={duration}
                pxPerSecond={pxPerSecond}
                contentWidth={contentWidth}
                mode={mode}
                fps={fps}
                onScrub={seek}
              />
            </div>

            {graphView ? (
              <div className="flex" style={{ height: graphHeight }}>
                <div
                  className="sticky left-0 z-10 flex shrink-0 flex-col gap-1 overflow-y-auto border-r border-border-dark bg-app p-1.5"
                  style={{ width: TIMELINE_LABEL_WIDTH }}
                >
                  {plottedTracks.length === 0 ? (
                    <span className="px-1 text-2xs text-text-muted">选中一个对象查看其属性曲线</span>
                  ) : (
                    plottedTracks.map((graph) => (
                      <div key={graph.path} className="flex items-center gap-1.5 px-1">
                        <span
                          className="h-2 w-2 shrink-0 rounded-sm"
                          style={{ backgroundColor: axisColor(graph.path) }}
                        />
                        <span className="truncate text-2xs text-text-muted">{graph.label}</span>
                      </div>
                    ))
                  )}
                </div>
                <GraphEditor
                  tracks={plottedTracks}
                  pxPerSecond={pxPerSecond}
                  contentWidth={contentWidth}
                  height={graphHeight}
                  duration={duration}
                  fps={fps}
                  selectedKeys={selectedSet}
                  onOpenEasing={openEasing}
                />
              </div>
            ) : (
              <TimelineTrackList
                tree={tree}
                pxPerSecond={pxPerSecond}
                contentWidth={contentWidth}
                duration={duration}
                fps={fps}
                selectedSet={selectedSet}
                onOpenEasing={openEasing}
              />
            )}

            {/* 播放头：竖线 + 顶端向下三角（对齐常见时间轴/AE 的时间指针形态） */}
            <div
              className="pointer-events-none absolute bottom-0 top-0 z-20"
              style={{
                left: TIMELINE_LABEL_WIDTH + timeToX(currentTime, pxPerSecond),
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
          {marqueeBox && (
            <div
              className="pointer-events-none fixed z-50 border border-primary/70 bg-primary/15"
              style={marqueeBox}
            />
          )}
        </div>
      )}

      {easing && (
        <EasingCurveEditor
          target={easing.target}
          anchor={easing.anchor}
          onClose={() => setEasing(null)}
        />
      )}
    </div>
  )
}

export default TimelinePanel
