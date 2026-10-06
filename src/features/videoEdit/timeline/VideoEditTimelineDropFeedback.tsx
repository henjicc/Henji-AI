import { useSyncExternalStore } from 'react'
import type { VideoEditClip } from '@/core/videoEdit/document'
import { ICON_VIDEO_EDIT_TRANSITION } from '@/core/theme/icons'
import { videoEditTransitionPreset, type VideoEditTransitionKind } from '@/core/videoEdit/transitions'
import { subscribeVideoEditEffectDropTarget, videoEditEffectDropTarget } from '../panels/videoEditEffectDrag'
import { TIMELINE_HEADER_WIDTH, type TimelineRegion } from './timelineGeometry'

/**
 * 时间线拖放落点反馈（PR）：拖效果经过片段时，松手会加上效果的片段描强调色框并铺一层淡强调底；
 * 拖过渡经过编辑点时，在过渡将占据的范围显示带名称的预览块。两者都不接收指针，颜色只用语义令牌。
 */
interface Row { track: { index: number }; top: number; height: number }

/** 效果落点：高亮本区里松手会加上效果的片段（落在所选片段之一上时是全部所选的画面片段）。 */
export function VideoEditEffectDropTargets({ projectId, clips, rows, region, pixels }: { projectId: string; clips: readonly VideoEditClip[]; rows: readonly Row[]; region: TimelineRegion; pixels: number }): React.ReactElement | null {
  const target = useSyncExternalStore(subscribeVideoEditEffectDropTarget, videoEditEffectDropTarget)
  if (!target || target.projectId !== projectId) return null
  return <>{clips.filter(clip => target.clipIds.includes(clip.id)).map(clip => {
    const row = rows.find(value => value.track.index === clip.track)
    return row ? <div key={clip.id} aria-hidden="true" data-video-edit-effect-drop-target={clip.id} className="pointer-events-none absolute z-raised rounded-md border-2 border-accent-ring bg-accent-tint"
      style={{ top: row.top - region.top + 2, height: row.height - 4, left: TIMELINE_HEADER_WIDTH + clip.start * pixels, width: Math.max(3, clip.duration * pixels) }} /> : null
  })}</>
}

/** 过渡落点：编辑点上将要放下的过渡范围（虚线框），宽度够时显示过渡名称。 */
export function VideoEditTransitionDropBlock({ hint, row, region, pixels }: { hint: { kind: VideoEditTransitionKind; alignment: string; start: number; duration: number }; row: Row; region: TimelineRegion; pixels: number }): React.ReactElement {
  const width = Math.max(4, hint.duration * pixels)
  const Icon = ICON_VIDEO_EDIT_TRANSITION
  return <div aria-hidden="true" data-video-edit-transition-drop={hint.alignment} className="pointer-events-none absolute z-raised flex items-center gap-1 overflow-hidden rounded-md border-2 border-dashed border-accent-ring bg-accent-tint px-1 text-text1"
    style={{ top: row.top - region.top + 2, height: row.height - 4, left: TIMELINE_HEADER_WIDTH + hint.start * pixels, width }}>
    {width > 28 && <Icon size={12} className="shrink-0 text-accent-text" />}
    {width > 56 && <span className="truncate text-2xs leading-4">{videoEditTransitionPreset(hint.kind).name}</span>}
  </div>
}
