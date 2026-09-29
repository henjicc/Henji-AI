import { useState } from 'react'
import { UiButton, UiInput } from '@/components/ui'
import { snapVideoEditFrame, videoEditDuration, type VideoEditClip } from '@/core/videoEdit/document'
import { editVideoProject, setVideoEditView, type VideoEditInstance } from './application/videoEditService'

export function VideoEditTimeline({ instance, onError }: { instance: VideoEditInstance; onError: (error: unknown) => void }): React.ReactElement {
  const [zoom, setZoom] = useState(60)
  const [snap, setSnap] = useState(true)
  const [drag, setDrag] = useState<{ clip: VideoEditClip; x: number; y: number; mode: 'move' | 'in' | 'out'; delta: number; track: number } | null>(null)
  const { document } = instance
  const pixels = zoom / document.fps
  const width = Math.max(900, (videoEditDuration(document) + document.fps * 5) * pixels)
  return <div className="flex h-64 shrink-0 flex-col bg-panel" aria-label="剪辑时间线">
    <div className="flex shrink-0 items-center gap-3 whitespace-nowrap px-3 py-1">
      <UiButton variant="plain" onClick={() => setVideoEditView(document.id, { playing: false, frame: Math.max(0, instance.frame - 1) })}>上一帧</UiButton>
      <UiButton variant="plain" onClick={() => setVideoEditView(document.id, { playing: !instance.playing })}>{instance.playing ? '暂停' : '播放'}</UiButton>
      <UiButton variant="plain" onClick={() => setVideoEditView(document.id, { playing: false, frame: Math.min(videoEditDuration(document) - 1, instance.frame + 1) })}>下一帧</UiButton>
      <span className="text-xs text-text-muted">{(instance.frame / document.fps).toFixed(3)}s / {(videoEditDuration(document) / document.fps).toFixed(3)}s</span>
      <UiButton variant="plain" aria-pressed={snap} onClick={() => setSnap(!snap)}>吸附{snap ? '开' : '关'}</UiButton>
      <div className="ml-auto w-28 shrink-0"><UiInput aria-label="时间线缩放" type="range" min={15} max={240} value={zoom} onChange={event => setZoom(Number(event.target.value))} /></div>
    </div>
    <div className="relative min-h-0 flex-1 overflow-auto">
      <div className="relative" style={{ width, height: 8 * 32 + 28 }}
        onPointerMove={event => { if (!drag) return; setDrag({ ...drag, delta: Math.round((event.clientX - drag.x) / pixels), track: Math.max(0, Math.min(7, drag.clip.track + Math.round((event.clientY - drag.y) / 32))) }) }}
        onPointerUp={() => {
          if (!drag) return
          const { clip, delta, mode } = drag; setDrag(null)
          try { editVideoProject(document.id, draft => ({ ...draft, clips: draft.clips.map(item => {
            if (item.id !== clip.id) return item
            if (mode === 'move') return { ...item, track: drag.track, start: snap ? snapVideoEditFrame(draft, clip.start + delta, clip.id, 8 / pixels) : Math.max(0, clip.start + delta) }
            if (mode === 'out') return { ...item, duration: Math.max(1, clip.duration + delta) }
            const shift = Math.max(-clip.start, -Math.floor(clip.sourceInUs * document.fps / 1e6), Math.min(clip.duration - 1, delta))
            return { ...item, start: clip.start + shift, duration: clip.duration - shift, sourceInUs: clip.sourceInUs + Math.round(shift * 1e6 / document.fps) }
          }) })) } catch (error) { onError(error) }
        }}>
        <div role="slider" tabIndex={0} aria-label="剪辑时间定位" aria-valuenow={instance.frame} aria-valuemin={0} aria-valuemax={videoEditDuration(document)} className="h-7 cursor-crosshair bg-surface-dark"
          onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); setVideoEditView(document.id, { playing: false, frame: Math.max(0, Math.min(videoEditDuration(document) - 1, instance.frame + (event.key === 'ArrowLeft' ? -1 : 1))) }) } }}
          onPointerMove={event => { if (!(event.buttons & 1)) return; const rect = event.currentTarget.getBoundingClientRect(); setVideoEditView(document.id, { playing: false, frame: Math.max(0, Math.min(videoEditDuration(document) - 1, Math.round((event.clientX - rect.left) / pixels))) }) }}
          onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); const rect = event.currentTarget.getBoundingClientRect(); setVideoEditView(document.id, { playing: false, frame: Math.max(0, Math.min(videoEditDuration(document) - 1, Math.round((event.clientX - rect.left) / pixels))) }) }}>
          {Array.from({ length: Math.ceil(width / zoom) }, (_, index) => <span key={index} className="absolute text-2xs text-text-muted" style={{ left: index * zoom }}>{index}s</span>)}
        </div>
        {Array.from({ length: 8 }, (_, track) => <div key={track} className="h-8 border-b border-border-dark"><span className="text-2xs text-text-faint">{track === 0 ? '声音 / 1' : `画面 / ${track + 1}`}</span></div>)}
        {document.clips.map(clip => <div key={clip.id} className={`absolute flex h-7 items-center overflow-hidden rounded-lg ${instance.selection === clip.id ? 'bg-layer ring-1 ring-text-muted' : 'bg-surface-dark'}`} style={{ top: 29 + (drag?.clip.id === clip.id ? drag.track : clip.track) * 32, left: (clip.start + (drag?.clip.id === clip.id && drag.mode === 'move' ? drag.delta : 0)) * pixels, width: Math.max(18, clip.duration * pixels) }}>
          {(['in', 'move', 'out'] as const).map(mode => <UiButton key={mode} variant="plain" className={mode === 'move' ? 'min-w-0 flex-1 truncate !px-1 text-xs' : '!px-1'} title={mode === 'in' ? '裁剪入点' : mode === 'out' ? '裁剪出点' : clip.name} onClick={() => setVideoEditView(document.id, { selection: clip.id })}
            onPointerDown={event => { event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); setVideoEditView(document.id, { selection: clip.id, playing: false }); setDrag({ clip, x: event.clientX, y: event.clientY, delta: 0, mode, track: clip.track }) }}>{mode === 'move' ? clip.name : '│'}</UiButton>)}
        </div>)}
        <div className="pointer-events-none absolute bottom-0 top-0 w-px bg-text-dark" style={{ left: instance.frame * pixels }} />
      </div>
    </div>
  </div>
}
