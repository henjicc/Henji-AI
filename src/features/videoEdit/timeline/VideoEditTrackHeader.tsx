import { useRef, useState } from 'react'
import { Crosshair, Eye, EyeOff, Headphones, Link2, LockKeyhole, UnlockKeyhole, Volume2, VolumeX, type LucideIcon } from 'lucide-react'
import { UiButton, UiIconButton, UiInput } from '@/components/ui'
import { videoEditTrackHeaderButtons, type VideoEditTrackHeaderButtonId } from '@/core/videoEdit/trackHeaderButtons'
import { useSettingsStore } from '@/stores/settingsStore'
import type { VideoEditBarButtonSpec } from '../panels/VideoEditButtonBarEditor'
import type { TimelineTrackRow } from './timelineGeometry'
import { TIMELINE_HEADER_WIDTH } from './timelineGeometry'

type Track = TimelineTrackRow['track']
type TrackPatch = Partial<Pick<Track, 'locked' | 'enabled' | 'muted' | 'solo' | 'syncLocked' | 'height'>>
interface Props {
  row: TimelineTrackRow
  /** 轨道编号（V1、A2…），按同类轨道自下而上/自上而下的顺序。 */
  code: string
  targeted: boolean
  onTarget: () => void
  onPatch: (patch: TrackPatch) => void
  onResize: (event: React.PointerEvent<HTMLElement>) => void
  /** 右键菜单（PR 轨道头菜单：重命名、添加／删除轨道、自定义…）。 */
  onContextMenu?: (event: React.MouseEvent<HTMLElement>) => void
  /** 正在重命名：名称换成输入框，回车或失焦确定、Escape 取消（`null`）。 */
  renaming?: boolean
  onRename?: (name: string | null) => void
  /** 双击名称开始重命名。 */
  onStartRename?: () => void
  /** Channel type of the clips on an audio track (task 2.6); tracks themselves accept mono and stereo clips, as Premiere's standard tracks. */
  channelFormat?: 'mono' | 'stereo' | 'mixed'
}
const CHANNEL_LABELS = { mono: '单声道', stereo: '立体声', mixed: '混合' } as const
/** 轨道头按钮的无障碍短名（拼在轨道名后，如“视频 1锁定”）。 */
const SHORT_LABELS: Record<VideoEditTrackHeaderButtonId, string> = { locked: '锁定', sync: '同步锁定', enabled: '输出', muted: '静音', solo: '独奏', target: '设为目标' }
const ICON = 'h-3 w-3'

/**
 * 轨道头每个可选按钮的名称、图标与当前状态（按钮编辑器网格与轨道头共用）。点轨道编号与名称就是设为目标（PR 轨道定位），
 * “目标”按钮只是同一动作的另一个入口。
 */
// eslint-disable-next-line react-refresh/only-export-components -- 轨道头与按钮编辑器共用同一份按钮定义
export function videoEditTrackHeaderButtonSpecs(track: Track, targeted: boolean, onPatch: (patch: TrackPatch) => void, onTarget: () => void): VideoEditBarButtonSpec<VideoEditTrackHeaderButtonId>[] {
  const video = track.kind === 'video'
  const spec = (id: VideoEditTrackHeaderButtonId, title: string, tooltip: string, Icon: LucideIcon, on: boolean, onClick: () => void): VideoEditBarButtonSpec<VideoEditTrackHeaderButtonId> => ({ id, title, tooltip, Icon, on, onClick })
  return [
    spec('locked', '锁定轨道', track.locked ? '解锁轨道' : '锁定轨道', track.locked ? LockKeyhole : UnlockKeyhole, track.locked, () => onPatch({ locked: !track.locked })),
    spec('sync', '同步锁定', track.syncLocked !== false ? '同步锁定：波纹编辑时随之移动' : '波纹编辑时不随之移动', Link2, track.syncLocked !== false, () => onPatch({ syncLocked: track.syncLocked === false })),
    spec('enabled', video ? '切换轨道输出' : '轨道输出', track.enabled ? (video ? '隐藏轨道' : '关闭轨道输出') : (video ? '显示轨道' : '开启轨道输出'), track.enabled ? Eye : EyeOff, track.enabled, () => onPatch({ enabled: !track.enabled })),
    spec('muted', '静音', track.muted ? '取消静音' : '静音', track.muted ? VolumeX : Volume2, track.muted, () => onPatch({ muted: !track.muted })),
    spec('solo', '独奏', video ? (track.solo ? '取消独奏' : '独奏：只显示独奏的画面轨道') : (track.solo ? '取消独奏' : '独奏'), Headphones, track.solo, () => onPatch({ solo: !track.solo })),
    spec('target', '设为目标', targeted ? '取消目标轨道' : '设为目标轨道', Crosshair, targeted, onTarget),
  ]
}

