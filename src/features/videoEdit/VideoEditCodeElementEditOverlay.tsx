import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { EyeOff, FileCode, MessageSquare, RotateCcw, RotateCw, CornerUpLeft } from 'lucide-react'
import { UiIconButton, UiTextAreaField, UiSwitch } from '@/components/ui'
import ContextMenu from '@/components/ContextMenu'
import { useContextMenu } from '@/hooks/useContextMenu'
import { codeElementAuthorPoint } from '@/core/videoEdit/codeElementSelection'
import { codeElementMoveDelta, codeElementOrientedPolygon, resizeCodeElement, rotateCodeElement, snapCodeElementMove, type CodeEditPoint } from '@/core/videoEdit/codeElementManipulation'
import { readCodeElementOverride, type CodeElementOverrideValues } from '@/core/videoEdit/codeElementOverrides'
import { readVideoEditCodeElementEdit, updateVideoEditCodeElement, resetVideoEditCodeElement, askAssistantForVideoEditCodeElement, bakeVideoEditCodeElement, showVideoEditCodeElementSource, setVideoEditCodeElementAutoKeyframes, type VideoEditCodeElementTarget } from './application/videoEditCodeElementEditing'
import { hitVideoEditCodeElement, selectVideoEditCodeElement, videoEditCodeElementFrames, type selectedVideoEditCodeElement } from './application/videoEditCodeElements'
import { beginVideoEditGesture, finishVideoEditGesture, getActiveVideoEditSequence, type VideoEditGesture, type VideoEditInstance } from './application/videoEditService'

