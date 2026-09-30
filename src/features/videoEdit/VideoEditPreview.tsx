import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { UiButton, UiInput, UiError } from '@/components/ui'
import { videoEditDuration } from '@/core/videoEdit/document'
import { VideoEditRenderSession } from './engine/videoEditRenderSession'
import { acceptsVideoEditDrop, dropVideoEditInput, readVideoEditDrop } from './application/videoEditDrop'
import { editVideoSequence, getActiveVideoEditSequence, requireVideoEditInstance, setVideoEditView, subscribeVideoEditDomain, subscribeVideoEditView, videoEditViewRevision, type VideoEditInstance } from './application/videoEditService'

export function VideoEditPreview({ instance, onError }: { instance: VideoEditInstance; onError: (error: unknown) => void }): React.ReactElement {
  useSyncExternalStore(subscribeVideoEditView, videoEditViewRevision)
  const host = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement | null>(null)
  const [mode, setMode] = useState<'select' | 'point' | 'region'>('select')
  const [label, setLabel] = useState('')
  const pointer = useRef<{ x: number; y: number } | null>(null)
  const [preparing, setPreparing] = useState(false)
  const [retry, setRetry] = useState(0)
  const session = useRef<VideoEditRenderSession | null>(null)
  const released = useRef<Promise<unknown>>(Promise.resolve())
  const stopPreview = useRef<() => void>(() => {})
  const document = getActiveVideoEditSequence(instance)
  useEffect(() => {
    const previousRelease = released.current
    let stopped = false
    let stopCurrent: () => void = () => {}
    const stop = (): void => { stopped = true; stopCurrent() }
    stopPreview.current = stop
    const initialize = async (): Promise<void> => {
    // A new sequence has its own renderer target; release the previous GPU/cache owner first.
    await previousRelease
    if (stopped) return
    const initialDocument = getActiveVideoEditSequence(instance)
    const surface = window.document.createElement('canvas')
    surface.width = initialDocument.width; surface.height = initialDocument.height
    surface.setAttribute('aria-label', '剪辑画面'); surface.className = 'h-full w-full object-contain'
    host.current?.replaceChildren(surface); canvas.current = surface
    const renderer = new VideoEditRenderSession(initialDocument, initialDocument.width, active => { if (!stopped) setPreparing(active) }, surface.transferControlToOffscreen()); session.current = renderer
    const unsubscribe = subscribeVideoEditDomain(() => renderer.invalidateDocument(instance.document.revision))
    let audioRenderer: VideoEditRenderSession | undefined
    let audioPending = false
    let audioGeneration = 0
    let appliedDocument = initialDocument
    let timer: ReturnType<typeof setTimeout>
    let audio: AudioContext | undefined
    let lastRequested = -1
    let lastFrame = -1
    let lastScrubbing = false
    let clockStart = 0
    let clockPerformanceStart = 0
    let startFrame = 0
    let wasPlaying = false
    let nextAudio = 0
    const nodes = new Set<AudioBufferSourceNode>()
    const stopAudio = (): void => { audioGeneration++; for (const node of nodes) { try { node.stop() } catch { /* already ended */ } node.disconnect() } nodes.clear() }
    const loop = async (): Promise<void> => {
      let scheduled = false
      try {
        const current = requireVideoEditInstance(instance.document.id)
        const document = getActiveVideoEditSequence(current)
        if (appliedDocument !== document) { await renderer.updateDocument(document); await audioRenderer?.updateDocument(document); appliedDocument = document; lastFrame = -1; lastRequested = -1; stopAudio(); wasPlaying = false }
        if (current.playing && !wasPlaying) {
          await renderer.present(current.frame, true)
          lastFrame = current.frame; lastRequested = current.frame
          if (document.clips.some(clip => clip.volume > 0 && (clip.kind === 'video' || clip.kind === 'audio'))) {
            audio ??= new AudioContext({ sampleRate: document.sampleRate }); await audio.resume()
            const before = audio.currentTime; const waiting = performance.now()
            while (audio.currentTime === before && performance.now() - waiting < 1000 && !stopped) await new Promise(resolve => setTimeout(resolve, 2))
          }
          if (stopped) return
          clockStart = (audio?.currentTime ?? 0) + 0.1; startFrame = current.frame; nextAudio = current.frame / document.fps
          clockPerformanceStart = performance.now() + 100
          surface.dataset.playClockStartAt = String(clockPerformanceStart)
          surface.dataset.playStartFrame = String(startFrame)
        }
        if (!current.playing && wasPlaying) stopAudio()
        wasPlaying = current.playing
        if (current.playing) {
          const timelineTime = startFrame / document.fps + (performance.now() - clockPerformanceStart) / 1000
          if (timelineTime >= videoEditDuration(document) / document.fps && lastFrame >= videoEditDuration(document) - 1) { setVideoEditView(instance.document.id, { playing: false }); stopAudio() }
          if (audio && !audioPending && nextAudio < timelineTime + 0.4 && nextAudio < videoEditDuration(document) / document.fps && document.clips.some(clip => clip.volume > 0 && (clip.kind === 'audio' || clip.kind === 'video'))) {
            audioRenderer ??= new VideoEditRenderSession(document)
            const duration = Math.min(0.5, videoEditDuration(document) / document.fps - nextAudio)
            const from = nextAudio; nextAudio += duration; audioPending = true
            const generation = audioGeneration; const context = audio
            void audioRenderer.mixAudio(from, duration).then(buffer => {
              if (stopped || generation !== audioGeneration) return
              const node = context.createBufferSource(); node.buffer = buffer; node.connect(context.destination)
              const when = clockStart + from - startFrame / document.fps
              const offset = Math.max(0, context.currentTime - when)
              if (offset < buffer.duration) { node.start(Math.max(when, context.currentTime), offset); nodes.add(node); node.onended = () => { nodes.delete(node); node.disconnect() } }
              else node.disconnect()
            }).catch(error => { if (!stopped && generation === audioGeneration) { setVideoEditView(instance.document.id, { playing: false }); onError(error) } }).finally(() => { audioPending = false })
          }
        }
        const playing = current.playing
        const target = playing ? Math.max(startFrame, Math.min(videoEditDuration(document) - 1, lastFrame + 1)) : current.frame
        if (target !== lastRequested || (!!current.scrubbing !== lastScrubbing && !current.scrubbing)) {
          const scrubbing = !!current.scrubbing
          const requestedAt = performance.now()
          const deadline = playing ? performance.timeOrigin + clockPerformanceStart + (target - startFrame) / document.fps * 1000 : undefined
          lastRequested = target
          const result = await renderer.present(target, playing, scrubbing, deadline, scrubbing ? () => {
            if (!stopped) { scheduled = true; timer = setTimeout(() => { void loop() }, 0) }
          } : undefined)
          {
            // A completed seek is useful while the pointer keeps moving. Only a different
            // document/lifetime invalidates it; the next iteration reads the latest target.
            if (stopped) return
            if (getActiveVideoEditSequence(current) !== document) { if (!scheduled) timer = setTimeout(() => { void loop() }, 0); return }
            if (result.presented === false) { lastFrame = -1; lastRequested = -1; if (!scheduled) timer = setTimeout(() => { void loop() }, 0); return }
            const surface = canvas.current
            if (surface) {
              surface.dataset.requestedAt = String(requestedAt); surface.dataset.renderMs = String(performance.now() - requestedAt)
              surface.dataset.decodeMs = String(result.decodeMs ?? 0); surface.dataset.gpuMs = String(result.gpuMs ?? 0)
              surface.dataset.sourceTimestamps = (result.sourceTimestamps ?? []).join(','); surface.dataset.cacheHits = String(result.cacheHits ?? 0); surface.dataset.cacheBytes = String(result.cacheBytes ?? 0)
              surface.dataset.proxyPreparationMs = String(renderer.previewPreparationMs); surface.dataset.proxyBytes = String(renderer.previewBytes)
              surface.dataset.scrubbing = String(scrubbing)
              surface.dataset.presentedFrame = String(target)
            }
            lastFrame = target; lastScrubbing = scrubbing
            if (playing && current.playing) setVideoEditView(instance.document.id, { frame: target })
          }
        }
        if (!stopped && !scheduled) timer = setTimeout(() => { void loop() }, current.playing ? 0 : 2)
      } catch (error) { if (!stopped) { setVideoEditView(instance.document.id, { playing: false }); onError(error) } }
    }
    let retired = false
    stopCurrent = (): void => {
      if (retired) return
      retired = true; unsubscribe(); clearTimeout(timer); instance.playing = false; stopAudio()
      released.current = Promise.allSettled([audio?.close(), renderer.dispose(), audioRenderer?.dispose()])
      surface.remove(); if (canvas.current === surface) canvas.current = null
    }
    void loop()
    }
    void initialize().catch(error => { if (!stopped) onError(error) })
    return stop
  }, [instance, instance.activeSequenceId, onError, retry])
  return <div className="flex min-h-0 flex-1 flex-col bg-app">
    <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden p-3"
      onDragOver={event => { if (acceptsVideoEditDrop(event.dataTransfer)) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' } }}
      onDrop={event => {
        if (!acceptsVideoEditDrop(event.dataTransfer)) return
        event.preventDefault(); event.stopPropagation()
        const track = Math.min(7, Math.max(1, ...document.clips.filter(clip => clip.kind !== 'audio').map(clip => clip.track + 1)))
        try { void dropVideoEditInput(instance.document.id, readVideoEditDrop(event.dataTransfer), { frame: instance.frame, track }).catch(onError) } catch (error) { onError(error) }
      }}>
      <div className="relative max-h-full max-w-full" style={{ aspectRatio: `${document.width}/${document.height}`, height: '100%' }}>
        <div ref={host} className="h-full w-full"
          onPointerDown={event => { if (mode === 'select') return; const rect = event.currentTarget.getBoundingClientRect(); pointer.current = { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height }; event.currentTarget.setPointerCapture(event.pointerId) }}
          onPointerUp={event => {
            const start = pointer.current; pointer.current = null
            if (!start || !instance.selection) return
            const rect = event.currentTarget.getBoundingClientRect(); const x = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)); const y = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height))
            try { editVideoSequence(instance.document.id, instance.activeSequenceId, draft => ({ ...draft, annotations: [...draft.annotations, { id: crypto.randomUUID(), clipId: instance.selection!, frame: instance.frame, space: 'composition-normalized', kind: mode === 'region' ? 'region' : 'point', x: Math.min(start.x, x), y: Math.min(start.y, y), width: mode === 'region' ? Math.abs(x - start.x) : 0, height: mode === 'region' ? Math.abs(y - start.y) : 0, text: label }] })) } catch (error) { onError(error) }
          }} />
        {document.annotations.filter(mark => mark.frame === instance.frame).map(mark => <div key={mark.id} className="pointer-events-none absolute border border-white text-xs text-white" style={{ left: `${mark.x * 100}%`, top: `${mark.y * 100}%`, width: mark.kind === 'point' ? 8 : `${mark.width * 100}%`, height: mark.kind === 'point' ? 8 : `${mark.height * 100}%` }}><span className="absolute bottom-full whitespace-nowrap bg-black/60 px-1">{mark.text}</span></div>)}
      </div>
    </div>
    <div className="flex flex-wrap items-center justify-center gap-2 px-3 py-1 [&_button]:shrink-0 [&_button]:whitespace-nowrap">
      {preparing && <><span className="text-xs text-text-muted">正在准备流畅预览…</span><UiButton variant="plain" onClick={() => { stopPreview.current(); setPreparing(false) }}>取消准备</UiButton></>}
      {!preparing && <UiButton variant="plain" onClick={() => setRetry(value => value + 1)}>重新加载预览</UiButton>}
      {(['select', 'point', 'region'] as const).map((value, index) => <UiButton key={value} variant="plain" aria-pressed={mode === value} onClick={() => setMode(value)}>{['选择', '点标注', '区域标注'][index]}</UiButton>)}
      {mode !== 'select' && <UiInput aria-label="标注文字" value={label} onChange={event => setLabel(event.target.value)} placeholder="标注文字" />}
      {mode !== 'select' && !instance.selection && <UiError message="请先选择要标注的片段" />}
    </div>
  </div>
}
