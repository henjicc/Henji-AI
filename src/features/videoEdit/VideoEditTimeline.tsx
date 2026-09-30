import { useState, useSyncExternalStore, type ReactNode } from 'react'
import { UiButton, UiInput } from '@/components/ui'
import { acceptsVideoEditDrop, dropVideoEditInput, readVideoEditDrop, type VideoEditDropInput } from './application/videoEditDrop'
import { VideoEditSequenceFrameRateRequired, type VideoEditSequenceSettings } from '@/core/videoEdit/projectItems'
import { VideoEditSequenceDialog } from './panels/VideoEditSequenceDialog'
import { adjustVideoEditClip, videoEditDuration, type VideoEditClip } from '@/core/videoEdit/document'
import { editVideoSequence, getActiveVideoEditSequence, requireVideoEditInstance, setVideoEditView, subscribeVideoEditView, videoEditViewRevision, type VideoEditInstance } from './application/videoEditService'

function VideoEditTransport({ instance }: { instance: VideoEditInstance }): React.ReactElement {
  useSyncExternalStore(subscribeVideoEditView, videoEditViewRevision)
  const document = getActiveVideoEditSequence(instance)
  return <>
    <UiButton variant="plain" onClick={() => setVideoEditView(instance.document.id, { playing: false, frame: Math.max(0, instance.frame - 1) })}>上一帧</UiButton>
    <UiButton variant="plain" onClick={() => setVideoEditView(instance.document.id, { playing: !instance.playing })}>{instance.playing ? '暂停' : '播放'}</UiButton>
    <UiButton variant="plain" onClick={() => setVideoEditView(instance.document.id, { playing: false, frame: Math.min(videoEditDuration(document) - 1, instance.frame + 1) })}>下一帧</UiButton>
    <span className="text-xs tabular-nums text-text-muted">{(instance.frame / document.fps).toFixed(3)}s / {(videoEditDuration(document) / document.fps).toFixed(3)}s</span>
  </>
}
function VideoEditPlayhead({ instance, pixels }: { instance: VideoEditInstance; pixels: number }): React.ReactElement {
  useSyncExternalStore(subscribeVideoEditView, videoEditViewRevision)
  return <div className="pointer-events-none absolute bottom-0 top-0 w-px bg-text-dark" style={{ left: instance.frame * pixels }} />
}
function VideoEditRuler({ instance, pixels, children }: { instance: VideoEditInstance; pixels: number; children: ReactNode }): React.ReactElement {
  useSyncExternalStore(subscribeVideoEditView, videoEditViewRevision)
  const document = getActiveVideoEditSequence(instance)
  const seek = (event: React.PointerEvent<HTMLDivElement>): void => {
    const rect = event.currentTarget.getBoundingClientRect()
    setVideoEditView(instance.document.id, { playing: false, frame: Math.max(0, Math.min(videoEditDuration(document) - 1, Math.round((event.clientX - rect.left) / pixels))) })
  }
  return <div role="slider" tabIndex={0} aria-label="剪辑时间定位" aria-valuenow={instance.frame} aria-valuemin={0} aria-valuemax={videoEditDuration(document) - 1} className="h-7 cursor-crosshair bg-surface-dark"
    onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); setVideoEditView(instance.document.id, { playing: false, frame: Math.max(0, Math.min(videoEditDuration(document) - 1, instance.frame + (event.key === 'ArrowLeft' ? -1 : 1))) }) } }}
    onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) seek(event) }}
    onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); setVideoEditView(instance.document.id, { scrubbing: true }); seek(event) }}
    onPointerUp={event => { seek(event); setVideoEditView(instance.document.id, { scrubbing: false }); event.currentTarget.releasePointerCapture(event.pointerId) }}
    onLostPointerCapture={() => setVideoEditView(instance.document.id, { scrubbing: false })}>
    {children}
  </div>
}

