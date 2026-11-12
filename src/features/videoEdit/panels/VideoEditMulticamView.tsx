import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { UiEmpty, UiError, UiOptionButton } from '@/components/ui'
import { subscribeVideoEditDomain, subscribeVideoEditView, videoEditDomainRevision, videoEditViewRevision, type VideoEditInstance } from '../application/videoEditService'
import { switchVideoEditMulticam, videoEditProgramMulticam } from '../application/videoEditMulticam'
import { VideoEditGpuDeviceLostError, VideoEditRenderWorkerError, VideoEditRenderRecovery } from '../engine/videoEditGpuFailure'
import { VideoEditMulticamMonitor } from './videoEditMulticamMonitor'
import { createLogger } from '@/core/logging'
const logger = createLogger('features.videoEdit.multicamPreview')
const releases = new WeakMap<VideoEditInstance, Promise<unknown>>()

/** 全部机位由一个渲染会话合成为一张网格，Worker 直接画到各格子的画布（见 `VideoEditMulticamMonitor`）；不另开 HTML 视频时钟。 */
export function VideoEditMulticamView({ instance, onError }: { instance: VideoEditInstance; onError: (error: unknown) => void }): React.ReactElement {
  useSyncExternalStore(subscribeVideoEditView, videoEditViewRevision)
  useSyncExternalStore(subscribeVideoEditDomain, videoEditDomainRevision)
  const target = videoEditProgramMulticam(instance)
  const [failure, setFailure] = useState('')
  // 画布交给 Worker 后不能再交第二次：每个新会话（换源序列、恢复、重试）都换一批新画布。
  const [generation, setGeneration] = useState(0)
  const recovery = useRef(new VideoEditRenderRecovery())
  const recovering = useRef(false)
  const reportError = useRef(onError)
  reportError.current = onError
  const canvases = useRef(new Map<string, HTMLCanvasElement>())
  const cameraKey = target?.source.multicam?.cameras.map(camera => camera.id).join(':') ?? ''
  const sourceId = target?.source.id
  const surfaceKey = `${sourceId}:${cameraKey}:${generation}`
  useEffect(() => {
    if (!sourceId) return
    const elements = cameraKey.split(':').map(id => canvases.current.get(id))
    if (elements.some(canvas => !canvas)) return
    let recoveryTimer: ReturnType<typeof setTimeout> | undefined
    setFailure('')
    const monitor = new VideoEditMulticamMonitor(instance, sourceId, elements as HTMLCanvasElement[], {
      presented: () => {
        if (recovering.current) { recovering.current = false; logger.info('多机位画面已恢复', { event: 'video_edit.multicam.preview_recover.completed', context: { sourceId, frame: instance.frame } }) }
        setFailure('')
      },
      failed: error => {
        const delayMs = error instanceof VideoEditRenderWorkerError || error instanceof VideoEditGpuDeviceLostError ? recovery.current.nextDelay() : undefined
        if (delayMs !== undefined) {
          recovering.current = true
          logger.info('重新建立多机位画面', { event: 'video_edit.multicam.preview_recover.start', context: { sourceId, attempt: recovery.current.attempts, delayMs } })
          recoveryTimer = setTimeout(() => setGeneration(value => value + 1), delayMs)
          return
        }
        logger.warn('多机位画面无法显示', { event: 'video_edit.multicam.preview_recover.failed', error, context: { sourceId, attempts: recovery.current.attempts } })
        setFailure(error instanceof Error ? error.message : String(error)); reportError.current(error)
      },
    }, releases.get(instance))
    return () => { clearTimeout(recoveryTimer); releases.set(instance, monitor.dispose()) }
  }, [instance, sourceId, cameraKey, generation])
  const choose = (index: number): void => {
    const current = videoEditProgramMulticam(instance); const camera = current?.source.multicam?.cameras[index]
    if (!current || !camera) return
    try { switchVideoEditMulticam({ projectId: instance.document.id, sequenceId: instance.activeSequenceId, clipId: current.clip.id }, camera.id, instance.playing ? instance.frame : undefined) } catch (error) { onError(error) }
  }
  if (!target) return <UiEmpty title="播放头处没有多机位片段" />
  return <div className="flex min-h-0 flex-1 flex-col gap-2" tabIndex={0} role="group" aria-label="多机位监视器" onKeyDown={event => {
    if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || !/^[1-9]$/.test(event.key) || (event.target as HTMLElement).closest('input,textarea,[contenteditable="true"],[role="textbox"]')) return
    event.preventDefault(); event.stopPropagation(); choose(Number(event.key) - 1)
  }}>
    <div className={`grid min-h-0 flex-1 gap-2 ${target.source.multicam!.cameras.length > 4 ? 'grid-cols-3' : 'grid-cols-2'}`}>
      {target.source.multicam!.cameras.map((camera, index) => <UiOptionButton key={camera.id} variant="menu" active={(target.clip.multicamCameraId ?? target.source.multicam!.cameras[0].id) === camera.id} className="min-w-0 flex-col gap-1" onClick={() => choose(index)} aria-label={`切换到机位${index + 1} ${camera.name}`}>
        <canvas key={surfaceKey} ref={canvas => { if (canvas) canvases.current.set(camera.id, canvas); else canvases.current.delete(camera.id) }} className="aspect-video w-full bg-media object-contain" />
        <span className="w-full truncate text-xs" title={`${camera.name}${camera.speaker ? ` · ${camera.speaker}` : ''}`}>{index + 1} · {camera.name}{camera.speaker ? ` · ${camera.speaker}` : ''}</span>
      </UiOptionButton>)}
    </div>
    {failure && <UiError message={failure} onRetry={() => { recovery.current.reset(); setGeneration(value => value + 1) }} />}
  </div>
}
