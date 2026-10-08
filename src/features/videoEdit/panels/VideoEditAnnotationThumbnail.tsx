import { useEffect, useRef, useState } from 'react'
import { UiEmpty, UiButton } from '@/components/ui'
import type { VideoEditDocument } from '@/core/videoEdit/document'
import { renderVideoEditAnnotationPreview, videoEditAnnotationPreviewInput } from '../application/videoEditAnnotationPreview'

export function VideoEditAnnotationThumbnail({ document, sequenceId, frame, onJump, label = '标注画面' }: { document: VideoEditDocument; sequenceId: string; frame: number; onJump?: () => void; label?: string }): React.ReactElement {
  const [src, setSrc] = useState<string>()
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const input = videoEditAnnotationPreviewInput(document, sequenceId)
  const snapshot = useRef(input); snapshot.current = input
  const key = input.key
  useEffect(() => {
    const controller = new AbortController(); let url: string | undefined
    setSrc(undefined); setError('')
    const render = async (): Promise<void> => {
      const blob = await renderVideoEditAnnotationPreview(snapshot.current.composition, frame, controller.signal)
      controller.signal.throwIfAborted()
      url = URL.createObjectURL(blob); setSrc(url)
    }
    void render().catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '取帧失败，请重试。') })
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url) }
  }, [key, frame, retry])
  return <UiButton aria-label={error ? '重新获取标注画面' : label} title={error || undefined} onClick={() => { if (error) setRetry(value => value + 1); else onJump?.() }}>
    <div className="flex h-14 w-20 shrink-0 items-center justify-center overflow-hidden rounded-control bg-media">
      {src ? <img src={src} alt="标注画面" className="h-full w-full object-contain" /> : <UiEmpty size="xs" title={error ? '取帧失败，点此重试' : '取帧中'} />}
    </div>
  </UiButton>
}
