import { Crosshair, Eye, EyeOff, Headphones, Link2, LockKeyhole, UnlockKeyhole, Volume2, VolumeX } from 'lucide-react'
import { UiButton, UiIconButton } from '@/components/ui'
import type { TimelineTrackRow } from './timelineGeometry'
import { TIMELINE_HEADER_WIDTH } from './timelineGeometry'

interface Props {
  row: TimelineTrackRow
  /** 轨道编号（V1、A2…），按同类轨道自下而上/自上而下的顺序。 */
  code: string
  targeted: boolean
  onTarget: () => void
  onPatch: (patch: Partial<Pick<TimelineTrackRow['track'], 'locked' | 'enabled' | 'muted' | 'solo' | 'syncLocked' | 'height'>>) => void
  onResize: (event: React.PointerEvent<HTMLDivElement>) => void
  /** Channel type of the clips on an audio track (task 2.6); tracks themselves accept mono and stereo clips, as Premiere's standard tracks. */
  channelFormat?: 'mono' | 'stereo' | 'mixed'
}
const CHANNEL_LABELS = { mono: '单声道', stereo: '立体声', mixed: '混合' } as const
const ICON = 'h-3 w-3'

/**
 * 轨道头（任务 2.4，重要记录 006）：全部开关为图标按钮，开启用 `on`。视频轨先放“显示/锁定”，音频轨先放“静音/独奏/锁定”，
 * 其余（目标、同步锁定，以及视频轨的静音/独奏、音频轨的输出）保留原功能，外观一致；声道类型是名称下的次要信息。
 */
export function VideoEditTrackHeader({ row, code, targeted, onTarget, onPatch, onResize, channelFormat }: Props): React.ReactElement {
  const { track } = row
  const name = track.name
  const visibility = <UiIconButton key="enabled" size="sm" on={track.enabled} aria-label={`${name}输出`} aria-pressed={track.enabled} title={track.enabled ? (track.kind === 'video' ? '隐藏轨道' : '关闭轨道输出') : (track.kind === 'video' ? '显示轨道' : '开启轨道输出')} onClick={() => onPatch({ enabled: !track.enabled })}>{track.enabled ? <Eye className={ICON} /> : <EyeOff className={ICON} />}</UiIconButton>
  const mute = <UiIconButton key="muted" size="sm" on={track.muted} aria-label={`${name}静音`} aria-pressed={track.muted} title={track.muted ? '取消静音' : '静音'} onClick={() => onPatch({ muted: !track.muted })}>{track.muted ? <VolumeX className={ICON} /> : <Volume2 className={ICON} />}</UiIconButton>
  const solo = <UiIconButton key="solo" size="sm" on={track.solo} aria-label={`${name}独奏`} aria-pressed={track.solo} title={track.kind === 'video' ? (track.solo ? '取消独奏' : '独奏：只显示独奏的画面轨道') : (track.solo ? '取消独奏' : '独奏')} onClick={() => onPatch({ solo: !track.solo })}><Headphones className={ICON} /></UiIconButton>
  const lock = <UiIconButton key="locked" size="sm" on={track.locked} aria-label={`${name}锁定`} aria-pressed={track.locked} title={track.locked ? '解锁轨道' : '锁定轨道'} onClick={() => onPatch({ locked: !track.locked })}>{track.locked ? <LockKeyhole className={ICON} /> : <UnlockKeyhole className={ICON} />}</UiIconButton>
  const primary = track.kind === 'video' ? [visibility, lock, mute, solo] : [mute, solo, lock, visibility]
  return <div className={`sticky left-0 z-sticky flex h-full items-center gap-px border-r border-gap pl-1 pr-1.5 ${targeted ? 'bg-raised' : 'bg-panel'}`} style={{ width: TIMELINE_HEADER_WIDTH }} data-video-edit-track-header={track.id}>
    <UiButton size="sm" className="min-w-0 flex-1 !justify-start !gap-1.5 !px-1" aria-label={`目标轨道 ${name}`} aria-pressed={targeted} onClick={onTarget} title={channelFormat ? `${name}：${channelFormat === 'mixed' ? '既有单声道也有立体声片段' : `${CHANNEL_LABELS[channelFormat]}片段`}` : name}>
      <span className="w-5 shrink-0 text-left font-mono text-2xs font-semibold" data-video-edit-track-code>{code}</span>
      {/* 声道类型在名称下方，名称保留整行宽度。 */}
      <span className="flex min-w-0 flex-col items-start leading-none">
        <span className="max-w-full truncate text-2xs">{name}</span>
        {channelFormat && <span className="mt-0.5 max-w-full truncate text-2xs text-text3" data-video-edit-track-channels={channelFormat}>{CHANNEL_LABELS[channelFormat]}</span>}
      </span>
    </UiButton>
    <UiIconButton size="sm" on={targeted} aria-label={`${name}设为目标`} aria-pressed={targeted} title={targeted ? '取消目标轨道' : '设为目标轨道'} onClick={onTarget}><Crosshair className={ICON} /></UiIconButton>
    <UiIconButton size="sm" on={track.syncLocked !== false} aria-label={`${name}同步锁定`} aria-pressed={track.syncLocked !== false} title={track.syncLocked !== false ? '同步锁定：波纹编辑时随之移动' : '波纹编辑时不随之移动'} onClick={() => onPatch({ syncLocked: track.syncLocked === false })}><Link2 className={ICON} /></UiIconButton>
    {primary}
    <div role="separator" tabIndex={0} aria-label={`调整${name}高度`} aria-orientation="horizontal" aria-valuemin={24} aria-valuemax={160} aria-valuenow={row.height} className="absolute bottom-0 left-0 right-0 h-1 cursor-row-resize focus-visible:bg-accent" onPointerDown={onResize}
      onKeyDown={event => { if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); event.stopPropagation(); onPatch({ height: Math.max(24, Math.min(160, row.height + (event.key === 'ArrowUp' ? -4 : 4))) }) } }} />
  </div>
}
