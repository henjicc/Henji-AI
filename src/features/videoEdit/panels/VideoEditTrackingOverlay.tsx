import { useEffect, useRef, useState, useSyncExternalStore, type PointerEvent } from 'react'
import { UiButton, UiLoading, UiOptionButton } from '@/components/ui'
import { videoEditClipPictureSize, videoEditClipToFrame, videoEditFrameToClip } from '@/core/videoEdit/clipGeometry'
import { VIDEO_EDIT_TRACK_METHOD_LABELS, type VideoEditTrackBox, type VideoEditTrackPrompt } from '@/core/videoEdit/tracking'
import { createLogger } from '@/core/logging'
import { getActiveVideoEditSequence, subscribeVideoEditDomain, subscribeVideoEditView, videoEditDomainRevision, videoEditViewRevision, type VideoEditInstance } from '../application/videoEditService'
import { correctVideoEditTracker, editVideoEditTracker, readVideoEditTrackingBox, readVideoEditTrackingPlacement } from '../application/videoEditTrackingEdits'
import { getVideoEditTrackingEditing, setVideoEditTrackingEditing, subscribeVideoEditTrackingEditing, videoEditTrackingEditingRevision, type VideoEditTrackingEditing } from '../application/videoEditTrackingEditing'
import { subscribeVideoEditTracking, videoEditTrackingRevision, videoEditTrackingCandidates } from '../application/videoEditTracking'
import { videoEditClipSourceTimeUs } from '../engine/videoEditTrackResults'
import type { VideoEditClip } from '@/core/videoEdit/document'
import { useThemeTokens } from '@/hooks/useThemeTokens'
import { parseColor } from '@/core/theme/themeColor'
import { VideoEditGeometryTrackingOverlay } from './VideoEditGeometryTrackingOverlay'

