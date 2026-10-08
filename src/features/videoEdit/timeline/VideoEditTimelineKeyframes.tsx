import { useEffect, useRef, useState } from 'react'
import type { VideoEditClip } from '@/core/videoEdit/document'
import { evaluateVideoEditKeyframes, putVideoEditKeyframe, type VideoEditKeyframes } from '@/core/videoEdit/keyframes'
import { beginVideoEditGesture, finishVideoEditGesture, requireVideoEditInstance, setVideoEditTimelineView, setVideoEditView, type VideoEditGesture } from '../application/videoEditService'
import { updateVideoEditClipKeyframes } from '../application/videoEditClipProperties'
import { ownerDocumentOf } from '@/utils/crossRealmDom'
import { PanelTrigger } from '@/components/ui'
import { VideoEditKeyframeInterpolation } from '../panels/VideoEditKeyframeInterpolation'
import { VIDEO_EDIT_DEFAULT_BEZIER, type VideoEditBezier } from '@/core/videoEdit/keyframeInterpolation'

interface Props { projectId: string; sequenceId: string; clip: VideoEditClip; pen: boolean; width: number; height: number; pixels: number; onError: (reason: unknown) => void }
interface Drag { handle: VideoEditGesture; points: VideoEditKeyframes; originalTime?: number; bezierIndex?: 0 | 2; rect: DOMRect; pointerId: number; scope: string }
/** Time/value rubber band is shared by audio volume and video opacity. Pen owns only this clip's points. */
export function VideoEditTimelineKeyframes({ projectId, sequenceId, clip, pen, width, height, pixels, onError }: Props): React.ReactElement | null {
  const key = clip.kind === 'audio' ? 'volume' : 'opacity'; const maximum = key === 'volume' ? 2 : 1
  const points = clip.curves?.[key] ?? []
  const all = [...new Set([...Object.values(clip.curves ?? {}).flat().map(point => point.time), ...(clip.effects ?? []).flatMap(effect => Object.values(effect.builtin?.curves ?? {}).flat().map(point => point.time))])]
  const drag = useRef<Drag>(); const svg = useRef<SVGSVGElement>(null)
  const easing = useRef<VideoEditGesture>()
  const [editor, setEditor] = useState<{ time: number; left: number; top: number; scope: string }>()
  const scope = `${projectId}:${sequenceId}:${clip.id}:${pen}:${pixels}`
  const selected = editor?.scope === scope ? points.find(point => point.time === editor.time) : undefined
  const cancel = (): void => { const current = drag.current; drag.current = undefined; if (current) finishVideoEditGesture(current.handle, false); const handle = easing.current; easing.current = undefined; if (handle) finishVideoEditGesture(handle, false) }
  useEffect(() => {
    const host = svg.current; if (!host) return
    const document = ownerDocumentOf(host); const window = document.defaultView!
    const escape = (event: KeyboardEvent): void => { if (event.key === 'Escape' && drag.current) { event.preventDefault(); event.stopPropagation(); cancel() } }
    document.addEventListener('keydown', escape, true); window.addEventListener('blur', cancel)
    return () => { cancel(); document.removeEventListener('keydown', escape, true); window.removeEventListener('blur', cancel) }
  }, [scope])
  if (!pen && !all.length) return null
  const top = Math.min(18, height / 3); const bottom = Math.max(top + 1, height - 4)
  const y = (value: number): number => bottom - value / maximum * (bottom - top)
  const write = (event: { clientX: number; clientY: number }): void => {
    const current = drag.current; if (!current) return
    if (current.scope !== scope || requireVideoEditInstance(projectId).activeSequenceId !== sequenceId) { cancel(); return }
    if (current.bezierIndex !== undefined) {
      const index = current.points.findIndex(point => point.time === current.originalTime)
      const left = current.points[index]; const right = current.points[index + 1]
      if (!left || !right || right.value === left.value) return
      const bezier: VideoEditBezier = [...(left.bezier ?? VIDEO_EDIT_DEFAULT_BEZIER)]
      bezier[current.bezierIndex] = Math.max(0, Math.min(1, ((event.clientX - current.rect.left) / pixels - left.time) / (right.time - left.time)))
      const value = (bottom - (event.clientY - current.rect.top)) / (bottom - top) * maximum
      bezier[current.bezierIndex + 1] = (value - Number(left.value)) / (Number(right.value) - Number(left.value))
      updateVideoEditClipKeyframes(projectId, sequenceId, clip.id, key, putVideoEditKeyframe(current.points, { ...left, bezier, easeRange: undefined, easeValues: undefined }), current.handle)
      return
    }
    const time = Math.max(0, Math.min(clip.duration - 1, Math.round((event.clientX - current.rect.left) / pixels)))
    const value = Math.max(0, Math.min(maximum, (bottom - (event.clientY - current.rect.top)) / (bottom - top) * maximum))
    const baseline = current.points.filter(point => point.time !== current.originalTime)
    const interpolation = current.points.find(point => point.time === current.originalTime)?.interpolation ?? 'linear'
    updateVideoEditClipKeyframes(projectId, sequenceId, clip.id, key, putVideoEditKeyframe(baseline, { ...current.points.find(point => point.time === current.originalTime), easeRange: undefined, easeValues: undefined, time, value, interpolation }), current.handle)
  }
  const samples = Math.min(256, Math.max(2, Math.ceil(width / 4)))
  const path = Array.from({ length: samples }, (_, i) => {
    const time = i / (samples - 1) * (clip.duration - 1)
    return `${i ? 'L' : 'M'}${time * pixels} ${y(evaluateVideoEditKeyframes(points, time, clip[key]))}`
  }).join(' ')
  return <><svg ref={svg} className={`absolute inset-0 h-full w-full ${pen ? 'cursor-crosshair' : 'pointer-events-none'} text-accent-text`} viewBox={`0 0 ${Math.max(1, width)} ${Math.max(1, height)}`} preserveAspectRatio="none" data-video-edit-keyframe-line={key} aria-label={key === 'volume' ? '片段音量关键帧线' : '片段不透明度关键帧线'}
    onPointerDown={event => {
      if (!pen || event.button !== 0) return
      event.preventDefault(); event.stopPropagation()
      try {
        setVideoEditTimelineView(projectId, { selectedClipIds: [clip.id] }, clip.id)
        setVideoEditView(projectId, { playing: false })
        const timeText = (event.target as Element).getAttribute('data-keyframe-time')
        const bezierText = (event.target as Element).getAttribute('data-keyframe-bezier')
        const originalTime = timeText === null ? undefined : Number(timeText)
        if ((event.ctrlKey || event.metaKey) && originalTime !== undefined) { updateVideoEditClipKeyframes(projectId, sequenceId, clip.id, key, points.filter(point => point.time !== originalTime)); return }
        const handle = beginVideoEditGesture(projectId)
        drag.current = { handle, points, originalTime, ...(bezierText !== null ? { bezierIndex: Number(bezierText) as 0 | 2 } : {}), rect: event.currentTarget.getBoundingClientRect(), pointerId: event.pointerId, scope }
        event.currentTarget.setPointerCapture?.(event.pointerId)
        if (originalTime === undefined) write(event)
      } catch (error) { cancel(); onError(error) }
    }}
    onPointerMove={event => { if (drag.current?.pointerId !== event.pointerId) return; try { write(event) } catch (error) { cancel(); onError(error) } }}
    onPointerUp={event => { if (drag.current?.pointerId !== event.pointerId) return; event.stopPropagation(); const current = drag.current; drag.current = undefined; try { finishVideoEditGesture(current.handle) } catch (error) { finishVideoEditGesture(current.handle, false); onError(error) } }}
    onContextMenu={event => {
      const time = (event.target as Element).getAttribute('data-keyframe-time')
      if (!pen || time === null) return
      event.preventDefault(); event.stopPropagation(); setEditor({ time: Number(time), left: event.clientX, top: event.clientY, scope })
    }}
    onPointerCancel={cancel} onLostPointerCapture={cancel}>
    {pen && <path d={path} fill="none" stroke="currentColor" strokeWidth={1.5} />}
    {pen && points.flatMap((point, index) => {
      const next = points[index + 1]
      if (point.interpolation !== 'bezier' || !next || point.value === next.value) return []
      const controls = point.bezier ?? VIDEO_EDIT_DEFAULT_BEZIER
      return ([0, 2] as const).map(handle => {
        const x = (point.time + (next.time - point.time) * controls[handle]) * pixels
        const value = Number(point.value) + (Number(next.value) - Number(point.value)) * controls[handle + 1]
        const anchor = handle === 0 ? point : next
        return <g key={`${point.time}:${handle}`}>
          <path d={`M${anchor.time * pixels} ${y(Number(anchor.value))}L${x} ${y(value)}`} stroke="currentColor" opacity={0.5} pointerEvents="none" />
          <circle data-keyframe-time={point.time} data-keyframe-bezier={handle} aria-label={`${key === 'volume' ? '音量' : '不透明度'}贝塞尔${handle === 0 ? '出' : '入'}切线`} cx={x} cy={y(value)} r={3} fill="currentColor" />
        </g>
      })
    })}
    {pen ? points.map(point => <circle key={point.time} data-keyframe-time={point.time} cx={point.time * pixels} cy={y(point.value as number)} r={4} fill="currentColor" />) : all.map(time => <path key={time} d={`M${time * pixels} 2l3 3-3 3-3-3Z`} fill="currentColor" />)}
  </svg>
    {editor && selected && <PanelTrigger open anchor={{ left: editor.left, top: editor.top, bottom: editor.top, width: 0 }} panelWidth="content" panelPadding="content"
      onOpenChange={open => { if (!open) { cancel(); setEditor(undefined) } }} renderPanel={() => <div className="w-56">
        <VideoEditKeyframeInterpolation label={key === 'volume' ? '音量' : '不透明度'} interpolation={selected.interpolation} bezier={selected.bezier}
          onBegin={() => { try { easing.current ??= beginVideoEditGesture(projectId) } catch (error) { onError(error) } }}
          onFinish={() => { const handle = easing.current; easing.current = undefined; if (handle) finishVideoEditGesture(handle) }} onCancel={cancel}
          onChange={changes => { try { updateVideoEditClipKeyframes(projectId, sequenceId, clip.id, key, putVideoEditKeyframe(points, { ...selected, ...changes, easeRange: undefined, easeValues: undefined }), easing.current) } catch (error) { cancel(); onError(error) } }} />
      </div>} />}
  </>
}
