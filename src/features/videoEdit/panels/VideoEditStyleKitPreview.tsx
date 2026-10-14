import { useEffect, useRef, useState } from 'react'
import { UiEmpty, UiError } from '@/components/ui'
import { styleColorCss, type StyleKit } from '@/core/videoEdit/styleKit'
import { STYLE_BOARD_KINDS } from '@/core/videoEdit/styleKitPresets'
import { renderStyleKitPreview } from '../application/videoEditStylePreview'

/**
 * Sample images have a fixed compact display height; rendering at the sequence size (4K) only competed with the program
 * monitor for the shared GPU. Tokens are proportional to the canvas, so a smaller canvas previews the same design.
 */
function previewSize(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(1, 960 / Math.max(1, width))
  return { width: Math.max(16, Math.round(width * scale)), height: Math.max(16, Math.round(height * scale)) }
}
/** Hover playback: the entrance sampled at a fixed frame count, played at the same rate. */
const MOTION_FRAMES = 12
const MOTION_FPS = 12
/** The board shows every style on identical components; other samples stay available through insertion. */
function boardSamples(kit: StyleKit): StyleKit['samples'] {
  const board = STYLE_BOARD_KINDS.flatMap(kind => { const sample = kit.samples.find(value => value.kind === kind); return sample ? [sample] : [] })
  return board.length ? board : kit.samples.slice(0, STYLE_BOARD_KINDS.length)
}
/** Preview uses the production compiler/compositor, not a separate imitation of author code. */
export function VideoEditStyleKitPreview({ kit, width, height, visible = true }: { kit: StyleKit; width: number; height: number; visible?: boolean }): React.ReactElement {
  const [pictures, setPictures] = useState<Array<{ id: string; name: string; url: string }>>([])
  const [motion, setMotion] = useState<{ id: string; urls: string[]; index: number } | null>(null)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const snapshot = useRef(kit); snapshot.current = kit
  const hover = useRef<AbortController>()
  const key = JSON.stringify([kit.id, kit.tokens, kit.samples])
  useEffect(() => {
    const kit = snapshot.current
    const controller = new AbortController(); const urls: string[] = []
    setPictures([]); setError(''); setMotion(null)
    if (!visible || !kit.samples.length) return () => controller.abort()
    const timer = setTimeout(() => {
      void (async () => {
        for (const sample of boardSamples(kit)) {
          try {
            const blob = await renderStyleKitPreview(kit, sample.id, previewSize(width, height), controller.signal)
            controller.signal.throwIfAborted()
            const url = URL.createObjectURL(blob); urls.push(url)
            setPictures(previous => [...previous, { id: sample.id, name: sample.name, url }])
          } catch (reason) {
            controller.signal.throwIfAborted()
            setError(reason instanceof Error ? reason.message : '风格预览失败，请重试。')
          }
        }
      })().catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '风格预览失败，请重试。') })
    }, 180)
    return () => { clearTimeout(timer); controller.abort(); hover.current?.abort(); urls.forEach(url => URL.revokeObjectURL(url)) }
  }, [key, width, height, visible, retry])
  // Frames of the hovered sample are released when hover ends or the candidate changes.
  useEffect(() => () => { motion?.urls.forEach(url => URL.revokeObjectURL(url)) }, [motion?.urls])
  const playing = motion && motion.urls.length >= MOTION_FRAMES ? motion.id : null
  useEffect(() => {
    if (!playing) return
    const timer = setInterval(() => setMotion(previous => previous && { ...previous, index: (previous.index + 1) % (MOTION_FRAMES + MOTION_FPS) }), 1000 / MOTION_FPS)
    return () => clearInterval(timer)
  }, [playing])
  const play = (id: string): void => {
    hover.current?.abort(); const controller = new AbortController(); hover.current = controller
    const kit = snapshot.current; const span = .15 + kit.tokens.motion.enterDuration + .25
    void (async () => {
      const urls: string[] = []
      try {
        for (let index = 0; index < MOTION_FRAMES; index++) {
          const blob = await renderStyleKitPreview(kit, id, previewSize(width, height), controller.signal, span * index / (MOTION_FRAMES - 1))
          controller.signal.throwIfAborted(); urls.push(URL.createObjectURL(blob))
        }
        setMotion({ id, urls, index: 0 })
      } catch { urls.forEach(url => URL.revokeObjectURL(url)) }
    })()
  }
  const stop = (): void => { hover.current?.abort(); hover.current = undefined; setMotion(null) }
  return <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,16rem),1fr))] gap-2" aria-label="风格样张">
    {pictures.map(picture => {
      // The last second of the loop holds the settled frame, so the eye reads the landing before the replay.
      const url = motion?.id === picture.id ? motion.urls[Math.min(motion.index, MOTION_FRAMES - 1)] : picture.url
      return <figure key={picture.id} className="m-0 overflow-hidden rounded-lg bg-raised" onPointerEnter={() => play(picture.id)} onPointerLeave={stop}><img className="h-28 w-full object-contain" style={{ backgroundColor: styleColorCss(kit.tokens.palette.bg) }} src={url} alt={`${picture.name}预览`} /><figcaption className="px-2 py-1 text-xs text-text2">{picture.name}</figcaption></figure>
    })}
    {error ? <UiError size="sm" message={error} onRetry={() => setRetry(value => value + 1)} /> : !pictures.length && <UiEmpty size="xs" title={kit.samples.length ? '正在预览风格…' : '暂无样例组件'} />}
  </div>
}
