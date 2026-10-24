import { useRef, useState, useSyncExternalStore } from 'react'
import { ChevronLeft, ChevronRight, Diamond, Hourglass, Square, Timer, Trash2 } from 'lucide-react'
import ContextMenu from '@/components/ContextMenu'
import { useContextMenu, type MenuItem } from '@/hooks/useContextMenu'
import { UiButton, UiIconButton, UiOptionButton, UiSegmented } from '@/components/ui'
import { UI_ICON_SIZE } from '@/core/theme/icons'
import type { VideoEditSequence } from '@/core/videoEdit/document'
import { requireVideoEditBuiltinEffect } from '@/core/videoEdit/builtinEffects'
import { evaluateVideoEditKeyframes, putVideoEditKeyframe, videoEditClipValue, type VideoEditAnimatableKey, type VideoEditKeyframe } from '@/core/videoEdit/keyframes'
import { VIDEO_EDIT_DEFAULT_BEZIER, type VideoEditBezier } from '@/core/videoEdit/keyframeInterpolation'
import { deleteVideoEditLaneKeyframe, editVideoEditLaneChannel, moveVideoEditLaneKeyframe, shapeVideoEditLaneKeyframe, videoEditKeyframeShape, videoEditLaneEntryTimes, videoEditLaneKeyframesAt, videoEditLaneTimes, type VideoEditKeyframeChanges, type VideoEditKeyframeLane, type VideoEditKeyframeLaneEntry, type VideoEditKeyframeShape } from '@/core/videoEdit/keyframeLanes'
import { writeVideoEditKeyframeLane } from '../application/videoEditKeyframeLanes'
import { videoEditClipPropertyBounds, type VideoEditClipPropertyKey } from '../application/videoEditClipProperties'
import { beginVideoEditGesture, finishVideoEditGesture, setVideoEditView, subscribeVideoEditView, videoEditViewRevision, type VideoEditGesture, type VideoEditInstance } from '../application/videoEditService'
import { formatVideoEditPropertyValue } from '../panels/videoEditPropertyViews'
import { TIMELINE_HEADER_WIDTH, timelineTimecode, type TimelineViewport } from './timelineGeometry'
import { KEYFRAME_LANE_HEADER, KEYFRAME_LANE_ROW, type VideoEditKeyframeLaneMode } from './keyframeLaneGeometry'

interface Props {
  instance: VideoEditInstance; sequence: VideoEditSequence; trackName: string; locked: boolean
  lanes: readonly VideoEditKeyframeLane[]; mode: VideoEditKeyframeLaneMode; onModeChange: (mode: VideoEditKeyframeLaneMode) => void
  top: number; height: number; pixels: number; fps: number; view: TimelineViewport; onError: (error: unknown) => void
}
/** 选中的关键帧：哪一行、哪个片段、片段内第几帧（同一时间上各分量一起算一个）。 */
interface Selected { laneId: string; clipId: string; time: number }

/** 关键帧形状（设计稿图例）：直线是菱形，曲线（缓入缓出）是沙漏，定格是方块。 */
const GLYPHS: Record<VideoEditKeyframeShape, string> = { linear: 'M12 4l8 8-8 8-8-8z', curve: 'M6 4h12l-5 8 5 8H6l5-8z', hold: 'M7 7h10v10H7z' }
const SHAPE_LABELS: Record<VideoEditKeyframeShape, string> = { linear: '直线', curve: '曲线', hold: '定格' }
const SHAPE_ICONS = { linear: Diamond, curve: Hourglass, hold: Square } as const
const MODE_OPTIONS = [{ value: 'keyframes' as const, label: '关键帧' }, { value: 'curve' as const, label: '速度曲线' }]
const CURVE_PAD = 14

const entryOf = (lane: VideoEditKeyframeLane, clipId: string): VideoEditKeyframeLaneEntry | undefined => lane.entries.find(entry => entry.clip.id === clipId)
const entryAt = (lane: VideoEditKeyframeLane, frame: number): VideoEditKeyframeLaneEntry | undefined => lane.entries.find(entry => frame >= entry.clip.start && frame < entry.clip.start + entry.clip.duration)
const shapeAt = (entry: VideoEditKeyframeLaneEntry, time: number): VideoEditKeyframeShape => videoEditKeyframeShape(videoEditLaneKeyframesAt(entry, time)[0]?.point.interpolation ?? 'linear')
const numericLane = (lane: VideoEditKeyframeLane): boolean => !lane.discrete && lane.entries.every(entry => entry.channels.every(channel => channel.points.every(point => typeof point.value === 'number')))

