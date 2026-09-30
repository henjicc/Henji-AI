import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { UiButton, UiInput, UiError } from '@/components/ui'
import { videoEditDuration } from '@/core/videoEdit/document'
import { VideoEditRenderSession } from './engine/videoEditRenderSession'
import { acceptsVideoEditDrop, dropVideoEditPaths, videoEditDropPaths } from './application/videoEditDrop'
import { editVideoProject, requireVideoEditInstance, setVideoEditView, subscribeVideoEditView, videoEditViewRevision, type VideoEditInstance } from './application/videoEditService'

export function VideoEditPreview({ instance, onError }: { instance: VideoEditInstance; onError: (error: unknown) => void }): React.ReactElement {
  useSyncExternalStore(subscribeVideoEditView, videoEditViewRevision)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [mode, setMode] = useState<'select' | 'point' | 'region'>('select')
  const [label, setLabel] = useState('')
  const pointer = useRef<{ x: number; y: number } | null>(null)
  const [preparing, setPreparing] = useState(false)
  const [retry, setRetry] = useState(0)
  const session = useRef<VideoEditRenderSession | null>(null)
  const stopPreview = useRef<() => void>(() => {})
  const { document } = instance
  useEffect(() => {
    const initialDocument = instance.document
    if (canvas.current) delete canvas.current.dataset.presentedFrame
    let stopped = false
    const renderer = new VideoEditRenderSession(initialDocument, 1280, active => { if (!stopped) setPreparing(active) }); session.current = renderer
    let appliedDocument = initialDocument
    let timer: ReturnType<typeof setTimeout>
    let audio: AudioContext | undefined
    let lastFrame = -1
    let lastScrubbing = false
    let clockStart = 0
    let startFrame = 0
    let wasPlaying = false
    let nextAudio = 0
    const nodes = new Set<AudioBufferSourceNode>()
    const stopAudio = (): void => { for (const node of nodes) { try { node.stop() } catch { /* already ended */ } node.disconnect() } nodes.clear() }
    const loop = async (): Promise<void> => {
      try {
        const current = requireVideoEditInstance(instance.document.id)
        const document = current.document
        if (appliedDocument !== document) { await renderer.updateDocument(document); appliedDocument = document; lastFrame = -1; stopAudio(); wasPlaying = false }
        if (current.playing && !wasPlaying) {
          audio ??= new AudioContext({ sampleRate: 48000 }); await audio.resume()
          clockStart = audio.currentTime + 0.1; startFrame = current.frame; nextAudio = current.frame / document.fps
        }
        if (!current.playing && wasPlaying) stopAudio()
        wasPlaying = current.playing
        if (current.playing && audio) {
          const frame = startFrame + Math.max(0, Math.floor((audio.currentTime - clockStart) * document.fps))
          if (frame >= videoEditDuration(document)) { setVideoEditView(document.id, { playing: false }); stopAudio() }
          else if (frame !== current.frame) setVideoEditView(document.id, { frame })
          const timelineTime = startFrame / document.fps + audio.currentTime - clockStart
          if (nextAudio < timelineTime + 0.4 && nextAudio < videoEditDuration(document) / document.fps) {
            const duration = Math.min(0.5, videoEditDuration(document) / document.fps - nextAudio)
            const buffer = await renderer.mixAudio(nextAudio, duration)
            if (stopped) return
            const node = audio.createBufferSource(); node.buffer = buffer; node.connect(audio.destination)
            const when = clockStart + nextAudio - startFrame / document.fps
            const offset = Math.max(0, audio.currentTime - when)
            if (offset < buffer.duration) { node.start(Math.max(when, audio.currentTime), offset); nodes.add(node); node.onended = () => { nodes.delete(node); node.disconnect() } }
            nextAudio += duration
          }
        }
        const target = current.frame
        if (target !== lastFrame || (!!current.scrubbing !== lastScrubbing && !current.scrubbing)) {
          const scrubbing = !!current.scrubbing
          const requestedAt = performance.now()
          const result = await renderer.renderBitmap(target, current.playing, scrubbing)
          try {
            // A completed seek is useful while the pointer keeps moving. Only a different
            // document/lifetime invalidates it; the next iteration reads the latest target.
            if (stopped) return
            if (current.document !== document) { timer = setTimeout(() => { void loop() }, 0); return }
            const surface = canvas.current
            if (surface) {
              if (surface.width !== result.bitmap.width || surface.height !== result.bitmap.height) { surface.width = result.bitmap.width; surface.height = result.bitmap.height }
              surface.getContext('2d')?.drawImage(result.bitmap, 0, 0)
              surface.dataset.requestedAt = String(requestedAt); surface.dataset.renderMs = String(performance.now() - requestedAt)
              surface.dataset.sourceTimestamps = (result.sourceTimestamps ?? []).join(','); surface.dataset.cacheHits = String(result.cacheHits ?? 0); surface.dataset.cacheBytes = String(result.cacheBytes ?? 0)
              surface.dataset.proxyPreparationMs = String(renderer.previewPreparationMs); surface.dataset.proxyBytes = String(renderer.previewBytes)
              surface.dataset.scrubbing = String(scrubbing)
              surface.dataset.presentedFrame = String(target)
            }
            lastFrame = target; lastScrubbing = scrubbing
          } finally { result.bitmap.close() }
        }
        if (!stopped) timer = setTimeout(() => { void loop() }, 5)
      } catch (error) { if (!stopped) { setVideoEditView(initialDocument.id, { playing: false }); onError(error) } }
    }
    const stop = (): void => { stopped = true; clearTimeout(timer); instance.playing = false; stopAudio(); void audio?.close(); void renderer.dispose() }
    stopPreview.current = stop
    void loop()
    return stop
  }, [instance, onError, retry])
  return <div className="flex min-h-0 flex-1 flex-col bg-app">
    <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden p-3"
      onDragOver={event => { if (acceptsVideoEditDrop(event.dataTransfer)) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' } }}
      onDrop={event => {
        if (!acceptsVideoEditDrop(event.dataTransfer)) return
        event.preventDefault(); event.stopPropagation()
        const track = Math.min(7, Math.max(1, ...document.clips.filter(clip => clip.kind !== 'audio').map(clip => clip.track + 1)))
        try { void dropVideoEditPaths(document.id, videoEditDropPaths(event.dataTransfer), { frame: instance.frame, track }).catch(onError) } catch (error) { onError(error) }
      }}>
      <div className="relative max-h-full max-w-full" style={{ aspectRatio: `${document.width}/${document.height}`, height: '100%' }}>
        <canvas ref={canvas} width={document.width} height={document.height} aria-label="剪辑画面" className="h-full w-full object-contain"
          onPointerDown={event => { if (mode === 'select') return; const rect = event.currentTarget.getBoundingClientRect(); pointer.current = { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height }; event.currentTarget.setPointerCapture(event.pointerId) }}
          onPointerUp={event => {
            const start = pointer.current; pointer.current = null
            if (!start || !instance.selection) return
            const rect = event.currentTarget.getBoundingClientRect(); const x = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)); const y = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height))
            try { editVideoProject(document.id, draft => ({ ...draft, annotations: [...draft.annotations, { id: crypto.randomUUID(), clipId: instance.selection!, frame: instance.frame, space: 'composition-normalized', kind: mode === 'region' ? 'region' : 'point', x: Math.min(start.x, x), y: Math.min(start.y, y), width: mode === 'region' ? Math.abs(x - start.x) : 0, height: mode === 'region' ? Math.abs(y - start.y) : 0, text: label }] })) } catch (error) { onError(error) }
          }} />
        {document.annotations.filter(mark => mark.frame === instance.frame).map(mark => <div key={mark.id} className="pointer-events-none absolute border border-white text-xs text-white" style={{ left: `${mark.x * 100}%`, top: `${mark.y * 100}%`, width: mark.kind === 'point' ? 8 : `${mark.width * 100}%`, height: mark.kind === 'point' ? 8 : `${mark.height * 100}%` }}><span className="absolute bottom-full whitespace-nowrap bg-black/60 px-1">{mark.text}</span></div>)}
      </div>
    </div>
    <div className="flex items-center justify-center gap-2 px-3 py-1">
      {preparing && <><span className="text-xs text-text-muted">正在准备流畅预览…</span><UiButton variant="plain" onClick={() => { stopPreview.current(); setPreparing(false) }}>取消准备</UiButton></>}
      {!preparing && <UiButton variant="plain" onClick={() => setRetry(value => value + 1)}>重新加载预览</UiButton>}
      {(['select', 'point', 'region'] as const).map((value, index) => <UiButton key={value} variant="plain" aria-pressed={mode === value} onClick={() => setMode(value)}>{['选择', '点标注', '区域标注'][index]}</UiButton>)}
      {mode !== 'select' && <UiInput aria-label="标注文字" value={label} onChange={event => setLabel(event.target.value)} placeholder="标注文字" />}
      {mode !== 'select' && !instance.selection && <UiError message="请先选择要标注的片段" />}
    </div>
  </div>
}
