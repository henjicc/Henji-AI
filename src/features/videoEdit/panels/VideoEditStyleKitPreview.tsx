import { useEffect, useState } from 'react'
import { UiEmpty, UiError } from '@/components/ui'
import { styleColorCss, type StyleKit } from '@/core/videoEdit/styleKit'
import { renderStyleKitPreview } from '../application/videoEditStylePreview'

/** Preview uses the production compiler/compositor, not a separate imitation of author code. */
export function VideoEditStyleKitPreview({ kit, width, height, visible = true }: { kit: StyleKit; width: number; height: number; visible?: boolean }): React.ReactElement {
  const [pictures, setPictures] = useState<Array<{ id: string; name: string; url: string }>>([])
  const [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController(); const urls: string[] = []
    setPictures([]); setError('')
    if (!visible || !kit.samples.length) return () => controller.abort()
    const featured = ['title', 'lower_third', 'data'].flatMap(kind => { const sample = kit.samples.find(value => value.kind === kind); return sample ? [sample] : [] })
    const samples = featured.length ? featured : kit.samples.slice(0, 3)
    const timer = setTimeout(() => {
      void (async () => {
        for (const sample of samples) {
          const blob = await renderStyleKitPreview(kit, sample.id, { width, height }, controller.signal)
          controller.signal.throwIfAborted()
          const url = URL.createObjectURL(blob); urls.push(url)
          setPictures(previous => [...previous, { id: sample.id, name: sample.name, url }])
        }
      })().catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '风格预览失败，请重试。') })
    }, 180)
    return () => { clearTimeout(timer); controller.abort(); urls.forEach(url => URL.revokeObjectURL(url)) }
  }, [kit, width, height, visible])
  return <div className="grid gap-2" aria-label="风格预览">
    {pictures.map(picture => <figure key={picture.id} className="m-0 overflow-hidden rounded-lg bg-raised"><img className="w-full object-contain" style={{ backgroundColor: styleColorCss(kit.tokens.palette.bg) }} src={picture.url} alt={`${picture.name}预览`} /><figcaption className="px-2 py-1 text-xs text-text2">{picture.name}</figcaption></figure>)}
    {error ? <UiError size="sm" message={error} /> : !pictures.length && <UiEmpty size="xs" title={kit.samples.length ? '正在预览风格…' : '暂无样例组件'} />}
  </div>
}
