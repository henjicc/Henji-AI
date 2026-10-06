import { useSyncExternalStore } from 'react'
import { CircleAlert, RotateCcw, Shuffle, X } from 'lucide-react'
import { UiIconButton } from '@/components/ui'
import Tooltip from '@/components/ui/Tooltip'
import { ICON_NODE_AUDIO_GENERATION, ICON_NODE_VIDEO_GENERATION } from '@/core/theme/icons'
import type { VideoEditSequence } from '@/core/videoEdit/document'
import { useGenerationTaskProgressStore } from '@/stores/generationTaskProgressStore'
import {
  cancelVideoEditInPlaceJob, dismissVideoEditInPlaceJob, listVideoEditInPlaceJobs, retryVideoEditInPlaceJob, subscribeVideoEditInPlaceJobs, videoEditInPlaceActionLabel, type VideoEditInPlaceJob,
} from '../application/videoEditInPlaceGeneration'
import { TIMELINE_HEADER_WIDTH, type TimelineRegion } from './timelineGeometry'

interface Row { track: { index: number; kind: 'video' | 'audio' }; top: number; height: number }
interface Props { projectId: string; sequence: VideoEditSequence; rows: readonly Row[]; region: TimelineRegion; pixels: number; onReopen: (job: VideoEditInPlaceJob) => void; onError: (error: unknown) => void }

const VISIBLE: ReadonlySet<VideoEditInPlaceJob['status']> = new Set(['preparing', 'generating', 'placing', 'failed'])
const STATUS_TEXT = { preparing: '正在准备…', generating: '生成中', placing: '正在放入…' } as const
/** 占位宽度够放按钮与文字时才显示它们（像素）。 */
const SHOW_TEXT_WIDTH = 96
const SHOW_BUTTONS_WIDTH = 48

/** 占位当前该画在哪里：替换盖在原片段上，延长接在原片段现在的尾巴上（生成期间片段被移动就跟着走）。 */
function placement(job: VideoEditInPlaceJob, sequence: VideoEditSequence): { track: number | null; start: number; duration: number } {
  const clip = job.plan.clipId ? sequence.clips.find(value => value.id === job.plan.clipId) : undefined
  if (clip && job.plan.placement === 'replace') return { track: clip.track, start: clip.start, duration: clip.duration }
  if (clip && job.plan.action === 'extend_shot') return { track: clip.track, start: clip.start + clip.duration, duration: job.plan.duration }
  return { track: job.plan.trackIndex, start: job.plan.frame, duration: job.plan.duration }
}

function Progress({ taskId }: { taskId?: string }): React.ReactElement | null {
  const progress = useGenerationTaskProgressStore(state => taskId ? state.progress[taskId] : undefined)
  return typeof progress === 'number' && progress > 0 ? <span className="shrink-0 tabular-nums">{Math.round(progress)}%</span> : null
}

/**
 * 原地生成的占位片段（4.12）：生成中显示进度、可取消；失败时显示原因，可重试、换模型或移除。
 * 不在剪辑文件里，只是时间线上的一层；结果落位时由正式片段取代。新建轨道的占位先画在同类最外侧的轨道上。
 */
export function VideoEditInPlacePlaceholders({ projectId, sequence, rows, region, pixels, onReopen, onError }: Props): React.ReactElement | null {
  useSyncExternalStore(subscribeVideoEditInPlaceJobs, listVideoEditInPlaceJobs)
  const jobs = listVideoEditInPlaceJobs().filter(job => job.projectId === projectId && job.plan.sequenceId === sequence.id && VISIBLE.has(job.status))
  if (!jobs.length) return null
  const run = (action: () => Promise<unknown> | void): void => { try { void Promise.resolve(action()).catch(onError) } catch (error) { onError(error) } }
  return <>{jobs.map(job => {
    const at = placement(job, sequence)
    const kind = job.plan.mediaType === 'audio' ? 'audio' : 'video'
    const outer = [...rows].filter(row => row.track.kind === kind).sort((a, b) => kind === 'video' ? b.track.index - a.track.index : a.track.index - b.track.index)[0]
    const row = rows.find(value => value.track.index === at.track) ?? (at.track === null ? outer : undefined)
    if (!row) return null
    const width = Math.max(6, at.duration * pixels)
    const failed = job.status === 'failed'
    const Icon = kind === 'audio' ? ICON_NODE_AUDIO_GENERATION : ICON_NODE_VIDEO_GENERATION
    const label = videoEditInPlaceActionLabel(job.plan.action)
    return <div key={job.id} role="status" aria-label={failed ? `${label}未完成：${job.error ?? ''}` : `${label}：${STATUS_TEXT[job.status as keyof typeof STATUS_TEXT] ?? ''}`}
      data-video-edit-in-place-job={job.id} data-status={job.status} data-video-edit-timeline-chrome
      onContextMenu={event => { event.preventDefault(); event.stopPropagation() }}
      className={`absolute z-raised flex items-center gap-1 overflow-hidden rounded-md border-2 border-dashed px-1 text-2xs leading-4 text-text1 ${failed ? 'border-danger-text bg-danger-tint' : 'border-accent-ring bg-accent-tint'}`}
      style={{ top: row.top - region.top + 2, height: row.height - 4, left: TIMELINE_HEADER_WIDTH + at.start * pixels, width }}>
      {failed ? <CircleAlert size={12} aria-hidden="true" className="shrink-0 text-danger-text" /> : <Icon size={12} aria-hidden="true" className={`shrink-0 text-accent-text ${job.status === 'placing' ? '' : 'animate-pulse'}`} />}
      {width > SHOW_TEXT_WIDTH && <Tooltip content={failed ? job.error ?? '' : job.request.prompt}><span className="min-w-0 flex-1 truncate">{failed ? job.error : `${label} · ${STATUS_TEXT[job.status as keyof typeof STATUS_TEXT]}`}</span></Tooltip>}
      {!failed && width > SHOW_TEXT_WIDTH && <Progress taskId={job.taskId} />}
      {width > SHOW_BUTTONS_WIDTH && <span className="ml-auto flex shrink-0 items-center">
        {failed && <UiIconButton size="xs" aria-label="重试" title="重试" onClick={() => run(() => retryVideoEditInPlaceJob(job.id))}><RotateCcw size={12} /></UiIconButton>}
        {failed && <UiIconButton size="xs" aria-label="换模型重新生成" title="换模型重新生成" onClick={() => onReopen(job)}><Shuffle size={12} /></UiIconButton>}
        <UiIconButton size="xs" aria-label={failed ? '移除占位' : '取消生成'} title={failed ? '移除占位' : '取消生成'} onClick={() => run(() => failed ? dismissVideoEditInPlaceJob(job.id) : cancelVideoEditInPlaceJob(job.id))}><X size={12} /></UiIconButton>
      </span>}
    </div>
  })}</>
}
