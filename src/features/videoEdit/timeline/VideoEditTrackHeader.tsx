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
  /** Channel type of the clips on an audio track (task 2.6); tracks themselves accept mono and stereo clips, as Premiere's standard tracks. */
  channelFormat?: 'mono' | 'stereo' | 'mixed'
}
const CHANNEL_LABELS = { mono: '单声道', stereo: '立体声', mixed: '混合' } as const
export function VideoEditTrackHeader({ row, targeted, onTarget, onPatch, onResize, channelFormat }: Props): React.ReactElement {
  const { track } = row
  const icon = 'h-3 w-3'
  return <div className="sticky left-0 z-sticky flex h-full items-center gap-0.5 border-r border-border-dark bg-panel px-1" style={{ width: TIMELINE_HEADER_WIDTH }} data-video-edit-track-header={track.id}>
    {/* The channel type sits under the name so the name keeps the header's full width. */}
    <UiButton className="min-w-0 flex-1 !px-1 !py-0" aria-label={`目标轨道 ${track.name}`} aria-pressed={targeted} onClick={onTarget} title={channelFormat ? `${track.name}：${channelFormat === 'mixed' ? '既有单声道也有立体声片段' : `${CHANNEL_LABELS[channelFormat]}片段`}` : track.name}>
      <span className="flex min-w-0 flex-col items-center leading-none"><span className="max-w-full truncate">{track.name}</span>{channelFormat && <span className="mt-0.5 max-w-full truncate text-4xs text-text-muted" data-video-edit-track-channels={channelFormat}>{CHANNEL_LABELS[channelFormat]}</span>}</span>
    </UiButton>
    <UiIconButton size="xs" on={targeted} aria-label={`${track.name}设为目标`} aria-pressed={targeted} title="目标轨道" onClick={onTarget}><Crosshair className={icon} /></UiIconButton>
    <UiIconButton size="xs" on={track.locked} aria-label={`${track.name}锁定`} aria-pressed={track.locked} title={track.locked ? '解锁轨道' : '锁定轨道'} onClick={() => onPatch({ locked: !track.locked })}>{track.locked ? <LockKeyhole className={icon} /> : <UnlockKeyhole className={icon} />}</UiIconButton>
    <UiIconButton size="xs" on={!track.enabled} aria-label={`${track.name}输出`} aria-pressed={track.enabled} title={track.enabled ? '关闭轨道输出' : '开启轨道输出'} onClick={() => onPatch({ enabled: !track.enabled })}>{track.enabled ? <Eye className={icon} /> : <EyeOff className={icon} />}</UiIconButton>
    <UiIconButton size="xs" on={track.muted} aria-label={`${track.name}静音`} aria-pressed={track.muted} title="静音" onClick={() => onPatch({ muted: !track.muted })}>{track.muted ? <VolumeX className={icon} /> : <Volume2 className={icon} />}</UiIconButton>
    <UiIconButton size="xs" on={track.solo} aria-label={`${track.name}独奏`} aria-pressed={track.solo} title="独奏" onClick={() => onPatch({ solo: !track.solo })}>S</UiIconButton>
    <UiIconButton size="xs" on={track.syncLocked !== false} aria-label={`${track.name}同步锁定`} aria-pressed={track.syncLocked !== false} title="波纹编辑时同步移动" onClick={() => onPatch({ syncLocked: track.syncLocked === false })}><Link2 className={icon} /></UiIconButton>
    <div role="separator" tabIndex={0} aria-label={`调整${track.name}高度`} aria-orientation="horizontal" aria-valuemin={24} aria-valuemax={160} aria-valuenow={row.height} className="absolute bottom-0 left-0 right-0 h-1 cursor-row-resize focus-visible:bg-accent" onPointerDown={onResize}
      onKeyDown={event => { if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); event.stopPropagation(); onPatch({ height: Math.max(24, Math.min(160, row.height + (event.key === 'ArrowUp' ? -4 : 4))) }) } }} />
  </div>
}