type Selection = NonNullable<ReturnType<typeof selectedVideoEditCodeElement>>
interface Drag {
  mode: 'move' | 'resize' | 'rotate'; corner: number; target: VideoEditCodeElementTarget; selected: Selection
  values: CodeElementOverrideValues; start: CodeEditPoint; author: CodeEditPoint; time: ReturnType<typeof readVideoEditCodeElementEdit>['time']
  gesture?: VideoEditGesture; handle: HTMLElement | SVGElement; pointerId: number; rect: DOMRect
}
/** Edit chrome remains outside the renderer: exports contain the evaluated overrides, never handles or input. */
export function VideoEditCodeElementEditOverlay({ instance, selected, onError }: { instance: VideoEditInstance; selected: Selection; onError: (error: unknown) => void }): React.ReactElement {
  const root = useRef<HTMLDivElement>(null); const drag = useRef<Drag>(); const nudge = useRef<VideoEditGesture>()
  const [guides, setGuides] = useState<{ x?: number; y?: number }>({})
  const [text, setText] = useState<{ target: VideoEditCodeElementTarget; value: string; time: Drag['time'] }>()
  const pending = useRef<AbortController>(); const [busy, setBusy] = useState(false)
  const menu = useContextMenu()
  const { hideMenu } = menu
  const sequence = getActiveVideoEditSequence(instance)
  const target: VideoEditCodeElementTarget = { projectId: instance.document.id, sequenceId: sequence.id, clipId: selected.entry.clip.id, versionId: selected.entry.clip.code!.versionId, elementId: selected.element.elementId }
  const scope = JSON.stringify(target)
  const points = codeElementOrientedPolygon(selected.element, selected.entry.clip, selected.entry.picture, sequence)
  const finish = (commit: boolean): void => {
    const current = drag.current; drag.current = undefined; setGuides({})
    if (current?.gesture) { try { finishVideoEditGesture(current.gesture, commit) } catch (error) { finishVideoEditGesture(current.gesture, false); onError(error) } }
    if (current?.handle.hasPointerCapture?.(current.pointerId)) current.handle.releasePointerCapture(current.pointerId)
  }
  const endNudge = (commit: boolean): void => { const handle = nudge.current; nudge.current = undefined; if (handle) { try { finishVideoEditGesture(handle, commit) } catch (error) { finishVideoEditGesture(handle, false); onError(error) } } }
  useEffect(() => () => { const current = drag.current; drag.current = undefined; if (current?.gesture) finishVideoEditGesture(current.gesture, false); if (nudge.current) finishVideoEditGesture(nudge.current, false); nudge.current = undefined; pending.current?.abort() }, [scope, instance.frame])
  useEffect(() => { setText(undefined); hideMenu() }, [scope, instance.frame, hideMenu])
  const framePoint = (rect: DOMRect, x: number, y: number): CodeEditPoint => ({ x: (x - rect.left) / Math.max(1, rect.width), y: (y - rect.top) / Math.max(1, rect.height) })
  const start = (event: ReactPointerEvent<HTMLElement | SVGElement>, mode: Drag['mode'], corner = 0): void => {
    if (event.button !== 0 || drag.current || instance.playing || instance.tool !== 'select') return
    event.stopPropagation(); event.preventDefault()
    try {
      endNudge(true); setText(undefined)
      const rect = root.current!.getBoundingClientRect(); const at = framePoint(rect, event.clientX, event.clientY)
      const current = readVideoEditCodeElementEdit(target)
      drag.current = { mode, corner, target, selected, values: current.values, start: at, author: codeElementAuthorPoint(selected.entry.clip, selected.entry.picture, sequence, at), time: current.time, handle: event.currentTarget, pointerId: event.pointerId, rect }
      event.currentTarget.setPointerCapture?.(event.pointerId); root.current?.focus({ preventScroll: true })
    } catch (error) { onError(error) }
  }
  const move = (event: ReactPointerEvent): void => {
    const current = drag.current; if (!current || event.pointerId !== current.pointerId) return
    event.stopPropagation(); event.preventDefault()
    if (!current.gesture && Math.hypot((framePoint(current.rect, event.clientX, event.clientY).x - current.start.x) * current.rect.width, (framePoint(current.rect, event.clientX, event.clientY).y - current.start.y) * current.rect.height) < 2) return
    try {
      current.gesture ??= beginVideoEditGesture(target.projectId)
      let at = framePoint(current.rect, event.clientX, event.clientY)
      let patch: CodeElementOverrideValues
      if (current.mode === 'move') {
        let delta = { x: at.x - current.start.x, y: at.y - current.start.y }
        if (instance.snapping && !event.altKey) {
          const targets = { x: [.05, .5, .95], y: [.05, .5, .95] }
          for (const entry of videoEditCodeElementFrames(instance).values()) for (const element of entry.index.bounds) {
            if (element.elementId === current.target.elementId && entry.clip.id === current.target.clipId || element.opacity < .01 || element.command.kind === 'group') continue
            const polygon = codeElementOrientedPolygon(element, entry.clip, entry.picture, sequence)
            targets.x.push(Math.min(...polygon.map(point => point.x)), Math.max(...polygon.map(point => point.x)))
            targets.y.push(Math.min(...polygon.map(point => point.y)), Math.max(...polygon.map(point => point.y)))
          }
          const snapped = snapCodeElementMove(codeElementOrientedPolygon(current.selected.element, current.selected.entry.clip, current.selected.entry.picture, sequence), delta, targets, { x: 6 / current.rect.width, y: 6 / current.rect.height })
          delta = snapped.delta; setGuides(snapped.guides)
        } else setGuides({})
        at = { x: current.start.x + delta.x, y: current.start.y + delta.y }
        const amount = codeElementMoveDelta(current.selected.element, current.author, codeElementAuthorPoint(current.selected.entry.clip, current.selected.entry.picture, sequence, at))
        patch = { dx: (current.values.dx ?? 0) + amount.x, dy: (current.values.dy ?? 0) + amount.y }
      } else {
        const author = codeElementAuthorPoint(current.selected.entry.clip, current.selected.entry.picture, sequence, at)
        patch = current.mode === 'resize' ? resizeCodeElement(current.selected.element, current.values, current.corner, author, event.shiftKey) : { rotation: rotateCodeElement(current.selected.element, current.values, current.author, author, event.shiftKey) }
      }
      updateVideoEditCodeElement(current.target, patch, { gesture: current.gesture, time: current.time })
    } catch (error) { finish(false); onError(error) }
  }
  const up = (event: ReactPointerEvent): void => {
    const current = drag.current; if (!current || event.pointerId !== current.pointerId) return
    event.stopPropagation(); event.preventDefault()
    const tapped = !current.gesture && current.mode === 'move'
    finish(true)
    if (tapped && (event.altKey || current.selected.element.command.kind !== 'text')) { const hit = hitVideoEditCodeElement(instance, framePoint(current.rect, event.clientX, event.clientY), true); if (hit) selectVideoEditCodeElement(instance, hit.clipId, hit.element.elementId) }
  }
  const editText = (): void => {
    if (selected.element.command.kind !== 'text') return
    finish(true); endNudge(true)
    const current = readVideoEditCodeElementEdit(target)
    setText({ target, value: selected.element.command.text, time: current.time })
  }
  const run = (operation: () => void): void => { try { finish(true); endNudge(true); operation() } catch (error) { onError(error) } }
  const bake = (): void => {
    if (pending.current) return
    const controller = new AbortController(); pending.current = controller; setBusy(true)
    void bakeVideoEditCodeElement(target, controller.signal).catch(error => { if (!controller.signal.aborted) onError(error) }).finally(() => { if (pending.current === controller) { pending.current = undefined; setBusy(false) } })
  }
  const cornerStyle = (point: CodeEditPoint) => ({ left: `${point.x * 100}%`, top: `${point.y * 100}%` })
  const rotationPoint = { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 }
  return <div ref={root} tabIndex={0} aria-label="代码元素变换层" data-code-element-edit className="pointer-events-none absolute inset-0 outline-none" onPointerMove={move} onPointerUp={up} onPointerCancel={event => { if (event.pointerId === drag.current?.pointerId) finish(false) }} onLostPointerCapture={event => { if (drag.current && event.pointerId === drag.current.pointerId) finish(false) }}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) { finish(false); endNudge(true) } }}
    onKeyDown={event => {
      if ((event.target as Element).closest('input,textarea,[role="textbox"]')) return
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finish(false); endNudge(false); return }
      if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); run(editText); return }
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key) || event.ctrlKey || event.metaKey) return
      event.preventDefault(); event.stopPropagation()
      try {
        nudge.current ??= beginVideoEditGesture(target.projectId)
        const current = readVideoEditCodeElementEdit(target); const amount = event.shiftKey ? 10 : 1
        const delta = codeElementMoveDelta(selected.element, { x: 0, y: 0 }, { x: event.key === 'ArrowLeft' ? -amount : event.key === 'ArrowRight' ? amount : 0, y: event.key === 'ArrowUp' ? -amount : event.key === 'ArrowDown' ? amount : 0 })
        updateVideoEditCodeElement(target, { dx: (current.values.dx ?? 0) + delta.x, dy: (current.values.dy ?? 0) + delta.y }, { gesture: nudge.current, time: current.time })
      } catch (error) { endNudge(false); onError(error) }
    }} onKeyUp={event => { if (event.key.startsWith('Arrow')) { event.stopPropagation(); endNudge(true) } }}>
    {/* icon-token-allow: 选框与吸附线由当前作者几何计算，不是图标。 */}
    <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden>
      <polygon data-code-element-edit-body data-code-element-selected points={points.map(point => `${point.x * 1000},${point.y * 1000}`).join(' ')} className="pointer-events-auto cursor-move fill-transparent stroke-accent" strokeWidth={2} vectorEffect="non-scaling-stroke" onPointerDown={event => start(event, 'move')} onDoubleClick={event => { event.stopPropagation(); run(editText) }} onContextMenu={event => menu.showMenu(event, [
        { id: 'ask', label: '让助手改这里', icon: <MessageSquare size={14} />, onClick: () => run(() => askAssistantForVideoEditCodeElement(target)) },
        { id: 'hide', label: '隐藏元素', icon: <EyeOff size={14} />, onClick: () => run(() => updateVideoEditCodeElement(target, { hidden: true })) },
        { id: 'reset', label: '重置该元素的覆盖', icon: <RotateCcw size={14} />, onClick: () => run(() => resetVideoEditCodeElement(target)) },
        { id: 'bake', label: busy ? '正在写回源码' : '写回源码', icon: <CornerUpLeft size={14} />, disabled: busy || !readCodeElementOverride(selected.entry.clip.elementOverrides, target.elementId), onClick: () => run(bake) },
        { id: 'source', label: '在源码中查看', icon: <FileCode size={14} />, onClick: () => run(() => showVideoEditCodeElementSource(target)) },
      ])} />
      {guides.x !== undefined && <line data-code-element-guide="x" x1={guides.x * 1000} x2={guides.x * 1000} y1={0} y2={1000} className="stroke-accent" vectorEffect="non-scaling-stroke" />}
      {guides.y !== undefined && <line data-code-element-guide="y" y1={guides.y * 1000} y2={guides.y * 1000} x1={0} x2={1000} className="stroke-accent" vectorEffect="non-scaling-stroke" />}
    </svg>
    {!text && <>{points.map((point, corner) => <UiIconButton key={corner} size="xs" aria-label={`缩放元素角${corner + 1}`} className="pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2" style={cornerStyle(point)} onPointerDown={event => start(event, 'resize', corner)}><span className="h-1 w-1 bg-current" /></UiIconButton>)}
      <UiIconButton size="sm" aria-label="旋转元素" className="pointer-events-auto absolute -translate-x-1/2 -translate-y-full" style={cornerStyle(rotationPoint)} onPointerDown={event => start(event, 'rotate')}><RotateCw size={14} /></UiIconButton></>}
    {text && <div className="pointer-events-auto absolute min-w-40" style={cornerStyle(points[0])}><UiTextAreaField autoFocus rows={Math.max(1, text.value.split('\n').length)} aria-label="原地编辑代码文字" value={text.value} onChange={event => setText({ ...text, value: event.target.value })} onBlur={() => setText(undefined)} onKeyDown={event => {
      event.stopPropagation()
      if (event.nativeEvent.isComposing) return
      if (event.key === 'Escape') { event.preventDefault(); setText(undefined) }
      if (event.key === 'Enter') { event.preventDefault(); run(() => updateVideoEditCodeElement(text.target, { text: text.value }, { time: text.time })); setText(undefined) }
    }} /></div>}
    <ContextMenu surface="glass" items={menu.menuItems} position={menu.menuPosition} visible={menu.menuVisible} onClose={menu.hideMenu} />
    <div className="pointer-events-auto absolute right-2 top-2 flex items-center gap-2 rounded-control bg-media-scrim px-2 py-1 text-xs text-on-media"><span>自动关键帧</span><UiSwitch aria-label="元素自动关键帧" checked={['dx', 'dy', 'scaleX', 'scaleY', 'rotation'].every(key => Boolean(readCodeElementOverride(selected.entry.clip.elementOverrides, target.elementId)?.curves?.[key as 'dx']))} onCheckedChange={enabled => run(() => setVideoEditCodeElementAutoKeyframes(target, enabled))} /></div>
  </div>
}
