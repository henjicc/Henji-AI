import { MessageSquare } from 'lucide-react'
import { UiIconButton } from '@/components/ui'
import type { VideoEditSequence } from '@/core/videoEdit/document'
import { jumpToVideoEditAnnotation } from '../application/videoEditAnnotations'
import type { VideoEditInstance } from '../application/videoEditService'

/** 标尺上面一行的批注图标，以所在帧为中心；第 0 帧附近的不让左上角格挡住半个。 */
export function VideoEditAnnotationMarks({ instance, sequence, pixels, left, width, onError }: { instance: VideoEditInstance; sequence: VideoEditSequence; pixels: number; left: number; width: number; onError: (error: unknown) => void }): React.ReactElement {
  return <>{sequence.annotations.flatMap((mark, index) => mark.status === 'resolved' || mark.frame * pixels < left || mark.frame * pixels > left + width ? [] : [<div key={mark.id} className="absolute top-0.5 -translate-x-1/2" style={{ left: Math.max(10, mark.frame * pixels) }}>
    <UiIconButton data-ui-timeline-item size="2xs" tooltip={`标注 ${index + 1} · ${mark.text}`} aria-label={`跳到标注 ${index + 1}`} tone={mark.status === 'open' ? 'accent' : 'default'} onPointerDown={event => event.stopPropagation()} onClick={() => { try { jumpToVideoEditAnnotation(instance.document.id, mark.id) } catch (error) { onError(error) } }}><MessageSquare  /></UiIconButton>
  </div>])}</>
}