/**
 * 轨道头（PR）：编号与名称（点击设为目标）+ 按钮编辑器里选的开关按钮。默认按 PR 只放几个——视频轨：锁定、同步锁定、
 * 切换轨道输出；音频轨：锁定、静音、独奏。右键是 PR 的轨道头菜单。声道类型是名称下的次要信息。
 */
export function VideoEditTrackHeader({ row, code, targeted, onTarget, onPatch, onResize, onContextMenu, renaming = false, onRename, onStartRename, channelFormat }: Props): React.ReactElement {
  const { track } = row
  const name = track.name
  const ids = videoEditTrackHeaderButtons(useSettingsStore(state => state.videoEditTrackHeaderButtons), track.kind)
  const specs = new Map(videoEditTrackHeaderButtonSpecs(track, targeted, onPatch, onTarget).map(spec => [spec.id, spec]))
  return <div className={`sticky left-0 z-sticky flex h-full items-center gap-px border-r border-gap pl-1 pr-1.5 ${targeted ? 'bg-raised' : 'bg-panel'}`} style={{ width: TIMELINE_HEADER_WIDTH }} data-video-edit-track-header={track.id} onContextMenu={onContextMenu}>
    {renaming ? <TrackNameInput code={code} name={name} onDone={value => onRename?.(value)} />
      : <UiButton size="sm" className="min-w-0 flex-1 !justify-start !gap-1.5 !px-1" aria-label={`目标轨道 ${name}`} aria-pressed={targeted} onClick={onTarget} onDoubleClick={onStartRename} title={channelFormat ? `${name}：${channelFormat === 'mixed' ? '既有单声道也有立体声片段' : `${CHANNEL_LABELS[channelFormat]}片段`}` : name}>
        <span className="w-5 shrink-0 text-left font-mono text-2xs font-semibold" data-video-edit-track-code>{code}</span>
        {/* 声道类型在名称下方，名称保留整行宽度。 */}
        <span className="flex min-w-0 flex-col items-start leading-none">
          <span className="max-w-full truncate text-2xs">{name}</span>
          {channelFormat && <span className="mt-0.5 max-w-full truncate text-2xs text-text3" data-video-edit-track-channels={channelFormat}>{CHANNEL_LABELS[channelFormat]}</span>}
        </span>
      </UiButton>}
    {ids.map(id => { const spec = specs.get(id)!; return <UiIconButton key={id} size="sm" on={spec.on} aria-label={`${name}${SHORT_LABELS[id]}`} aria-pressed={spec.on} title={spec.tooltip} onClick={spec.onClick}><spec.Icon className={ICON} /></UiIconButton> })}
    <div role="separator" tabIndex={0} aria-label={`调整${name}高度`} aria-orientation="horizontal" aria-valuemin={24} aria-valuemax={160} aria-valuenow={row.height} className="absolute bottom-0 left-0 right-0 h-1 cursor-row-resize focus-visible:bg-accent" onPointerDown={onResize}
      onKeyDown={event => { if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); event.stopPropagation(); onPatch({ height: Math.max(24, Math.min(160, row.height + (event.key === 'ArrowUp' ? -4 : 4))) }) } }} />
  </div>
}

function TrackNameInput({ code, name, onDone }: { code: string; name: string; onDone: (name: string | null) => void }): React.ReactElement {
  const [value, setValue] = useState(name)
  const done = useRef(false)
  const finish = (next: string | null): void => { if (done.current) return; done.current = true; onDone(next) }
  return <div className="flex min-w-0 flex-1 items-center gap-1.5 px-1">
    <span className="w-5 shrink-0 font-mono text-2xs font-semibold">{code}</span>
    <UiInput size="sm" autoFocus aria-label="轨道名称" value={value} maxLength={80} onChange={event => setValue(event.target.value)} onFocus={event => event.currentTarget.select()}
      onBlur={() => finish(value.trim() || null)} onKeyDown={event => { event.stopPropagation(); if (event.key === 'Enter') { event.preventDefault(); finish(value.trim() || null) } else if (event.key === 'Escape') { event.preventDefault(); finish(null) } }} />
  </div>
}