const logger = createLogger('features.videoEdit.tracking')
export function VideoEditTrackingOverlay({ instance, onError }: { instance: VideoEditInstance; onError: (error: unknown) => void }): React.ReactElement | null {
  useSyncExternalStore(subscribeVideoEditTrackingEditing, videoEditTrackingEditingRevision)
  const method=getVideoEditTrackingEditing()?.method
  return method==='point' || method==='planar' ? <VideoEditGeometryTrackingOverlay instance={instance} onError={onError} /> : <VideoEditSubjectTrackingOverlay instance={instance} onError={onError} />
}
function VideoEditSubjectTrackingOverlay({ instance, onError }: { instance: VideoEditInstance; onError: (error: unknown) => void }): React.ReactElement | null {
  const theme = useThemeTokens()
  useSyncExternalStore(subscribeVideoEditDomain, videoEditDomainRevision)
  useSyncExternalStore(subscribeVideoEditView, videoEditViewRevision)
  useSyncExternalStore(subscribeVideoEditTrackingEditing, videoEditTrackingEditingRevision)
  const trackRevision = useSyncExternalStore(subscribeVideoEditTracking, videoEditTrackingRevision)
  const editing = getVideoEditTrackingEditing()
  const sequence = getActiveVideoEditSequence(instance)
  const clip = editing?.projectId === instance.document.id && editing.sequenceId === sequence.id && editing.clipId === instance.selection ? sequence.clips.find(clip => clip.id === editing.clipId) : undefined
  const picture = clip && videoEditClipPictureSize(sequence, clip)
  const [box, setBox] = useState<VideoEditTrackBox | null | undefined>()
  const [placement, setPlacement] = useState<VideoEditClip | undefined>()
  const [draft, setDraft] = useState<readonly [number, number, number, number] | null>(null)
  const [pending, setPending] = useState(false)
  const candidateCanvas = useRef<HTMLCanvasElement>(null)
  const drag = useRef<{ u: number; v: number; document: object; frame: number; editing: VideoEditTrackingEditing; box?: VideoEditTrackBox } | null>(null)
  const document = instance.document; const frame = instance.frame
  useEffect(() => {
    setBox(undefined); setPlacement(undefined); setDraft(null)
    if (!clip) return
    let live = true
    void Promise.all([editing?.trackerId ? readVideoEditTrackingBox(document.id, sequence.id, clip.id, editing.trackerId, frame) : undefined, readVideoEditTrackingPlacement(document.id, sequence.id, clip.id, frame)]).then(([value, position]) => { if (live) { setBox(value); setPlacement(position) } }, (error: unknown) => { if (live) { logger.warn('跟踪框读取失败', { event: 'video_edit.tracking.box_failed', error }); onError(error) } })
    return () => { live = false }
  }, [document, sequence.id, clip, editing?.trackerId, frame, trackRevision, onError])
  const candidates = editing?.candidates?.document === document && editing.candidates.frame === frame ? editing.candidates : undefined
  useEffect(() => {
    const canvas = candidateCanvas.current
    if (!canvas || !candidates) return
    const { size } = candidates.result; const item = candidates.result.candidates[candidates.preview]
    const context = canvas.getContext('2d'); if (!context || !item) return
    canvas.width = size; canvas.height = size
    const color = parseColor(theme.colors.accentText)
    if (!color) return
    const image = context.createImageData(size, size)
    for (let index = 0; index < item.logits.length; index++) if (item.logits[index] > 0) { image.data.set([color.r, color.g, color.b, 110], index * 4) }
    context.putImageData(image, 0, 0)
  }, [candidates, theme])
  if (!clip || !editing || !picture || instance.playing || frame < clip.start || frame >= clip.start + clip.duration) return null
  const locked = sequence.tracks.find(track => track.index === clip.track)?.locked
  const displayed = placement?.id === clip.id ? placement : clip
  const toFrame = (u: number, v: number) => videoEditClipToFrame(displayed, picture, sequence, u, v)
  const point = (event: PointerEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect()
    const local = videoEditFrameToClip(displayed, picture, sequence, (event.clientX - bounds.left) / bounds.width, (event.clientY - bounds.top) / bounds.height)
    return { u: Math.max(0, Math.min(1, local.u)), v: Math.max(0, Math.min(1, local.v)) }
  }
  const commit = (prompt: VideoEditTrackPrompt): void => {
    if (editing.trackerId) correctVideoEditTracker(document.id, sequence.id, clip.id, editing.trackerId, prompt)
    else {
      const tracker = { id: crypto.randomUUID(), name: `${VIDEO_EDIT_TRACK_METHOD_LABELS[editing.method]} ${(clip.trackers?.length ?? 0) + 1}`, method: editing.method, prompts: [prompt] }
      editVideoEditTracker(document.id, sequence.id, clip.id, tracker)
      setVideoEditTrackingEditing({ ...editing, trackerId: tracker.id, mode: 'show', candidates: undefined })
      return
    }
    setVideoEditTrackingEditing({ ...editing, mode: 'show', candidates: undefined })
  }
  const down = (event: PointerEvent<SVGSVGElement>): void => {
    if (locked || pending || event.button !== 0) return
    if (editing.mode === 'show' && !box) return
    event.preventDefault(); event.stopPropagation()
    const start = point(event)
    drag.current = { ...start, document, frame, editing, ...(editing.mode === 'show' && box ? { box } : {}) }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const move = (event: PointerEvent<SVGSVGElement>): void => {
    const start = drag.current; if (!start || editing.mode === 'point') return
    const end = point(event)
    if (start.box) setDraft([Math.max(0, Math.min(1 - start.box[2], start.box[0] + end.u - start.u)), Math.max(0, Math.min(1 - start.box[3], start.box[1] + end.v - start.v)), start.box[2], start.box[3]])
    else setDraft([Math.min(start.u, end.u), Math.min(start.v, end.v), Math.abs(end.u - start.u), Math.abs(end.v - start.v)])
  }
  const up = (event: PointerEvent<SVGSVGElement>): void => {
    const start = drag.current; drag.current = null; setDraft(null)
    if (!start || instance.document !== start.document || instance.frame !== start.frame || getVideoEditTrackingEditing() !== start.editing) return
    const end = point(event); const timeUs = videoEditClipSourceTimeUs(sequence, clip, frame)
    if (editing.mode === 'point') {
      const previous = clip.trackers?.find(tracker => tracker.id === editing.trackerId)?.prompts.find(prompt => prompt.timeUs === timeUs)
      const points: Array<[number, number, 0 | 1]> = [...previous?.points ?? [], [end.u, end.v, event.altKey ? 0 : 1]]
      const prompt = { timeUs, points }
      if (points.length > 1 || event.altKey) { try { commit(prompt) } catch (error) { onError(error) } return }
      setPending(true)
      void videoEditTrackingCandidates(document, sequence.frameRate, clip, { timeUs, points }).then(result => {
        if (instance.document === document && instance.frame === frame && instance.selection === clip.id && instance.activeSequenceId === sequence.id && getVideoEditTrackingEditing() === editing) setVideoEditTrackingEditing({ ...editing, candidates: { result, prompt, preview: 0, document, frame } })
      }, (error: unknown) => { logger.warn('跟踪候选生成失败', { event: 'video_edit.tracking.candidates_failed', error }); onError(error) }).finally(() => setPending(false))
    } else {
      const next = start.box ? [Math.max(0, Math.min(1 - start.box[2], start.box[0] + end.u - start.u)), Math.max(0, Math.min(1 - start.box[3], start.box[1] + end.v - start.v)), start.box[2], start.box[3]] as const : [Math.min(start.u, end.u), Math.min(start.v, end.v), Math.abs(end.u - start.u), Math.abs(end.v - start.v)] as const
      if (next[2] < 0.002 || next[3] < 0.002) return
      if (start.box && Math.abs(end.u - start.u) + Math.abs(end.v - start.v) < 0.001) return
      try { commit({ timeUs, box: [...next] }) } catch (error) { onError(error) }
    }
  }
  const shown = draft ?? box
  const polygon = shown ? [[shown[0], shown[1]], [shown[0] + shown[2], shown[1]], [shown[0] + shown[2], shown[1] + shown[3]], [shown[0], shown[1] + shown[3]]].map(([u, v]) => { const p = toFrame(u, v); return `${p.x * 1000},${p.y * 1000}` }).join(' ') : ''
  const origin = toFrame(0, 0); const right = toFrame(1, 0); const bottom = toFrame(0, 1)
  const transform = `matrix(${right.x - origin.x},${right.y - origin.y},${bottom.x - origin.x},${bottom.y - origin.y},${origin.x * 1000},${origin.y * 1000})`
  return <div className="pointer-events-none absolute inset-0 z-raised" data-video-edit-tracking-overlay>
    {/* icon-token-allow 跟踪框由片段几何与逐帧结果计算，SVG 是可编辑画面图形。 */}
    <svg className="h-full w-full text-accent-text" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-label="节目跟踪选择" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { drag.current = null; setDraft(null) }}>
      {editing.mode !== 'show' && <rect width="1000" height="1000" fill="transparent" className="pointer-events-auto cursor-crosshair" />}
      {candidates && <foreignObject width="1000" height="1000" transform={transform}><canvas ref={candidateCanvas} className="h-full w-full text-accent-text" /></foreignObject>}
      {shown && <polygon points={polygon} fill="transparent" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" className="pointer-events-auto cursor-move" />}
    </svg>
    {(candidates || pending) && <div className="pointer-events-auto absolute bottom-2 left-2 right-2 flex flex-wrap items-center gap-1 ui-glass p-2">
      {pending ? <UiLoading size="xs" message="正在寻找物体…" /> : candidates && <>
        <div className="flex flex-wrap items-center gap-1" role="radiogroup" aria-label="跟踪候选">
        {candidates.result.candidates.map((_, index) => <UiOptionButton key={index} variant="menu" size="sm" role="radio" aria-checked={candidates.preview === index} active={candidates.preview === index} onClick={() => setVideoEditTrackingEditing({ ...editing, candidates: { ...candidates, preview: index } })}>候选 {index + 1}</UiOptionButton>)}
        </div>
        <UiButton size="sm" variant="primary" onClick={() => { try { commit({ ...candidates.prompt, candidate: candidates.preview + 1 }) } catch (error) { onError(error) } }}>使用候选</UiButton>
      </>}
    </div>}
  </div>
}
