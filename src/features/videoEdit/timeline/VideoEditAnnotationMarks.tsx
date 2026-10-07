import { MessageSquare } from 'lucide-react'
import { UiIconButton } from '@/components/ui'
import type { VideoEditSequence } from '@/core/videoEdit/document'
import { jumpToVideoEditAnnotation } from '../application/videoEditAnnotations'
import type { VideoEditInstance } from '../application/videoEditService'

export function VideoEditAnnotationMarks({ instance, sequence, pixels, left, width, onError }: { instance: VideoEditInstance; sequence: VideoEditSequence; pixels: number; left: number; width: number; onError: (error: unknown) => void }): React.ReactElement {
  return <>{sequence.annotations.flatMap((mark, index) => mark.status === 'resolved' || mark.frame * pixels < left || mark.frame * pixels > left + width ? [] : [<div key={mark.id} className="absolute top-0" style={{ left: mark.frame * pixels }}>
    <UiIconButton size="sm" title={`标注 ${index + 1} · ${mark.text}`} aria-label={`跳到标注 ${index + 1}`} tone={mark.status === 'open' ? 'accent' : 'default'} onPointerDown={event => event.stopPropagation()} onClick={() => { try { jumpToVideoEditAnnotation(instance.document.id, mark.id) } catch (error) { onError(error) } }}><MessageSquare size={12} /></UiIconButton>
  </div>])}</>
}
