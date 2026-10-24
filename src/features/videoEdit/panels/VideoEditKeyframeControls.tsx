import { ChevronLeft, ChevronRight, Diamond, GanttChart, Timer } from 'lucide-react'
import { PanelTrigger, UiIconButton, useUiFieldLayout } from '@/components/ui'
import { UI_PROPERTY_REVEAL_CLASS } from '@/components/ui/styleTokens'
import { putVideoEditKeyframe, type VideoEditKeyframe, type VideoEditKeyframes } from '@/core/videoEdit/keyframes'
import { VideoEditKeyframeInterpolation } from './VideoEditKeyframeInterpolation'

/** 一行属性里的一个分量（位置的 X 或 Y）：它的关键帧与播放头处的当前值。 */
export interface VideoEditKeyframeChannel { key: string; points: VideoEditKeyframes | undefined; value: VideoEditKeyframe['value'] }

export interface VideoEditKeyframeControlProps {
  label: string; channels: readonly VideoEditKeyframeChannel[]; time: number; duration: number; discrete?: boolean
  /** 一次改动涉及的分量：键 → 改后的关键帧；空数组表示这个分量不再有动画。调用方把它记成一步撤销。 */
  onChange: (changes: Readonly<Record<string, VideoEditKeyframes>>) => void
  onDisable: () => void; onSeek: (time: number) => void
  onBegin: () => void; onFinish: () => void; onCancel: () => void
}

function keyframeState({ channels, time, duration }: VideoEditKeyframeControlProps) {
  const times = [...new Set(channels.flatMap(channel => channel.points?.map(point => point.time) ?? []))].sort((a, b) => a - b)
  const atTime = channels.flatMap(channel => { const point = channel.points?.find(item => item.time === time); return point ? [{ channel, point }] : [] })
  return { animated: times.length > 0, times, atTime, previous: times.filter(value => value < time).at(-1), next: times.find(value => value > time), inside: time >= 0 && time < duration }
}

/** 在播放头为整行（每个分量）打一个关键帧。 */
function addKeyframes(props: VideoEditKeyframeControlProps): void {
  props.onChange(Object.fromEntries(props.channels.map(channel => [channel.key, putVideoEditKeyframe(channel.points, { time: props.time, value: channel.value, interpolation: props.discrete ? 'hold' : 'linear' })])))
}

/**
 * 秒表列（重要记录 019）：一个秒表管整行——位置的 X、Y 一起开动画、一起关。开着时亮强调色常驻；
 * 属性面板里没开时悬停或聚焦本行才出现（表单排布里常驻）。
 */
export function VideoEditKeyframeStopwatch(props: VideoEditKeyframeControlProps): React.ReactElement {
  const { animated, inside } = keyframeState(props)
  const reveal = useUiFieldLayout() === 'property' && !animated
  const name = `${animated ? '关闭' : '启用'}${props.label}关键帧`
  return <span className={reveal ? `flex ${UI_PROPERTY_REVEAL_CLASS}` : 'flex'}>
    <UiIconButton size="2xs" on={animated} aria-pressed={animated} tooltip={name} aria-label={name} disabled={!animated && !inside} onClick={() => animated ? props.onDisable() : addKeyframes(props)}><Timer /></UiIconButton>
  </span>
}

/**
 * 开了动画的一行在名称后跟着关键帧导航：上一个 / 在播放头添加或删除 / 下一个，以及关键帧轨与插值浮层。
 * 悬停或聚焦本行才出现；完整的关键帧在时间线展开轨道里看和改。
 */
export function VideoEditKeyframeNavigator(props: VideoEditKeyframeControlProps): React.ReactElement | null {
  const { label, channels, time, duration, discrete, onChange, onSeek, onBegin, onFinish, onCancel } = props
  const { animated, times, atTime, previous, next, inside } = keyframeState(props)
  const reveal = useUiFieldLayout() === 'property'
  if (!animated) return null
  const current = atTime[0]?.point
  const remove = (): void => onChange(Object.fromEntries(channels.filter(channel => channel.points?.length).map(channel => [channel.key, channel.points!.filter(point => point.time !== time)])))
  return <span className={`flex shrink-0 items-center ${reveal ? UI_PROPERTY_REVEAL_CLASS : ''}`}>
    <UiIconButton size="2xs" tooltip={`上一个${label}关键帧`} aria-label={`上一个${label}关键帧`} disabled={previous === undefined} onClick={() => previous !== undefined && onSeek(previous)}><ChevronLeft /></UiIconButton>
    <UiIconButton size="2xs" on={Boolean(current)} tooltip={`${current ? '删除' : '添加'}${label}关键帧`} aria-label={`${current ? '删除' : '添加'}${label}关键帧`} disabled={!inside} onClick={() => current ? remove() : addKeyframes(props)}><Diamond fill={current ? 'currentColor' : 'none'} /></UiIconButton>
    <UiIconButton size="2xs" tooltip={`下一个${label}关键帧`} aria-label={`下一个${label}关键帧`} disabled={next === undefined} onClick={() => next !== undefined && onSeek(next)}><ChevronRight /></UiIconButton>
    <PanelTrigger alignment="bottomRight" panelWidth="content" panelPadding="content" renderPanel={() => <span className="flex w-56 flex-col gap-2">
      {current && !discrete && <VideoEditKeyframeInterpolation label={label} interpolation={current.interpolation} bezier={current.bezier} onBegin={onBegin} onFinish={onFinish} onCancel={onCancel}
        onChange={changes => onChange(Object.fromEntries(atTime.map(({ channel, point }) => [channel.key, putVideoEditKeyframe(channel.points, { ...point, ...changes, easeRange: undefined, easeValues: undefined })])))} />}
      <svg viewBox="0 0 100 20" className="h-8 w-full text-accent-text" aria-label={`${label}迷你关键帧轨`}>
        <path d="M2 10H98" stroke="currentColor" opacity={0.4} />
        {times.map(at => { const x = 2 + at / Math.max(1, duration - 1) * 96; return <path key={at} d={`M${x} 6l4 4-4 4-4-4Z`} fill="currentColor" onPointerDown={event => { event.stopPropagation(); onSeek(at) }} /> })}
        <path d={`M${2 + Math.max(0, Math.min(duration - 1, time)) / Math.max(1, duration - 1) * 96} 1v18`} stroke="currentColor" />
      </svg></span>}>{({ open, togglePanel }) => <UiIconButton size="2xs" on={open} aria-expanded={open} aria-haspopup="dialog" data-panel-trigger-button tooltip={`${label}关键帧轨与插值`} aria-label={`${label}关键帧轨与插值`} onClick={togglePanel}><GanttChart /></UiIconButton>}</PanelTrigger>
  </span>
}
