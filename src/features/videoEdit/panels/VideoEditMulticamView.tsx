import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { UiEmpty, UiError, UiOptionButton } from '@/components/ui'
import { videoEditNestedComposition } from '@/core/videoEdit/document'
import { videoEditNestedFrame } from '@/core/videoEdit/nestedSequences'
import { getActiveVideoEditSequence, subscribeVideoEditDomain, subscribeVideoEditView, videoEditDomainRevision, videoEditViewRevision, type VideoEditInstance } from '../application/videoEditService'
import { switchVideoEditMulticam, videoEditProgramMulticam } from '../application/videoEditMulticam'
import { VideoEditRenderSession } from '../engine/videoEditRenderSession'
import { VideoEditRenderWorkerError, VideoEditRenderRecovery } from '../engine/videoEditGpuFailure'
import { createLogger } from '@/core/logging'
const logger = createLogger('features.videoEdit.multicamPreview')
const releases = new WeakMap<VideoEditInstance, Promise<unknown>>()

/** Render every angle through the existing worker/decoder contract; never spawn HTML video playback clocks. */
export function VideoEditMulticamView({ instance, onError }: { instance: VideoEditInstance; onError: (error: unknown) => void }): React.ReactElement {
  useSyncExternalStore(subscribeVideoEditView, videoEditViewRevision)
  useSyncExternalStore(subscribeVideoEditDomain, videoEditDomainRevision)
  const target = videoEditProgramMulticam(instance)
  const [failure, setFailure] = useState('')
  const [retry, setRetry] = useState(0)
  const recovery = useRef(new VideoEditRenderRecovery())
  const canvases = useRef(new Map<string, HTMLCanvasElement>())
  const cameraKey = target?.source.multicam?.cameras.map(camera => camera.id).join(':') ?? ''
  const sourceId = target?.source.id
  useEffect(() => {
    if (!sourceId) return
    let stopped = false; let failed = false; let timer: ReturnType<typeof setTimeout> | undefined
    let lastFrame = -1; let lastRevision = -1
    let recovering = false
    const sessions = new Map<string, VideoEditRenderSession>()
    let retiring: Promise<unknown> | undefined
    const releaseSessions = (): Promise<unknown> => retiring ??= Promise.allSettled([...sessions.values()].map(session => session.dispose()))
    const previousRelease = releases.get(instance) ?? Promise.resolve()
    setFailure('')
    const render = async (): Promise<void> => {
      let delayMs = 100
      try {
        await previousRelease
        if (stopped) return
        const target = videoEditProgramMulticam(instance)
        if (!target || target.source.id !== sourceId) return
        const parent = getActiveVideoEditSequence(instance)
        for (const session of sessions.values()) if (session.terminalError) throw session.terminalError
        if (lastFrame === instance.frame && lastRevision === instance.document.revision) return
        const frame = instance.frame; const revision = instance.document.revision
        for (const camera of target.source.multicam!.cameras) {
          if (stopped) return
          const composition = videoEditNestedComposition(parent, { ...target.clip, multicamCameraId: camera.id })!
          let session = sessions.get(camera.id)
          if (!session) { session = new VideoEditRenderSession(composition, 320, undefined, undefined, 32 * 1024 ** 2); sessions.set(camera.id, session) }
          else if (lastRevision !== revision) await session.updateDocument(composition)
          const result = await session.renderBitmap(videoEditNestedFrame(parent, target.clip, composition, frame))
          try {
            const canvas = canvases.current.get(camera.id)
            if (!stopped && canvas && revision === instance.document.revision) { canvas.width = result.bitmap.width; canvas.height = result.bitmap.height; canvas.getContext('2d')?.drawImage(result.bitmap, 0, 0) }
          } finally { result.bitmap.close() }
        }
        lastFrame = frame; lastRevision = revision
        if (recovering) { recovering = false; logger.info('多机位画面已恢复', { event: 'video_edit.multicam.preview_recover.completed', context: { sourceId, frame } }) }
        if (!stopped) setFailure('')
      } catch (error) {
        if (!stopped) {
          const recoveryDelay = error instanceof VideoEditRenderWorkerError ? recovery.current.nextDelay() : undefined
          if (recoveryDelay !== undefined) {
            recovering = true
            logger.info('重新建立多机位画面', { event: 'video_edit.multicam.preview_recover.start', context: { sourceId, attempt: recovery.current.attempts } })
            await releaseSessions()
            sessions.clear(); retiring = undefined; lastFrame = -1; lastRevision = -1
            delayMs = recoveryDelay
            return
          }
          logger.warn('多机位画面无法显示', { event: 'video_edit.multicam.preview_recover.failed', error, context: { sourceId, attempts: recovery.current.attempts } })
          failed = true; setFailure(error instanceof Error ? error.message : String(error)); onError(error)
        }
      }
      finally { if (!stopped && !failed) timer = setTimeout(() => void render(), delayMs) }
    }
    void render()
    return () => { stopped = true; if (timer) clearTimeout(timer); releases.set(instance, releaseSessions()) }
  }, [instance, sourceId, cameraKey, onError, retry])
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
        <canvas ref={canvas => { if (canvas) canvases.current.set(camera.id, canvas); else canvases.current.delete(camera.id) }} className="aspect-video w-full bg-media object-contain" />
        <span className="w-full truncate text-xs" title={`${camera.name}${camera.speaker ? ` · ${camera.speaker}` : ''}`}>{index + 1} · {camera.name}{camera.speaker ? ` · ${camera.speaker}` : ''}</span>
      </UiOptionButton>)}
    </div>
    {failure && <UiError message={failure} onRetry={() => { recovery.current.reset(); setRetry(value => value + 1) }} />}
  </div>
}
