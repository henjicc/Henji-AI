import { useEffect, useState } from 'react'
import { UiIconButton } from '@/components/ui'
import { UI_FLOATING_EDGE_CLASS } from '@/components/ui/styleTokens'
import type { VideoEditSequence } from '@/core/videoEdit/document'
import { hoveredVideoEditAnnotation, jumpToVideoEditAnnotation, setHoveredVideoEditAnnotation } from '../application/videoEditAnnotations'
import type { VideoEditInstance } from '../application/videoEditService'
import { VideoEditAnnotationBadge } from '../VideoEditAnnotationBadge'
import { videoEditAnnotationFillClass } from '../videoEditAnnotationPalette'

/** 序号徽标的宽度加间隔（像素）：两个徽标中心离得比这近就会叠在一起，合成一个计数。 */
const BADGE_PITCH = 18

type Entry = { id: string; number: number; text: string; x: number }

/**
 * 标尺上面一行的批注：同色序号徽标以所在帧为中心，与列表、画面标签上的序号一一对应；时间段批注在这一行底部画一条同色细条。
 * 缩小时间线后挨得太近的几条合成一个计数徽标，指针停上去就在原处展开成一排序号，可逐个跳转。第 0 帧附近的不让左上角格挡住半个。
 */
export function VideoEditAnnotationMarks({ instance, sequence, pixels, left, width, onError }: { instance: VideoEditInstance; sequence: VideoEditSequence; pixels: number; left: number; width: number; onError: (error: unknown) => void }): React.ReactElement {
  const [open, setOpen] = useState<string | null>(null)
  const projectId = instance.document.id
  const marks = sequence.annotations.map((mark, index) => ({ mark, number: index + 1 })).filter(({ mark }) => mark.status !== 'resolved')
  const entries: Entry[] = marks.filter(({ mark }) => mark.frame * pixels >= left - BADGE_PITCH && mark.frame * pixels <= left + width + BADGE_PITCH)
    .map(({ mark, number }) => ({ id: mark.id, number, text: mark.text, x: Math.max(10, mark.frame * pixels) })).sort((a, b) => a.x - b.x)
  const clusters: Entry[][] = []
  for (const entry of entries) {
    const last = clusters.at(-1)
    if (last && entry.x - last.at(-1)!.x < BADGE_PITCH) last.push(entry); else clusters.push([entry])
  }
  // 指针停在徽标上时徽标被收起或滚出去收不到离开事件：这一排里已经没有被悬停的那条，就把悬停清掉
  const shownIds = entries.map(entry => entry.id).join(' ')
  useEffect(() => {
    const hovered = hoveredVideoEditAnnotation(projectId)
    if (hovered && sequence.annotations.some(mark => mark.id === hovered) && !shownIds.split(' ').includes(hovered)) setHoveredVideoEditAnnotation(projectId, null)
  }, [projectId, sequence, shownIds])
  const jump = (id: string): void => { try { jumpToVideoEditAnnotation(projectId, id) } catch (error) { onError(error) } }
  const badge = (entry: Entry) => <UiIconButton key={entry.id} data-ui-timeline-item size="2xs" tone="bare" tooltip={`标注 ${entry.number} · ${entry.text}`} aria-label={`跳到标注 ${entry.number}`}
    onPointerDown={event => event.stopPropagation()} onPointerEnter={() => setHoveredVideoEditAnnotation(projectId, entry.id)} onPointerLeave={() => setHoveredVideoEditAnnotation(projectId, null)} onClick={() => jump(entry.id)}>
    <VideoEditAnnotationBadge number={entry.number} size="sm" />
  </UiIconButton>
  return <>
    {marks.filter(({ mark }) => mark.endFrame !== undefined && mark.endFrame > mark.frame && mark.endFrame * pixels >= left && mark.frame * pixels <= left + width).map(({ mark, number }) =>
      <div key={`range-${mark.id}`} aria-hidden="true" className={`pointer-events-none absolute bottom-0 h-0.5 rounded-full opacity-60 ${videoEditAnnotationFillClass(number)}`} style={{ left: mark.frame * pixels, width: Math.max(2, (mark.endFrame! - mark.frame) * pixels) }} />)}
    {clusters.map(cluster => {
      const key = cluster[0].id
      const center = cluster.reduce((sum, entry) => sum + entry.x, 0) / cluster.length
      if (cluster.length === 1) return <div key={cluster[0].id} className="absolute top-0 -translate-x-1/2" style={{ left: center }}>{badge(cluster[0])}</div>
      return <div key={cluster[0].id} className="absolute top-0 z-raised -translate-x-1/2" style={{ left: center }} onPointerEnter={() => setOpen(key)} onPointerLeave={() => setOpen(current => current === key ? null : current)}>
        {open === key
          ? <div className={`flex items-center gap-0.5 rounded-full bg-overlay px-0.5 ${UI_FLOATING_EDGE_CLASS}`}>{cluster.map(badge)}</div>
          : <UiIconButton data-ui-timeline-item size="2xs" tone="bare" tooltip={cluster.map(entry => `标注 ${entry.number} · ${entry.text}`).join('\n')} aria-label={`这里有 ${cluster.length} 条批注`} onPointerDown={event => event.stopPropagation()} onClick={() => setOpen(key)}>
            <span aria-hidden="true" className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-selected px-1 text-3xs font-semibold leading-none tabular-nums text-text1">{cluster.length}</span>
          </UiIconButton>}
      </div>
    })}
  </>
}
