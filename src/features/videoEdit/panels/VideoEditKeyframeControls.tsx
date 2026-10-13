import { ChevronLeft, ChevronRight, Diamond, GanttChart, Timer } from 'lucide-react'
import { PanelTrigger, UiIconButton } from '@/components/ui'
import { putVideoEditKeyframe, type VideoEditKeyframe, type VideoEditKeyframes } from '@/core/videoEdit/keyframes'
import { VideoEditKeyframeInterpolation } from './VideoEditKeyframeInterpolation'

export interface VideoEditKeyframeControlProps {
  label: string; points: VideoEditKeyframes | undefined; time: number; duration: number; value: VideoEditKeyframe['value']; discrete?: boolean
  onChange: (points: VideoEditKeyframes) => void; onDisable: () => void; onSeek: (time: number) => void
  onBegin: () => void; onFinish: () => void; onCancel: () => void
}
/** Parameter-local controls: stopwatch, previous/add-remove/next, interpolation and optional mini track. */
export function VideoEditKeyframeControls({ label, points, time, duration, value, discrete, onChange, onDisable, onSeek, onBegin, onFinish, onCancel }: VideoEditKeyframeControlProps): React.ReactElement {
  const enabled = Boolean(points?.length); const current = points?.find(point => point.time === time)
  const previous = points?.filter(point => point.time < time).at(-1); const next = points?.find(point => point.time > time)
  const inside = time >= 0 && time < duration
  const add = (): void => onChange(putVideoEditKeyframe(points, { time, value, interpolation: discrete ? 'hold' : 'linear' }))
  return <span className="flex shrink-0 items-center gap-0.5">
    <UiIconButton size="2xs" on={enabled} aria-pressed={enabled} tooltip={`${enabled ? '关闭' : '启用'}${label}关键帧`} aria-label={`${enabled ? '关闭' : '启用'}${label}关键帧`} disabled={!enabled && !inside} onClick={() => enabled ? onDisable() : add()}><Timer  /></UiIconButton>
    {enabled && <>
      <UiIconButton size="2xs" tooltip={`上一个${label}关键帧`} aria-label={`上一个${label}关键帧`} disabled={!previous} onClick={() => previous && onSeek(previous.time)}><ChevronLeft  /></UiIconButton>
      <UiIconButton size="2xs" on={Boolean(current)} tooltip={`${current ? '删除' : '添加'}${label}关键帧`} aria-label={`${current ? '删除' : '添加'}${label}关键帧`} disabled={!inside} onClick={() => current ? onChange(points!.filter(point => point.time !== time)) : add()}><Diamond  fill={current ? 'currentColor' : 'none'} /></UiIconButton>
      <UiIconButton size="2xs" tooltip={`下一个${label}关键帧`} aria-label={`下一个${label}关键帧`} disabled={!next} onClick={() => next && onSeek(next.time)}><ChevronRight  /></UiIconButton>
      <PanelTrigger alignment="bottomRight" panelWidth="content" panelPadding="content" renderPanel={() => <span className="flex w-56 flex-col gap-2">
      {current && !discrete && <VideoEditKeyframeInterpolation label={label} interpolation={current.interpolation} bezier={current.bezier} onBegin={onBegin} onFinish={onFinish} onCancel={onCancel}
        onChange={changes => onChange(putVideoEditKeyframe(points, { ...current, ...changes, easeRange: undefined, easeValues: undefined }))} />}
      <svg viewBox="0 0 100 20" className="h-8 w-full text-accent-text" aria-label={`${label}迷你关键帧轨`}>
        <path d="M2 10H98" stroke="currentColor" opacity={0.4} />
        {(points ?? []).map(point => { const x = 2 + point.time / Math.max(1, duration - 1) * 96; return <path key={point.time} d={`M${x} 6l4 4-4 4-4-4Z`} fill="currentColor" onPointerDown={event => { event.stopPropagation(); onSeek(point.time) }} /> })}
        <path d={`M${2 + Math.max(0, Math.min(duration - 1, time)) / Math.max(1, duration - 1) * 96} 1v18`} stroke="currentColor" />
      </svg></span>}>{({ open, togglePanel }) => <UiIconButton size="2xs" on={open} aria-expanded={open} aria-haspopup="dialog" data-panel-trigger-button tooltip={`${label}关键帧轨与插值`} aria-label={`${label}关键帧轨与插值`} onClick={togglePanel}><GanttChart  /></UiIconButton>}</PanelTrigger>
    </>}
  </span>
}
