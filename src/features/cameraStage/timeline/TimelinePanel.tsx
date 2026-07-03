import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Trash2 } from 'lucide-react'
import { UiIconButton } from '@/components/ui'
import { CAMERA_STAGE_TIMELINE_HEX } from '@/core/theme/colorTokens'
import { getAnimatablePropByPath, listAnimatableProps } from '../domain/animatableProps'
import type { StageTrack } from '../domain/animationTypes'
import {
  parseKeyframeKey,
  useCameraStageStore,
} from '../store/cameraStageStore'
import EasingCurveEditor from './EasingCurveEditor'
import PlaybackControls from './PlaybackControls'
import TimeRuler from './TimeRuler'
import TrackLane from './TrackLane'
import { clampPxPerSecond, timeToX, type TimeRulerMode } from './timeScale'
import { TIMELINE_ROW_HEIGHT, TIMELINE_RULER_HEIGHT, type EasingEditTarget } from './timelineLayout'

/**
 * 时间轴面板：顶部播放控制条 + 单滚动区（sticky 左轨道树 + sticky 顶刻度尺 + 关键帧泳道 + 播放头）。
 * 全部自研（Ui* + 绝对定位），关键帧写操作走 store 动作天然进撤销历史。
 */

const LABEL_WIDTH = 208
const MIN_CONTENT_WIDTH = 600

interface TimelineTrackRow {
  path: string
  label: string
  track: StageTrack
}
interface TimelineGroup {
  objectId: string
  objectName: string
  rows: TimelineTrackRow[]
}

