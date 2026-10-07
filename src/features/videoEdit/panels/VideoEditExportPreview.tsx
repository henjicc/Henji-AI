import { useEffect, useMemo, useRef, useState } from 'react'
import { UiEmpty, UiError, UiLoading } from '@/components/ui'
import { createLogger } from '@/core/logging'
import type { VideoEditComposition } from '@/core/videoEdit/document'
import { videoEditExportGeometry, type VideoEditExportSettings } from '@/core/videoEdit/exportPresets'
import { BLACK_HEX } from '@/core/theme/colorTokens'
import { VideoEditRenderSession } from '../engine/videoEditRenderSession'
import { videoEditSmartRegionSegments } from '../application/videoEditSmartRegions'
import { videoEditTrackResults } from '../application/videoEditTracking'

const logger = createLogger('features.videoEdit.exportPreview')
// A single preview frame must settle even if worker initialization or decoding never answers.
const PREVIEW_WAIT_MS = 30_000

/** Reuses the program renderer. The single drain keeps fast slider changes from queuing stale GPU work. */
export function VideoEditExportPreview({ composition, settings, frame, projectId }: { composition: VideoEditComposition; settings: VideoEditExportSettings; frame: number; projectId: string }): React.ReactElement {
  const canvas = useRef<HTMLCanvasElement>(null)
  const pictures = useMemo(() => settings.captionMode === 'burn' ? composition : { ...composition, captions: [], sequences: composition.sequences?.map(sequence => ({ ...sequence, captions: [] })) }, [composition, settings.captionMode])
  const requested = useRef({ composition, pictures, settings, frame })
  requested.current = useMemo(() => ({ composition, pictures, settings, frame }), [composition, pictures, settings, frame])
  const drain = useRef<() => void>(() => undefined)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!settings.videoEnabled) return
    let stopped = false; let running = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let applied: VideoEditComposition = pictures
    let renderer: VideoEditRenderSession
    try { renderer = new VideoEditRenderSession(pictures, 640, undefined, undefined, undefined, settings.useProxies ? projectId : undefined, settings.useProxies) } catch (reason) { setError('无法生成导出预览，请重试。'); setLoading(false); logger.warn('创建导出预览失败', { event: 'video_edit.export.preview_failed', error: reason, context: { projectId, frame: requested.current.frame } }); return }
    const dispose = (): void => { void renderer.dispose().catch(reason => logger.warn('释放导出预览失败', { event: 'video_edit.export.preview_cleanup_failed', error: reason })) }
    const render = async (): Promise<void> => {
      if (running || stopped) return
      running = true
      setLoading(true); setError('')
      logger.debug('开始准备导出预览', { event: 'video_edit.export.preview_start', context: { projectId, frame: requested.current.frame } })
      try {
        while (!stopped) {
          const request = requested.current
          timer = setTimeout(() => {
            stopped = true
            setError('预览等待时间过长，请重试。'); setLoading(false)
            logger.warn('导出预览等待超时', { event: 'video_edit.export.preview_failed', error: new Error('导出预览等待超时'), context: { projectId, frame: request.frame, timeoutMs: PREVIEW_WAIT_MS } })
            dispose()
          }, PREVIEW_WAIT_MS)
          const document = request.pictures
          if (applied !== document) { await renderer.updateDocument(document); applied = document }
          renderer.setSmartRegions(videoEditSmartRegionSegments()); renderer.setTracks(videoEditTrackResults(document))
          const result = await renderer.renderBitmap(request.frame)
          try {
            if (!stopped && request === requested.current) {
              const output = canvas.current
              if (!output) throw new Error('导出预览画布尚未挂载。')
              const scale = Math.min(1, 640 / Math.max(request.settings.width, request.settings.height))
              output.width = Math.max(1, Math.round(request.settings.width * scale)); output.height = Math.max(1, Math.round(request.settings.height * scale))
              const ctx = output.getContext('2d')
              if (!ctx) throw new Error('无法显示导出预览，请重新打开面板。')
              const geometry = videoEditExportGeometry(request.composition.width, request.composition.height, request.settings)
              const s = geometry.source; const d = geometry.destination
              ctx.fillStyle = BLACK_HEX; ctx.fillRect(0, 0, output.width, output.height)
              ctx.drawImage(result.bitmap, s.x * result.bitmap.width / document.width, s.y * result.bitmap.height / document.height, s.width * result.bitmap.width / document.width, s.height * result.bitmap.height / document.height, d.x * output.width / request.settings.width, d.y * output.height / request.settings.height, d.width * output.width / request.settings.width, d.height * output.height / request.settings.height)
              setLoading(false); setError('')
              logger.debug('导出预览画面已显示', { event: 'video_edit.export.preview_completed', context: { projectId, frame: request.frame } })
            }
          } finally { result.bitmap.close() }
          clearTimeout(timer)
          if (request === requested.current) break
        }
      } catch (reason) { if (!stopped) { setError('无法生成导出预览，请重试。'); setLoading(false); logger.warn('渲染导出预览失败', { event: 'video_edit.export.preview_failed', error: reason, context: { projectId, frame: requested.current.frame } }) } }
      finally { clearTimeout(timer); running = false }
    }
    setLoading(true); setError(''); drain.current = () => { void render() }; drain.current()
    return () => { stopped = true; clearTimeout(timer); drain.current = () => undefined; dispose() }
    // A sequence/proxy change owns a new render session; other changes are coalesced in its drain.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composition.id, projectId, settings.videoEnabled, settings.useProxies, attempt])
  useEffect(() => { drain.current() }, [composition, frame, settings])
  if (!settings.videoEnabled) return <div className="flex min-h-0 flex-1 items-center justify-center bg-media"><UiEmpty title="仅导出音频" /></div>
  return <div aria-busy={loading} className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-media">
    <canvas ref={canvas} aria-label="导出画面预览" hidden={Boolean(error)} className="max-h-full max-w-full object-contain" style={{ aspectRatio: settings.width / settings.height }} />
    {loading && <div className="absolute inset-0 flex items-center justify-center"><UiLoading message="正在准备预览…" /></div>}
    {error && <div className="absolute inset-0 flex items-center justify-center bg-panel"><UiError title="预览未能生成" message={error} onRetry={() => setAttempt(value => value + 1)} /></div>}
  </div>
}
