import { Crosshair, Eye, EyeOff, Link2, LockKeyhole, UnlockKeyhole, Volume2, VolumeX } from 'lucide-react'
import { UiButton, UiIconButton } from '@/components/ui'
import type { TimelineTrackRow } from './timelineGeometry'
import { TIMELINE_HEADER_WIDTH } from './timelineGeometry'

interface Props {
  row: TimelineTrackRow
  targeted: boolean
  onTarget: () => void
  onPatch: (patch: Partial<Pick<TimelineTrackRow['track'], 'locked' | 'enabled' | 'muted' | 'solo' | 'syncLocked' | 'height'>>) => void
  onResize: (event: React.PointerEvent<HTMLDivElement>) => void
}
export function VideoEditTrackHeader({ row, targeted, onTarget, onPatch, onResize }: Props): React.ReactElement {
  const { track } = row
  const icon = 'h-3 w-3'
  const button = '!h-5 !w-5 shrink-0 !rounded-lg !p-0'
  return <div className="sticky left-0 z-sticky flex h-full items-center gap-0.5 border-r border-border-dark bg-panel px-1" style={{ width: TIMELINE_HEADER_WIDTH }} data-video-edit-track-header={track.id}>
    <UiButton variant="plain" className="min-w-0 flex-1 truncate !px-1 !py-0 text-2xs" aria-label={`目标轨道 ${track.name}`} aria-pressed={targeted} onClick={onTarget} title={track.name}>{track.name}</UiButton>
    <UiIconButton appearance="hover-only" active={targeted} className={button} aria-label={`${track.name}设为目标`} aria-pressed={targeted} title="目标轨道" onClick={onTarget}><Crosshair className={icon} /></UiIconButton>
    <UiIconButton appearance="hover-only" active={track.locked} className={button} aria-label={`${track.name}锁定`} aria-pressed={track.locked} title={track.locked ? '解锁轨道' : '锁定轨道'} onClick={() => onPatch({ locked: !track.locked })}>{track.locked ? <LockKeyhole className={icon} /> : <UnlockKeyhole className={icon} />}</UiIconButton>
    <UiIconButton appearance="hover-only" active={!track.enabled} className={button} aria-label={`${track.name}输出`} aria-pressed={track.enabled} title={track.enabled ? '关闭轨道输出' : '开启轨道输出'} onClick={() => onPatch({ enabled: !track.enabled })}>{track.enabled ? <Eye className={icon} /> : <EyeOff className={icon} />}</UiIconButton>
    <UiIconButton appearance="hover-only" active={track.muted} className={button} aria-label={`${track.name}静音`} aria-pressed={track.muted} title="静音" onClick={() => onPatch({ muted: !track.muted })}>{track.muted ? <VolumeX className={icon} /> : <Volume2 className={icon} />}</UiIconButton>
    <UiButton variant="plain" className={button} aria-label={`${track.name}独奏`} aria-pressed={track.solo} title="独奏" onClick={() => onPatch({ solo: !track.solo })}>S</UiButton>
    <UiIconButton appearance="hover-only" active={track.syncLocked !== false} className={button} aria-label={`${track.name}同步锁定`} aria-pressed={track.syncLocked !== false} title="波纹编辑时同步移动" onClick={() => onPatch({ syncLocked: track.syncLocked === false })}><Link2 className={icon} /></UiIconButton>
    <div role="separator" tabIndex={0} aria-label={`调整${track.name}高度`} aria-orientation="horizontal" aria-valuemin={24} aria-valuemax={160} aria-valuenow={row.height} className="absolute bottom-0 left-0 right-0 h-1 cursor-row-resize focus-visible:bg-accent" onPointerDown={onResize}
      onKeyDown={event => { if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); event.stopPropagation(); onPatch({ height: Math.max(24, Math.min(160, row.height + (event.key === 'ArrowUp' ? -4 : 4))) }) } }} />
  </div>
}
