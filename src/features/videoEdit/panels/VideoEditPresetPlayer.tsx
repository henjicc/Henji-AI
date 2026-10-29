import { useEffect, useMemo, useRef, useState } from 'react'
import type { VideoEditPresetSource } from '../application/videoEditPresetCatalog'
import { PRESET_PREVIEW_FPS, presetPreviewTimeline, renderPresetPreviewFrame, type PresetPreviewTimeline } from '../application/videoEditPresetPreview'
import { subscribeContentTrustContext, runForeignContent } from '@/services/contentTrust'
import { readContentTrustFailure } from '@/core/contentTrust'
import { UiButton } from '@/components/ui'

const posters = new WeakMap<PresetPreviewTimeline, Promise<ImageBitmap>>()
function poster(timeline: PresetPreviewTimeline): Promise<ImageBitmap> {
  let value = posters.get(timeline)
  if (!value) {
    value = renderPresetPreviewFrame(timeline.composition, timeline.poster, new AbortController().signal).then(bitmap => { if (!bitmap) throw new Error('预览暂时没有画面，请稍后重试。'); return bitmap })
    value.catch(() => posters.delete(timeline)); posters.set(timeline, value)
  }
  return value
}
function paint(canvas: HTMLCanvasElement | null, bitmap: ImageBitmap): void {
  if (!canvas) return
  if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) { canvas.width = bitmap.width; canvas.height = bitmap.height }
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0)
  // Frame counter for automated checks only; no visible UI reads it.
  canvas.dataset.paintedFrames = String(Number(canvas.dataset.paintedFrames ?? 0) + 1)
}
const nextFrame = (): Promise<void> => new Promise(resolve => requestAnimationFrame(() => resolve()))

/**
 * Live preset preview on the shared render session: a poster while idle, real-time playback (wall clock, looping)
 * while `playing`. Frames that take longer than a display frame are simply skipped, never queued.
 */
export function VideoEditPresetPlayer({ source, size, playing, label, trustAction = true }: { source: VideoEditPresetSource; size: { width: number; height: number }; playing: boolean; label: string; trustAction?: boolean }): React.ReactElement {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [timeline, setTimeline] = useState<PresetPreviewTimeline>()
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<Error>()
  const [trustPending, setTrustPending] = useState(false)
  const trustFailure = readContentTrustFailure(error)
  const [retry, setRetry] = useState(0)
  useEffect(() => subscribeContentTrustContext(() => 'trustContext' in source ? [{ contents: source.trustContext ?? [] }] : [], () => setRetry(value => value + 1), reason => setError(reason instanceof Error ? reason : new Error('预览准备失败。'))), [source])
  const key = useMemo(() => JSON.stringify([source, size]), [source, size])
  useEffect(() => {
    let alive = true; setTimeline(undefined); setReady(false); setError(undefined)
    presetPreviewTimeline(source, size).then(value => { if (alive) setTimeline(value) }, reason => { if (alive) setError(reason instanceof Error ? reason : new Error('预览准备失败。')) })
    return () => { alive = false }
  }, [key, retry]) // eslint-disable-line react-hooks/exhaustive-deps -- `key` encodes source and size
  useEffect(() => {
    if (!timeline || playing) return
    let alive = true
    poster(timeline).then(bitmap => { if (alive) { paint(canvas.current, bitmap); setReady(true) } }, reason => { if (alive) setError(reason instanceof Error ? reason : new Error('预览失败。')) })
    return () => { alive = false }
  }, [timeline, playing])
  useEffect(() => {
    if (!timeline || !playing) return
    const controller = new AbortController(); const started = performance.now()
    void (async () => {
      while (!controller.signal.aborted) {
        const frame = Math.floor((performance.now() - started) / 1000 * PRESET_PREVIEW_FPS) % timeline.frames
        try { const bitmap = await renderPresetPreviewFrame(timeline.composition, frame, controller.signal); if (bitmap) { paint(canvas.current, bitmap); bitmap.close(); setReady(true) } }
        catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason : new Error('预览失败。')); return }
        await nextFrame()
      }
    })()
    return () => controller.abort()
  }, [timeline, playing])
  return <span className="relative block h-full w-full">
    <canvas ref={canvas} className="block h-full w-full object-cover" role="img" aria-label={label} data-preset-preview={error ? 'error' : ready ? 'ready' : 'loading'} />
    {(error || !ready) && <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-2 text-center text-xs text-text3">{error?.message || '正在准备预览…'}
      {trustAction && !!trustFailure?.records.length && <UiButton variant="quiet" size="sm" disabled={trustPending} onClick={event => {
        event.stopPropagation(); setTrustPending(true)
        void runForeignContent(trustFailure.records).catch(reason => setError(reason instanceof Error ? reason : new Error('信任选择保存失败。'))).finally(() => setTrustPending(false))
      }}>运行</UiButton>}
    </span>}
  </span>
}
