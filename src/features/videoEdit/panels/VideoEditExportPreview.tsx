import { useEffect, useMemo, useRef, useState } from 'react'
import { UiEmpty, UiError, UiLoading } from '@/components/ui'
import { createLogger } from '@/core/logging'
import type { VideoEditComposition } from '@/core/videoEdit/document'
import { videoEditExportGeometry, type VideoEditExportSettings } from '@/core/videoEdit/exportPresets'
import { BLACK_HEX } from '@/core/theme/colorTokens'
import { VideoEditRenderSession } from '../engine/videoEditRenderSession'
import { videoEditSmartRegionSegments } from '../application/videoEditSmartRegions'
import { videoEditTrackResults } from '../application/videoEditTracking'
import { videoEditUserErrorMessage } from '../application/videoEditUserError'

const logger = createLogger('features.videoEdit.exportPreview')

/** Reuses the program renderer. The single drain keeps fast slider changes from queuing stale GPU work. */
export function VideoEditExportPreview({ composition, settings, frame, projectId }: { composition: VideoEditComposition; settings: VideoEditExportSettings; frame: number; projectId: string }): React.ReactElement {
  const canvas = useRef<HTMLCanvasElement>(null)
  const pictures = useMemo(() => settings.captionMode === 'burn' ? composition : { ...composition, captions: [], sequences: composition.sequences?.map(sequence => ({ ...sequence, captions: [] })) }, [composition, settings.captionMode])
  const requested = useRef({ composition, pictures, settings, frame })
  requested.current = useMemo(() => ({ composition, pictures, settings, frame }), [composition, pictures, settings, frame])
  const drain = useRef<() => void>(() => undefined)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    if (!settings.videoEnabled) return
    let stopped = false; let running = false
    let applied: VideoEditComposition = pictures
    let renderer: VideoEditRenderSession
    try { renderer = new VideoEditRenderSession(pictures, 640, undefined, undefined, undefined, settings.useProxies ? projectId : undefined, settings.useProxies) } catch (reason) { setError(videoEditUserErrorMessage(reason)); setLoading(false); logger.warn('创建导出预览失败', { event: 'video_edit.export.preview_failed', error: reason }); return }
    const render = async (): Promise<void> => {
      if (running || stopped) return
      running = true
      try {
        while (!stopped) {
          const request = requested.current
          const document = request.pictures
          if (applied !== document) { await renderer.updateDocument(document); applied = document }
          renderer.setSmartRegions(videoEditSmartRegionSegments()); renderer.setTracks(videoEditTrackResults(document))
          const result = await renderer.renderBitmap(request.frame)
          try {
            if (!stopped && request === requested.current && canvas.current) {
              const output = canvas.current
              const scale = Math.min(1, 640 / Math.max(request.settings.width, request.settings.height))
              output.width = Math.max(1, Math.round(request.settings.width * scale)); output.height = Math.max(1, Math.round(request.settings.height * scale))
              const ctx = output.getContext('2d')
              if (!ctx) throw new Error('无法显示导出预览，请重新打开面板。')
              const geometry = videoEditExportGeometry(request.composition.width, request.composition.height, request.settings)
              const s = geometry.source; const d = geometry.destination
              ctx.fillStyle = BLACK_HEX; ctx.fillRect(0, 0, output.width, output.height)
              ctx.drawImage(result.bitmap, s.x * result.bitmap.width / document.width, s.y * result.bitmap.height / document.height, s.width * result.bitmap.width / document.width, s.height * result.bitmap.height / document.height, d.x * output.width / request.settings.width, d.y * output.height / request.settings.height, d.width * output.width / request.settings.width, d.height * output.height / request.settings.height)
              setLoading(false); setError('')
            }
          } finally { result.bitmap.close() }
          if (request === requested.current) break
        }
      } catch (reason) { if (!stopped) { setError(videoEditUserErrorMessage(reason)); setLoading(false); logger.warn('渲染导出预览失败', { event: 'video_edit.export.preview_failed', error: reason, context: { projectId, frame: requested.current.frame } }) } }
      finally { running = false }
    }
    setLoading(true); setError(''); drain.current = () => { void render() }; drain.current()
    return () => { stopped = true; drain.current = () => undefined; void renderer.dispose().catch(reason => logger.warn('释放导出预览失败', { event: 'video_edit.export.preview_cleanup_failed', error: reason })) }
    // A sequence/proxy change owns a new render session; other changes are coalesced in its drain.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composition.id, projectId, settings.videoEnabled, settings.useProxies])
  useEffect(() => { drain.current() }, [composition, frame, settings])
  if (!settings.videoEnabled) return <div className="flex min-h-0 flex-1 items-center justify-center bg-media"><UiEmpty title="仅导出音频" /></div>
  return <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-media">
    <canvas ref={canvas} aria-label="导出画面预览" className="max-h-full max-w-full object-contain" style={{ aspectRatio: settings.width / settings.height }} />
    {loading && <div className="absolute inset-0 flex items-center justify-center"><UiLoading message="正在准备预览…" /></div>}
    {error && <div className="absolute inset-0 flex items-center justify-center bg-panel"><UiError message={error} /></div>}
  </div>
}