export function VideoEditTimeline({ instance, onError }: { instance: VideoEditInstance; onError: (error: unknown) => void }): React.ReactElement {
  const [zoom, setZoom] = useState(60)
  const [snap, setSnap] = useState(true)
  const [dropHint, setDropHint] = useState<{ frame: number; track: number } | null>(null)
  const [drag, setDrag] = useState<{ clip: VideoEditClip; x: number; y: number; mode: 'move' | 'in' | 'out'; delta: number; track: number } | null>(null)
  const [pendingSequence, setPendingSequence] = useState<{ owner: VideoEditInstance; input: VideoEditDropInput; placement: { frame: number; track: number }; sequenceId: string; settings: VideoEditSequenceSettings } | null>(null)
  const document = getActiveVideoEditSequence(instance)
  const pixels = zoom / document.fps
  const tickSeconds = Math.max(1, Math.ceil(48 / zoom))
  const width = Math.max(900, (videoEditDuration(document) + document.fps * 5) * pixels)
  const adjustment = drag ? { mode: drag.mode, delta: drag.delta, track: drag.track, snapThreshold: snap && drag.mode === 'move' ? 8 / pixels : undefined } : undefined
  return <div className="flex h-full min-h-0 select-none flex-col bg-panel" aria-label="剪辑时间线">
    <div className="flex shrink-0 items-center gap-3 whitespace-nowrap px-3 py-1">
      <VideoEditTransport instance={instance} />
      <UiButton variant="plain" aria-pressed={snap} onClick={() => setSnap(!snap)}>吸附{snap ? '开' : '关'}</UiButton>
      <div className="ml-auto w-28 shrink-0"><UiInput aria-label="时间线缩放" type="range" min={15} max={240} value={zoom} onChange={event => setZoom(Number(event.target.value))} /></div>
    </div>
    <div className="relative min-h-0 flex-1 overflow-auto">
      <div className="relative" style={{ width, height: 8 * 32 + 28 }}
        onDragOver={event => { if (acceptsVideoEditDrop(event.dataTransfer)) {
          event.preventDefault(); event.dataTransfer.dropEffect = 'copy'
          const rect = event.currentTarget.getBoundingClientRect()
          setDropHint({ frame: Math.max(0, Math.round((event.clientX - rect.left) / pixels)), track: Math.max(0, Math.min(7, Math.floor((event.clientY - rect.top - 28) / 32))) })
        } }}
        onDragLeave={event => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDropHint(null) }}
        onDrop={event => {
          if (!acceptsVideoEditDrop(event.dataTransfer)) return
          event.preventDefault(); event.stopPropagation(); setDropHint(null)
          const rect = event.currentTarget.getBoundingClientRect()
          const frame = Math.max(0, Math.round((event.clientX - rect.left) / pixels))
          const track = Math.max(0, Math.min(7, Math.floor((event.clientY - rect.top - 28) / 32)))
          try {
            const input = readVideoEditDrop(event.dataTransfer); const placement = { frame, track }; const sequenceId = instance.activeSequenceId
            void dropVideoEditInput(instance.document.id, input, placement, undefined, { sequenceId, createSequenceWhenEmpty: !document.clips.length }).catch(error => {
              if (error instanceof VideoEditSequenceFrameRateRequired) setPendingSequence({ owner: instance, input, placement, sequenceId, settings: error.settings })
              else onError(error)
            })
          } catch (error) { onError(error) }
        }}
        onPointerMove={event => { if (!drag) return; setDrag({ ...drag, delta: Math.round((event.clientX - drag.x) / pixels), track: Math.max(0, Math.min(7, drag.clip.track + Math.round((event.clientY - drag.y) / 32))) }) }}
        onPointerUp={() => {
          if (!drag) return
          const { clip } = drag; setDrag(null)
          try { editVideoSequence(instance.document.id, instance.activeSequenceId, draft => ({ ...draft, clips: draft.clips.map(item => {
            return item.id === clip.id && adjustment ? adjustVideoEditClip(document, item, adjustment) : item
          }) })) } catch (error) { onError(error) }
        }} onPointerCancel={() => setDrag(null)}>
        <VideoEditRuler instance={instance} pixels={pixels}>
          {Array.from({ length: Math.ceil(width / (zoom * tickSeconds)) }, (_, index) => <span key={index} className="pointer-events-none absolute text-2xs text-text-muted" style={{ left: index * zoom * tickSeconds }}>{index * tickSeconds}s</span>)}
        </VideoEditRuler>
        {Array.from({ length: 8 }, (_, track) => <div key={track} className="h-8 border-b border-border-dark"><span className="pointer-events-none absolute right-2 text-2xs text-text-faint">轨道 {track + 1}</span></div>)}
        {document.clips.map(clip => {
          const displayed = drag?.clip.id === clip.id && adjustment ? adjustVideoEditClip(document, clip, adjustment) : clip
          return <div key={clip.id} data-video-edit-clip={clip.id} className={`absolute flex h-7 items-center overflow-hidden rounded-md ${instance.selection === clip.id ? 'bg-accent/30 ring-1 ring-accent' : clip.kind === 'audio' ? 'bg-accent/10' : 'bg-surface-dark'}`} style={{ top: 29 + displayed.track * 32, left: displayed.start * pixels, width: Math.max(18, displayed.duration * pixels) }}>
          {(['in', 'move', 'out'] as const).map(mode => <UiButton key={mode} variant="plain" className={`!h-full !rounded-none ${mode === 'move' ? 'min-w-0 flex-1 truncate !px-1 text-xs' : 'w-3 shrink-0 !px-0 cursor-ew-resize'}`} title={mode === 'in' ? '裁剪入点' : mode === 'out' ? '裁剪出点' : clip.name} onClick={() => setVideoEditView(instance.document.id, { selection: clip.id })}
            onPointerDown={event => { event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); setVideoEditView(instance.document.id, { selection: clip.id, playing: false }); setDrag({ clip, x: event.clientX, y: event.clientY, delta: 0, mode, track: clip.track }) }}>{mode === 'move' ? clip.name : '│'}</UiButton>)}
        </div>})}
        {dropHint && <div className="pointer-events-none absolute h-7 w-36 border-l-2 border-accent bg-accent/20 px-2 text-2xs text-text-dark" style={{ top: 29 + dropHint.track * 32, left: dropHint.frame * pixels }}>释放以添加素材</div>}
        <VideoEditPlayhead instance={instance} pixels={pixels} />
      </div>
    </div>
    {pendingSequence && <VideoEditSequenceDialog title="按素材新建序列" requireFrameRate initial={pendingSequence.settings} bins={pendingSequence.owner.document.bins} onClose={() => setPendingSequence(null)} onSubmit={async settings => {
      const { owner, input, placement, sequenceId } = pendingSequence
      if (requireVideoEditInstance(owner.document.id) !== owner) throw new Error('原工程已关闭，请重新拖入。')
      await dropVideoEditInput(owner.document.id, input, placement, undefined, { sequenceId, createSequenceWhenEmpty: true, sequenceSettings: settings })
    }} />}
  </div>
}