/** 一个分量在片段内帧 `time` 的当前值（打关键帧用）：固有属性按片段求值，内置效果按参数与它的关键帧求值。 */
function channelValue(entry: VideoEditKeyframeLaneEntry, key: string, time: number): VideoEditKeyframe['value'] {
  if (entry.source.kind === 'intrinsic') return videoEditClipValue({ ...entry.clip, disabledIntrinsicSections: [] }, key as VideoEditAnimatableKey, entry.clip.start + time)
  const effectId = entry.source.effectId
  const builtin = entry.clip.effects?.find(effect => effect.id === effectId)?.builtin
  if (!builtin) throw new Error('原内置效果已移除。')
  const fallback = builtin.params[key] ?? requireVideoEditBuiltinEffect(builtin.id).params.find(param => param.key === key)?.default ?? 0
  return evaluateVideoEditKeyframes(entry.channels.find(channel => channel.key === key)?.points, time, fallback as VideoEditKeyframe['value'])
}
/** 速度曲线里拖数值时的取值范围（属性或参数登记的边界）。 */
function channelBounds(entry: VideoEditKeyframeLaneEntry, key: string): { min: number; max: number } {
  if (entry.source.kind === 'intrinsic') return videoEditClipPropertyBounds(key as VideoEditClipPropertyKey)
  const effectId = entry.source.effectId
  const builtin = entry.clip.effects?.find(effect => effect.id === effectId)?.builtin
  const param = builtin && requireVideoEditBuiltinEffect(builtin.id).params.find(value => value.key === key)
  return param?.type === 'number' ? { min: param.min, max: param.max } : { min: -Infinity, max: Infinity }
}
function formatValue(entry: VideoEditKeyframeLaneEntry, key: string, value: number, sequence: VideoEditSequence): string {
  return entry.source.kind === 'intrinsic' ? formatVideoEditPropertyValue(key as VideoEditClipPropertyKey, value, sequence) : String(Math.round(value * 10) / 10)
}

/** 关键帧视图左侧的一行：秒表（开着动画）、名称、上一个 / 在播放头添加或删除 / 下一个；只有它跟着播放头刷新。 */
function LaneNavigator({ instance, lane, locked, onSeek, onToggle }: { instance: VideoEditInstance; lane: VideoEditKeyframeLane; locked: boolean; onSeek: (frame: number) => void; onToggle: () => void }): React.ReactElement {
  useSyncExternalStore(subscribeVideoEditView, videoEditViewRevision)
  const frame = instance.frame
  const times = videoEditLaneTimes(lane); const entry = entryAt(lane, frame)
  const atPlayhead = Boolean(entry && videoEditLaneKeyframesAt(entry, frame - entry.clip.start).length)
  const previous = times.filter(value => value < frame).at(-1); const next = times.find(value => value > frame)
  return <div className="flex h-7 shrink-0 items-center gap-1" data-video-edit-keyframe-lane-row={lane.id}>
    <Timer size={UI_ICON_SIZE.xs} aria-hidden="true" className="shrink-0 text-accent-text" />
    <span className="min-w-0 flex-1 truncate text-2xs text-text2" title={lane.label}>{lane.label}</span>
    <UiIconButton size="2xs" aria-label={`上一个${lane.label}关键帧`} tooltip={`上一个${lane.label}关键帧`} disabled={previous === undefined} disabledReason="播放头前面没有这一行的关键帧" onClick={() => previous !== undefined && onSeek(previous)}><ChevronLeft /></UiIconButton>
    <UiIconButton size="2xs" on={atPlayhead} aria-label={`${atPlayhead ? '删除' : '添加'}${lane.label}关键帧`} tooltip={`${atPlayhead ? '删除' : '添加'}${lane.label}关键帧`} disabled={!entry || locked} disabledReason={locked ? '轨道已锁定' : '播放头处没有这一行有动画的片段'} onClick={onToggle}><Diamond fill={atPlayhead ? 'currentColor' : 'none'} /></UiIconButton>
    <UiIconButton size="2xs" aria-label={`下一个${lane.label}关键帧`} tooltip={`下一个${lane.label}关键帧`} disabled={next === undefined} disabledReason="播放头后面没有这一行的关键帧" onClick={() => next !== undefined && onSeek(next)}><ChevronRight /></UiIconButton>
  </div>
}

