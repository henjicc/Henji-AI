import { useEffect, useState } from 'react'
import { UiEmpty } from '@/components/ui'
import { videoEditComposition, type VideoEditDocument } from '@/core/videoEdit/document'
import { trialVideoEditCodeFrames } from '../application/videoEditCodeTrial'

// Visible rows request frames sequentially; cancelled rows skip work before entering the renderer.
let tail: Promise<unknown> = Promise.resolve()
export function VideoEditAnnotationThumbnail({ document, sequenceId, frame }: { document: VideoEditDocument; sequenceId: string; frame: number }): React.ReactElement {
  const [src, setSrc] = useState<string>()
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    const controller = new AbortController(); let url: string | undefined
    setSrc(undefined); setFailed(false)
    const render = async (): Promise<void> => {
      controller.signal.throwIfAborted()
      const composition = videoEditComposition(document, sequenceId)
      const bitmap = await trialVideoEditCodeFrames([{ document: composition, frame }], controller.signal, true)
      if (!bitmap) throw new Error('没有缩略帧。')
      try {
        const canvas = new OffscreenCanvas(160, Math.max(1, Math.round(bitmap.height * 160 / bitmap.width)))
        const context = canvas.getContext('2d'); if (!context) throw new Error('无法生成缩略帧。')
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
        const blob = await canvas.convertToBlob({ type: 'image/png' }); controller.signal.throwIfAborted()
        url = URL.createObjectURL(blob); setSrc(url)
      } finally { bitmap.close() }
    }
    tail = tail.catch(() => undefined).then(render).catch(() => { if (!controller.signal.aborted) setFailed(true) })
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url) }
  }, [document, sequenceId, frame])
  return <div className="flex h-14 w-20 shrink-0 items-center justify-center overflow-hidden rounded-control bg-media">
    {src ? <img src={src} alt="标注画面" className="h-full w-full object-contain" /> : <UiEmpty size="xs" title={failed ? '暂无画面' : '取帧中'} />}
  </div>
}