const TimelinePanel: React.FC = () => {
  const objects = useCameraStageStore((state) => state.objects)
  const tracks = useCameraStageStore((state) => state.animation.tracks)
  const duration = useCameraStageStore((state) => state.animation.duration)
  const fps = useCameraStageStore((state) => state.animation.fps)
  const currentTime = useCameraStageStore((state) => state.playback.currentTime)
  const selectedKeyframes = useCameraStageStore((state) => state.selectedKeyframes)
  const seek = useCameraStageStore((state) => state.seek)
  const setSelected = useCameraStageStore((state) => state.setSelected)
  const setSelectedKeyframes = useCameraStageStore((state) => state.setSelectedKeyframes)
  const removeKeyframe = useCameraStageStore((state) => state.removeKeyframe)
  const clearTrack = useCameraStageStore((state) => state.clearTrack)

  const [mode, setMode] = useState<TimeRulerMode>('seconds')
  const [pxPerSecond, setPxPerSecond] = useState(120)
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const [easing, setEasing] = useState<{ target: EasingEditTarget; anchor: { x: number; y: number } } | null>(
    null,
  )

  const selectedSet = useMemo(() => new Set(selectedKeyframes), [selectedKeyframes])
  const contentWidth = Math.max(MIN_CONTENT_WIDTH, timeToX(duration, pxPerSecond) + 40)

  const groups = useMemo<TimelineGroup[]>(() => {
    return objects
      .map((object) => {
        const order = listAnimatableProps(object).map((descriptor) => descriptor.path)
        const rows = tracks
          .filter((track) => track.objectId === object.id)
          .map((track) => ({
            path: track.propertyPath,
            label: getAnimatablePropByPath(track.propertyPath)?.label ?? track.propertyPath,
            track,
          }))
          .sort((a, b) => order.indexOf(a.path) - order.indexOf(b.path))
        return { objectId: object.id, objectName: object.name, rows }
      })
      .filter((group) => group.rows.length > 0)
  }, [objects, tracks])

  const toggleCollapsed = (objectId: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(objectId)) next.delete(objectId)
      else next.add(objectId)
      return next
    })
  }

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

  // 空格键播放/暂停（编辑器作用域全局；输入框内不拦截、无轨道时不响应）
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.code !== 'Space') return
      const target = event.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return
      const state = useCameraStageStore.getState()
      if (state.animation.tracks.length === 0) return
      event.preventDefault()
      if (state.playback.playing) state.pause()
      else state.play()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="flex h-full w-full flex-col bg-app">
      <PlaybackControls
        mode={mode}
        onModeChange={setMode}
        pxPerSecond={pxPerSecond}
        onPxPerSecondChange={(value) => setPxPerSecond(clampPxPerSecond(value))}
      />

      {groups.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-4 text-center text-xs text-text-muted">
          在属性面板点击属性行的码表按钮为该属性打上关键帧后，轨道会出现在这里
        </div>
      ) : (
        <div
          className="relative flex-1 overflow-auto focus:outline-none"
          tabIndex={0}
          onKeyDown={handleKeyDown}
          onPointerDown={(event) => {
            // 点击空白（非菱形/非刻度）清空关键帧选择
            if (event.target === event.currentTarget) setSelectedKeyframes([])
          }}
        >
          <div className="relative" style={{ width: LABEL_WIDTH + contentWidth }}>
            {/* 刻度尺行（sticky 顶） */}
            <div className="sticky top-0 z-20 flex" style={{ height: TIMELINE_RULER_HEIGHT }}>
              <div
                className="sticky left-0 z-30 shrink-0 border-b border-r border-border-dark bg-surface-dark"
                style={{ width: LABEL_WIDTH, height: TIMELINE_RULER_HEIGHT }}
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

            {groups.map((group) => {
              const isCollapsed = collapsed.has(group.objectId)
              return (
                <React.Fragment key={group.objectId}>
                  {/* 对象分组头 */}
                  <div className="flex" style={{ height: TIMELINE_ROW_HEIGHT }}>
                    <div
                      className="sticky left-0 z-10 flex shrink-0 items-center gap-1 border-r border-border-dark bg-surface-dark px-1.5"
                      style={{ width: LABEL_WIDTH }}
                    >
                      <UiIconButton
                        showBorder={false}
                        appearance="hover-only"
                        className="h-5 w-5"
                        title={isCollapsed ? '展开' : '收起'}
                        onClick={() => toggleCollapsed(group.objectId)}
                      >
                        {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                      </UiIconButton>
                      <span
                        role="button"
                        tabIndex={-1}
                        className="cursor-pointer truncate text-left text-xs font-medium text-text-dark"
                        onClick={() => setSelected(group.objectId)}
                        title={group.objectName}
                      >
                        {group.objectName}
                      </span>
                    </div>
                    <div style={{ width: contentWidth }} />
                  </div>

                  {!isCollapsed &&
                    group.rows.map((row) => (
                      <div className="flex" style={{ height: TIMELINE_ROW_HEIGHT }} key={row.path}>
                        <div
                          className="group sticky left-0 z-10 flex shrink-0 items-center justify-between border-b border-r border-border-dark bg-app pl-7 pr-1.5"
                          style={{ width: LABEL_WIDTH, borderBottomColor: CAMERA_STAGE_TIMELINE_HEX.laneBorder }}
                        >
                          <span
                            role="button"
                            tabIndex={-1}
                            className="cursor-pointer truncate text-left text-xs text-text-muted"
                            onClick={() => setSelected(group.objectId)}
                            title={row.label}
                          >
                            {row.label}
                          </span>
                          <UiIconButton
                            showBorder={false}
                            appearance="hover-only"
                            hoverVariant="danger"
                            className="h-5 w-5 opacity-0 group-hover:opacity-100"
                            title="删除该轨道"
                            onClick={() => clearTrack(group.objectId, row.path)}
                          >
                            <Trash2 size={12} />
                          </UiIconButton>
                        </div>
                        <TrackLane
                          track={row.track}
                          pxPerSecond={pxPerSecond}
                          contentWidth={contentWidth}
                          duration={duration}
                          fps={fps}
                          selectedKeys={selectedSet}
                          onOpenEasing={openEasing}
                        />
                      </div>
                    ))}
                </React.Fragment>
              )
            })}

            {/* 播放头：竖线 + 顶端向下三角（对齐常见时间轴/AE 的时间指针形态） */}
            <div
              className="pointer-events-none absolute bottom-0 top-0 z-20"
              style={{
                left: LABEL_WIDTH + timeToX(currentTime, pxPerSecond),
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