function KeyframeGlyph({ shape }: { shape: VideoEditKeyframeShape }): React.ReactElement {
  // icon-token-allow 关键帧形状是时间轴图形（菱形直线、沙漏曲线、方块定格，设计稿图例），不是图标
  return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-3 w-3"><path d={GLYPHS[shape]} fill="currentColor" /></svg>
}

/**
 * 展开轨道的关键帧区（重要记录 019）：左侧是视图切换和每个有动画的属性一行（秒表、名称、上一个 / 添加或删除 / 下一个），
 * 右侧按片段位置摆关键帧（形状即插值：菱形直线、沙漏曲线、方块定格）；点选、左右拖动改时间、右键改形状或删除，Delete 删除。
 * 同一区域可切到速度曲线：左边选属性，右边拖关键帧改时间和数值、拖手柄改曲线；选中的关键帧可改直线、曲线或定格。
 */
export function VideoEditTrackKeyframeLane({ instance, sequence, trackName, locked, lanes, mode, onModeChange, top, height, pixels, fps, view, onError }: Props): React.ReactElement {
  const projectId = instance.document.id
  const [selected, setSelected] = useState<Selected | null>(null)
  const [curveLaneId, setCurveLaneId] = useState<string | null>(null)
  const menu = useContextMenu()
  const root = useRef<HTMLDivElement>(null)
  const selectedLane = selected && lanes.find(lane => lane.id === selected.laneId)
  const selectedEntry = selectedLane && selected ? entryOf(selectedLane, selected.clipId) : undefined
  const current = selected && selectedEntry && videoEditLaneKeyframesAt(selectedEntry, selected.time).length ? { ...selected, lane: selectedLane!, entry: selectedEntry } : null
  const curveLanes = lanes.filter(numericLane)
  const curveLane = curveLanes.find(lane => lane.id === curveLaneId) ?? curveLanes[0]
  const target = (entry: VideoEditKeyframeLaneEntry) => ({ projectId, sequenceId: sequence.id, clipId: entry.clip.id, source: entry.source })
  const write = (entry: VideoEditKeyframeLaneEntry, changes: VideoEditKeyframeChanges, statics?: Record<string, VideoEditKeyframe['value']>, handle?: VideoEditGesture): boolean => {
    try { writeVideoEditKeyframeLane(target(entry), changes, statics, handle); return true } catch (error) { onError(error); return false }
  }
  const remove = (entry: VideoEditKeyframeLaneEntry, time: number): void => {
    const { changes, statics } = deleteVideoEditLaneKeyframe(entry, time)
    if (write(entry, changes, statics)) setSelected(null)
  }
  const reshape = (entry: VideoEditKeyframeLaneEntry, time: number, shape: VideoEditKeyframeShape): void => { write(entry, shapeVideoEditLaneKeyframe(entry, time, shape)) }
  const seek = (value: number): void => { try { setVideoEditView(projectId, { frame: value, playing: false }) } catch (error) { onError(error) } }
  /** 播放头处：有关键帧就删，没有就整行打一个（只对这一行已有动画的片段）。 */
  const toggleAt = (lane: VideoEditKeyframeLane): void => {
    const frame = instance.frame; const entry = entryAt(lane, frame); if (!entry) return
    const time = frame - entry.clip.start
    if (videoEditLaneKeyframesAt(entry, time).length) { remove(entry, time); return }
    try {
      const changes = Object.fromEntries(entry.channels.map(channel => [channel.key, putVideoEditKeyframe(channel.points, { time, value: channelValue(entry, channel.key, time), interpolation: lane.discrete ? 'hold' : 'linear' })]))
      if (write(entry, changes)) setSelected({ laneId: lane.id, clipId: entry.clip.id, time })
    } catch (error) { onError(error) }
  }
  const menuItems = (entry: VideoEditKeyframeLaneEntry, discrete: boolean, time: number): MenuItem[] => [
    ...(['linear', 'curve', 'hold'] as const).map(shape => { const Icon = SHAPE_ICONS[shape]; return { id: shape, label: SHAPE_LABELS[shape], icon: <Icon size={UI_ICON_SIZE.sm} />, disabled: locked || discrete && shape !== 'hold' || shapeAt(entry, time) === shape, onClick: () => reshape(entry, time, shape) } }),
    { id: 'delete', label: '删除关键帧', icon: <Trash2 size={UI_ICON_SIZE.sm} />, disabled: locked, divider: true, onClick: () => remove(entry, time) },
  ]

  // 关键帧视图的横向拖动：只改时间，各分量一起挪；挪回原处恢复原样，Esc 或丢失指针取消。
  const drag = useRef<{ pointerId: number; startX: number; lane: VideoEditKeyframeLane; entry: VideoEditKeyframeLaneEntry; from: number; to: number; handle?: VideoEditGesture }>()
  const endDrag = (commit: boolean): void => {
    const state = drag.current; drag.current = undefined
    if (!state) return
    if (state.handle) { try { finishVideoEditGesture(state.handle, commit) } catch (error) { onError(error) } }
    setSelected({ laneId: state.lane.id, clipId: state.entry.clip.id, time: commit ? state.to : state.from })
  }
  const dragTo = (clientX: number): void => {
    const state = drag.current; if (!state) return
    const to = state.from + Math.round((clientX - state.startX) / pixels)
    if (to === state.to) return
    const restore = Object.fromEntries(state.entry.channels.filter(channel => channel.points.some(point => point.time === state.from)).map(channel => [channel.key, channel.points]))
    const changes = to === state.from ? restore : moveVideoEditLaneKeyframe(state.entry, state.from, to)
    if (!changes) return
    try { state.handle ??= beginVideoEditGesture(projectId) } catch (error) { drag.current = undefined; onError(error); return }
    if (write(state.entry, changes, undefined, state.handle)) state.to = to
    else endDrag(false)
  }

  const header = <div className="flex h-8 shrink-0 items-center"><UiSegmented size="sm" ariaLabel={`${trackName}关键帧视图`} value={mode} options={MODE_OPTIONS} onChange={onModeChange} /></div>
  const visible = (value: number): boolean => value * pixels >= view.left - 16 && value * pixels <= view.left + view.width
  return <div ref={root} tabIndex={-1} role="group" aria-label={`${trackName}关键帧`} data-video-edit-keyframe-lane={mode} className="absolute left-0 right-0 border-b border-gap bg-window outline-none" style={{ top, height }}
    onPointerDown={event => { event.stopPropagation(); if (event.target === event.currentTarget) setSelected(null) }}
    // 拖动中关键帧会换位置重新挂载：指针捕获、移动与松开都在不卸载的根节点上处理
    onPointerMove={event => { if (drag.current?.pointerId === event.pointerId) dragTo(event.clientX) }}
    onPointerUp={event => { if (drag.current?.pointerId === event.pointerId) endDrag(true) }}
    onPointerCancel={() => endDrag(false)} onLostPointerCapture={() => { if (drag.current) endDrag(true) }}
    onContextMenu={event => { event.preventDefault(); event.stopPropagation() }} onDoubleClick={event => event.stopPropagation()}
    onKeyDown={event => {
      if (event.key === 'Escape' && drag.current) { event.preventDefault(); event.stopPropagation(); endDrag(false); return }
      if ((event.key === 'Delete' || event.key === 'Backspace') && current && !locked) { event.preventDefault(); event.stopPropagation(); remove(current.entry, current.time) }
    }}>
    <div className="sticky left-0 z-sticky flex h-full flex-col border-r border-gap bg-panel pl-8 pr-1.5" style={{ width: TIMELINE_HEADER_WIDTH }}>
      {header}
      {mode === 'keyframes' ? lanes.map(lane => <LaneNavigator key={lane.id} instance={instance} lane={lane} locked={locked} onSeek={seek} onToggle={() => toggleAt(lane)} />) : <>
        {curveLanes.map(lane => <UiOptionButton key={lane.id} variant="menu" size="sm" active={lane === curveLane} className="w-full" onClick={() => setCurveLaneId(lane.id)}><span className="truncate text-2xs">{lane.label}</span></UiOptionButton>)}
        <div className="flex-1" />
        <span className="pb-1 text-2xs text-text3">选中的关键帧</span>
        <div className="pb-2"><UiSegmented size="sm" ariaLabel="选中关键帧的形状" disabled={!current || locked} disabledReason={locked ? '轨道已锁定' : '先在右侧点选一个关键帧'}
          value={current ? shapeAt(current.entry, current.time) : 'linear'} onChange={shape => current && reshape(current.entry, current.time, shape)}
          options={(['linear', 'curve', 'hold'] as const).map(shape => { const Icon = SHAPE_ICONS[shape]; return { value: shape, label: SHAPE_LABELS[shape], icon: <Icon size={UI_ICON_SIZE.xs} />, disabled: Boolean(current?.lane.discrete) && shape !== 'hold' } })} /></div>
      </>}
    </div>
    {mode === 'keyframes' && (lanes.length ? lanes.map((lane, index) => <div key={lane.id} className="pointer-events-none absolute left-0 right-0" style={{ top: KEYFRAME_LANE_HEADER + index * KEYFRAME_LANE_ROW, height: KEYFRAME_LANE_ROW }}>
      {lane.entries.map(entry => <div key={entry.clip.id} aria-hidden="true" className="absolute top-1/2 h-px bg-line" style={{ left: TIMELINE_HEADER_WIDTH + entry.clip.start * pixels, width: entry.clip.duration * pixels }} />)}
      {lane.entries.flatMap(entry => videoEditLaneEntryTimes(entry).filter(time => visible(entry.clip.start + time)).map(time => {
        const on = selected?.laneId === lane.id && selected.clipId === entry.clip.id && selected.time === time
        const shape = shapeAt(entry, time)
        return <span key={`${entry.clip.id}:${time}`} className="pointer-events-auto">
          {/* ui-surface-allow 关键帧记号：16px 命中区 + 形状图形，是时间轴记号不是按钮档位（同标尺标记） */}
          <UiButton aria-label={`${lane.label}关键帧 ${timelineTimecode(entry.clip.start + time, fps)} ${SHAPE_LABELS[shape]}`} aria-pressed={on} data-video-edit-keyframe={`${entry.clip.id}:${time}`}
            className={`absolute top-1/2 -ml-2 -mt-2 !h-4 !w-4 !p-0 ${on ? 'text-accent-text' : 'text-text2'} ${locked ? '' : 'cursor-ew-resize'}`} style={{ left: TIMELINE_HEADER_WIDTH + (entry.clip.start + time) * pixels }}
            onPointerDown={event => {
              event.stopPropagation()
              if (event.button !== 0) return
              setSelected({ laneId: lane.id, clipId: entry.clip.id, time })
              if (locked) return
              root.current?.setPointerCapture?.(event.pointerId)
              drag.current = { pointerId: event.pointerId, startX: event.clientX, lane, entry, from: time, to: time }
            }}
            onKeyDown={event => { if ((event.key === 'Delete' || event.key === 'Backspace') && !locked) { event.preventDefault(); event.stopPropagation(); remove(entry, time) } }}
            onDoubleClick={() => seek(entry.clip.start + time)}
            onContextMenu={event => { setSelected({ laneId: lane.id, clipId: entry.clip.id, time }); menu.showMenu(event, menuItems(entry, lane.discrete, time)) }}><KeyframeGlyph shape={shape} /></UiButton>
        </span>
      }))}
    </div>) : <span className="pointer-events-none absolute truncate text-2xs text-text3" style={{ top: KEYFRAME_LANE_HEADER + 6, left: TIMELINE_HEADER_WIDTH + view.left + 12, maxWidth: Math.max(0, view.width - TIMELINE_HEADER_WIDTH - 24) }}>这条轨道的片段还没有关键帧：在效果控件里点属性前的秒表开始动画</span>)}
    {mode === 'curve' && (curveLane
      ? <CurveGraph lane={curveLane} sequence={sequence} selected={selected} locked={locked} height={height} pixels={pixels} view={view} projectId={projectId} write={write} onError={onError}
        onSelect={value => { setSelected(value); root.current?.focus({ preventScroll: true }) }} onMenu={(event, entry, time) => menu.showMenu(event, menuItems(entry, curveLane.discrete, time))} />
      : <span className="pointer-events-none absolute truncate text-2xs text-text3" style={{ top: KEYFRAME_LANE_HEADER + 6, left: TIMELINE_HEADER_WIDTH + view.left + 12, maxWidth: Math.max(0, view.width - TIMELINE_HEADER_WIDTH - 24) }}>{lanes.length ? '这里的关键帧都是开关或选项，没有可画的数值曲线' : '这条轨道的片段还没有关键帧：在效果控件里点属性前的秒表开始动画'}</span>)}
    <ContextMenu items={menu.menuItems} position={menu.menuPosition} visible={menu.menuVisible} onClose={menu.hideMenu} />
  </div>
}

interface CurveDrag { pointerId: number; entry: VideoEditKeyframeLaneEntry; key: string; time: number; to: number; handleIndex?: 0 | 2; range: { low: number; high: number }; rect: DOMRect; handle?: VideoEditGesture }

/**
 * 速度曲线（数值曲线）：每个分量按自己的取值范围画满高度，第一分量主文字色、其余次要色。拖关键帧左右改时间（各分量一起）、
 * 上下改这个分量的数值；选中的关键帧两侧显示贝塞尔手柄，拖手柄即改成自定义曲线。拖动期间取值范围不变。
 */
function CurveGraph({ lane, sequence, selected, locked, height, pixels, view, projectId, write, onSelect, onMenu, onError }: {
  lane: VideoEditKeyframeLane; sequence: VideoEditSequence; selected: Selected | null; locked: boolean; height: number; pixels: number; view: TimelineViewport; projectId: string
  write: (entry: VideoEditKeyframeLaneEntry, changes: VideoEditKeyframeChanges, statics?: Record<string, VideoEditKeyframe['value']>, handle?: VideoEditGesture) => boolean
  onSelect: (value: Selected) => void; onMenu: (event: React.MouseEvent, entry: VideoEditKeyframeLaneEntry, time: number) => void; onError: (error: unknown) => void
}): React.ReactElement {
  const drag = useRef<CurveDrag>()
  const width = Math.max(1, view.width - TIMELINE_HEADER_WIDTH)
  const keys = lane.entries[0]?.channels.map(channel => channel.key) ?? []
  const ranges = new Map(keys.map(key => {
    const values = lane.entries.flatMap(entry => entry.channels.find(channel => channel.key === key)?.points.map(point => point.value as number) ?? [])
    const min = Math.min(...values); const max = Math.max(...values)
    const span = max - min || Math.max(Math.abs(max), 1) * 0.2
    return [key, values.length ? { low: min - span * 0.15, high: max + span * 0.15 } : { low: 0, high: 1 }]
  }))
  const x = (frame: number): number => frame * pixels - view.left
  const y = (value: number, range: { low: number; high: number }): number => CURVE_PAD + (1 - (value - range.low) / (range.high - range.low)) * (height - 2 * CURVE_PAD)
  const valueAt = (clientY: number, state: CurveDrag): number => state.range.low + (1 - (clientY - state.rect.top - CURVE_PAD) / Math.max(1, height - 2 * CURVE_PAD)) * (state.range.high - state.range.low)
  const from = Math.floor(view.left / pixels); const to = Math.ceil((view.left + width) / pixels)
  const finish = (commit: boolean): void => {
    const state = drag.current; drag.current = undefined
    if (state?.handle) { try { finishVideoEditGesture(state.handle, commit) } catch (error) { onError(error) } }
    if (state && commit && state.handleIndex === undefined) onSelect({ laneId: lane.id, clipId: state.entry.clip.id, time: state.to })
  }
  const move = (event: React.PointerEvent): void => {
    const state = drag.current; if (!state || state.pointerId !== event.pointerId) return
    const { entry, key } = state
    const bounds = channelBounds(entry, key)
    let changes: VideoEditKeyframeChanges
    if (state.handleIndex !== undefined) {
      const channel = entry.channels.find(value => value.key === key)!; const index = channel.points.findIndex(point => point.time === state.time)
      const left = channel.points[index]; const right = channel.points[index + 1]
      if (!left || !right || right.value === left.value) return
      const bezier: VideoEditBezier = [...(left.bezier ?? VIDEO_EDIT_DEFAULT_BEZIER)]
      bezier[state.handleIndex] = Math.max(0, Math.min(1, ((event.clientX - state.rect.left + view.left) / pixels - entry.clip.start - left.time) / (right.time - left.time)))
      bezier[state.handleIndex + 1] = (valueAt(event.clientY, state) - Number(left.value)) / (Number(right.value) - Number(left.value))
      changes = editVideoEditLaneChannel(entry, key, left.time, { interpolation: 'bezier', bezier })
    } else {
      const time = Math.round((event.clientX - state.rect.left + view.left) / pixels) - entry.clip.start
      const moved = time === state.time ? null : moveVideoEditLaneKeyframe(entry, state.time, time)
      const at = moved ? time : state.time
      const base: VideoEditKeyframeLaneEntry = moved ? { ...entry, channels: entry.channels.map(channel => ({ ...channel, points: moved[channel.key] ?? channel.points })) } : entry
      const restore = Object.fromEntries(entry.channels.filter(channel => channel.points.some(point => point.time === state.time)).map(channel => [channel.key, channel.points]))
      changes = { ...restore, ...moved, ...editVideoEditLaneChannel(base, key, at, { value: Math.max(bounds.min, Math.min(bounds.max, valueAt(event.clientY, state))) }) }
      state.to = at
    }
    try { state.handle ??= beginVideoEditGesture(projectId) } catch (error) { drag.current = undefined; onError(error); return }
    if (!write(entry, changes, undefined, state.handle)) finish(false)
  }
  const selectedEntry = selected?.laneId === lane.id ? lane.entries.find(entry => entry.clip.id === selected.clipId) : undefined
  // icon-token-allow 速度曲线是数据图形（曲线、关键帧、贝塞尔手柄），不是图标
  return <svg className={`absolute ${locked ? '' : 'cursor-crosshair'}`} style={{ left: TIMELINE_HEADER_WIDTH + view.left, top: 0, width, height }} viewBox={`0 0 ${width} ${height}`} aria-label={`${lane.label}速度曲线`} data-video-edit-keyframe-curve={lane.id}
    onPointerDown={event => {
      const element = event.target as Element
      const clipId = element.getAttribute('data-curve-clip'); const key = element.getAttribute('data-curve-key'); const time = element.getAttribute('data-curve-time')
      if (event.button !== 0 || clipId === null || key === null || time === null) return
      const entry = lane.entries.find(value => value.clip.id === clipId); if (!entry) return
      const handleText = element.getAttribute('data-curve-handle')
      if (handleText === null) onSelect({ laneId: lane.id, clipId, time: Number(time) })
      if (locked) return
      event.currentTarget.setPointerCapture?.(event.pointerId)
      drag.current = { pointerId: event.pointerId, entry, key, time: Number(time), to: Number(time), ...(handleText !== null ? { handleIndex: Number(handleText) as 0 | 2 } : {}), range: ranges.get(key)!, rect: event.currentTarget.getBoundingClientRect() }
    }}
    onPointerMove={move} onPointerUp={event => { if (drag.current?.pointerId === event.pointerId) finish(true) }} onPointerCancel={() => finish(false)} onLostPointerCapture={() => { if (drag.current) finish(true) }}
    onContextMenu={event => {
      const element = event.target as Element; const clipId = element.getAttribute('data-curve-clip'); const time = element.getAttribute('data-curve-time')
      const entry = clipId === null ? undefined : lane.entries.find(value => value.clip.id === clipId)
      if (!entry || time === null || element.hasAttribute('data-curve-handle')) return
      onSelect({ laneId: lane.id, clipId: entry.clip.id, time: Number(time) }); onMenu(event, entry, Number(time))
    }}>
    {[0.25, 0.5, 0.75].map(at => <line key={at} x1={0} x2={width} y1={CURVE_PAD + at * (height - 2 * CURVE_PAD)} y2={CURVE_PAD + at * (height - 2 * CURVE_PAD)} className="stroke-line" strokeWidth={1} />)}
    {lane.entries.flatMap(entry => entry.channels.map((channel, channelIndex) => {
      if (!channel.points.length) return null
      const range = ranges.get(channel.key)!
      const start = Math.max(entry.clip.start, from); const end = Math.min(entry.clip.start + entry.clip.duration - 1, to)
      if (end < start) return null
      const samples = Math.min(256, Math.max(2, Math.ceil((end - start) * pixels / 3)))
      const path = Array.from({ length: samples }, (_, index) => {
        const at = start + index / (samples - 1) * (end - start)
        return `${index ? 'L' : 'M'}${x(at)} ${y(evaluateVideoEditKeyframes(channel.points, at - entry.clip.start, channel.points[0].value) as number, range)}`
      }).join(' ')
      return <path key={`${entry.clip.id}:${channel.key}`} d={path} fill="none" className={channelIndex ? 'stroke-text3' : 'stroke-text1'} strokeWidth={channelIndex ? 1.25 : 1.75} pointerEvents="none" />
    }))}
    {selectedEntry && selected && selectedEntry.channels.flatMap(channel => {
      const range = ranges.get(channel.key)!; const index = channel.points.findIndex(point => point.time === selected.time)
      if (index < 0) return []
      // 选中关键帧两侧的手柄：出手柄属于它自己那一段，入手柄属于前一个关键帧那一段。
      return ([[index, 0], [index - 1, 2]] as const).flatMap(([leftIndex, handle]) => {
        const left = channel.points[leftIndex]; const right = channel.points[leftIndex + 1]
        if (!left || !right || left.interpolation === 'linear' || left.interpolation === 'hold' || left.value === right.value) return []
        const controls = left.bezier ?? VIDEO_EDIT_DEFAULT_BEZIER
        const hx = x(selectedEntry.clip.start + left.time + (right.time - left.time) * controls[handle])
        const hy = y(Number(left.value) + (Number(right.value) - Number(left.value)) * controls[handle + 1], range)
        const anchor = handle === 0 ? left : right
        return [<g key={`${channel.key}:${handle}`} className="text-accent-text">
          <line x1={x(selectedEntry.clip.start + anchor.time)} y1={y(Number(anchor.value), range)} x2={hx} y2={hy} stroke="currentColor" strokeWidth={1} pointerEvents="none" />
          <circle data-curve-clip={selectedEntry.clip.id} data-curve-key={channel.key} data-curve-time={left.time} data-curve-handle={handle} aria-label={`${lane.label}曲线${handle === 0 ? '出' : '入'}手柄`} cx={hx} cy={hy} r={4} className="fill-panel" stroke="currentColor" strokeWidth={1.5} />
        </g>]
      })
    })}
    {lane.entries.flatMap(entry => entry.channels.flatMap(channel => {
      const range = ranges.get(channel.key)!
      return channel.points.filter(point => entry.clip.start + point.time >= from - 1 && entry.clip.start + point.time <= to + 1).map(point => {
        const on = selectedEntry === entry && selected?.time === point.time
        const cx = x(entry.clip.start + point.time); const cy = y(point.value as number, range)
        return <g key={`${entry.clip.id}:${channel.key}:${point.time}`} className={on ? 'text-accent-text' : 'text-text2'}>
          <rect data-curve-clip={entry.clip.id} data-curve-key={channel.key} data-curve-time={point.time} aria-label={`${lane.label}关键帧 ${formatValue(entry, channel.key, point.value as number, sequence)}`} x={cx - 4} y={cy - 4} width={8} height={8} fill="currentColor" />
          {on && channel === entry.channels.find(value => value.points.some(item => item.time === point.time)) && <text x={cx + 8} y={cy - 8} className="fill-text1 font-mono text-2xs" pointerEvents="none">{formatValue(entry, channel.key, point.value as number, sequence)}</text>}
        </g>
      })
    }))}
  </svg>
}
