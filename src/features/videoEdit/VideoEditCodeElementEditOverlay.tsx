import { UI_ICON_SIZE } from '@/core/theme/icons'
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { EyeOff, FileCode, MessageSquare, RotateCcw, RotateCw, CornerUpLeft } from 'lucide-react'
import { UiIconButton, UiSwitch, UiLoading, UiError } from '@/components/ui'
import { useVideoEditCodeMetadata } from './panels/useVideoEditCodeMetadata'
import ContextMenu from '@/components/ContextMenu'
import { useContextMenu } from '@/hooks/useContextMenu'
import { codeElementAuthorPoint } from '@/core/videoEdit/codeElementSelection'
import { codeElementMoveDelta, codeElementOrientedPolygon, codeTextDrawPlacement, codeTextPlacementDistance, resizeCodeElement, rotateCodeElement, snapCodeElementMove, type CodeEditPoint, type CodeTextPlacement } from '@/core/videoEdit/codeElementManipulation'
import { codeAuthorTextMaxLength, type CodeAuthorTextBinding, type CodeAuthorTextTarget } from '@/core/videoEdit/codeAuthorTextBinding'
import type { TextStyle } from '@/core/imaging/vectorContent/text'
import { readCodeElementOverride, type CodeElementOverrideValues } from '@/core/videoEdit/codeElementOverrides'
import { readVideoEditCodeElementEdit, updateVideoEditCodeElement, setVideoEditCodeElementText, resetVideoEditCodeElement, askAssistantForVideoEditCodeElement, bakeVideoEditCodeElement, showVideoEditCodeElementSource, setVideoEditCodeElementAutoKeyframes, type VideoEditCodeElementTarget } from './application/videoEditCodeElementEditing'
import { handleVideoEditElementEffectDragOver, handleVideoEditElementEffectDrop } from './panels/videoEditEffectDrag'
import { pickVideoEditProgram, selectVideoEditCodeElement, videoEditCodeElementFrames, type selectedVideoEditCodeElement } from './application/videoEditCodeElements'
import { beginVideoEditGesture, finishVideoEditGesture, getActiveVideoEditSequence, setVideoEditView, type VideoEditGesture, type VideoEditInstance } from './application/videoEditService'
import { VideoEditInlineTextEditor } from './VideoEditInlineTextEditor'
import { editVideoEditCodeElementLiteral } from './application/videoEditCodeLiteralEditing'
import { VideoEditCodeElementEditBar } from './VideoEditCodeElementEditBar'

type Selection = NonNullable<ReturnType<typeof selectedVideoEditCodeElement>>
interface Drag {
  mode: 'move' | 'resize' | 'rotate'; corner: number; target: VideoEditCodeElementTarget; selected: Selection
  values: CodeElementOverrideValues; start: CodeEditPoint; author: CodeEditPoint; time: ReturnType<typeof readVideoEditCodeElementEdit>['time']
  gesture?: VideoEditGesture; handle: HTMLElement | SVGElement; pointerId: number; rect: DOMRect
}
/** 一次原地改字：`index` 是元素上第几段绘制文字；改字后画面重排，按同一下标读回新位置，读不到时留在原处。 */
interface TextEdit {
  target: VideoEditCodeElementTarget; index: number; binding?: CodeAuthorTextBinding; initial: string; value: string
  caret?: { x: number; y: number }; time: Drag['time']; placement: CodeTextPlacement; style?: TextStyle; fontSize: number; wrap: boolean; maxLength?: number
  gesture?: VideoEditGesture
}
/**
 * 逐字动画每字一层，改字数时后面的字层会消失：改这种字时先改选同一段字的第一个字层，换选中会重建变换层，由新层接着进入编辑。
 */
let pendingTextEdit: { document: object; frame: number; clipId: string; elementId: string; at?: { client: { x: number; y: number }; frame: CodeEditPoint } } | undefined
/** 绘制观察给出的那段字的放置；没有绘制观察时用元素自身的范围。 */
function textPlacement(selected: Selection, target: CodeAuthorTextTarget | undefined, sequence: ReturnType<typeof getActiveVideoEditSequence>): CodeTextPlacement {
  const bounds = selected.element.author.bounds ?? [selected.element.x, selected.element.y, selected.element.x + selected.element.width, selected.element.y + selected.element.height]
  const draw = target?.draw ?? { box: { x: bounds[0], y: bounds[1], width: bounds[2] - bounds[0], height: bounds[3] - bounds[1] }, inkBounds: null, matrix: [1, 0, 0, 1, 0, 0] as [number, number, number, number, number, number] }
  return codeTextDrawPlacement(selected.element, draw, selected.entry.clip, selected.entry.picture, sequence)
}
/** Edit chrome remains outside the renderer: exports contain the evaluated overrides, never handles or input. */
export function VideoEditCodeElementEditOverlay({ instance, selected, onError }: { instance: VideoEditInstance; selected: Selection; onError: (error: unknown) => void }): React.ReactElement {
  const root = useRef<HTMLDivElement>(null); const drag = useRef<Drag>(); const nudge = useRef<VideoEditGesture>()
  const [guides, setGuides] = useState<{ x?: number; y?: number }>({})
  const [text, setTextState] = useState<TextEdit>(); const textRef = useRef<TextEdit>()
  const setText = (value: TextEdit | undefined): void => { textRef.current = value; setTextState(value) }
  const [size, setSize] = useState({ width: 0, height: 0 })
  const pending = useRef<AbortController>(); const [busy, setBusy] = useState(false)
  const menu = useContextMenu()
  const { hideMenu } = menu
  const sequence = getActiveVideoEditSequence(instance)
  const target: VideoEditCodeElementTarget = { projectId: instance.document.id, sequenceId: sequence.id, clipId: selected.entry.clip.id, versionId: selected.entry.clip.code!.versionId, elementId: selected.element.elementId }
  const scope = JSON.stringify(target)
  const metadata = useVideoEditCodeMetadata(instance, selected.entry.clip.code)
  const points = codeElementOrientedPolygon(selected.element, selected.entry.clip, selected.entry.picture, sequence)
  const finish = (commit: boolean): void => {
    const current = drag.current; drag.current = undefined; setGuides({})
    if (current?.gesture) { try { finishVideoEditGesture(current.gesture, commit) } catch (error) { finishVideoEditGesture(current.gesture, false); onError(error) } }
    if (current?.handle.hasPointerCapture?.(current.pointerId)) current.handle.releasePointerCapture(current.pointerId)
  }
  const endNudge = (commit: boolean): void => { const handle = nudge.current; nudge.current = undefined; if (handle) { try { finishVideoEditGesture(handle, commit) } catch (error) { finishVideoEditGesture(handle, false); onError(error) } } }
  useEffect(() => () => { const current = drag.current; drag.current = undefined; if (current?.gesture) finishVideoEditGesture(current.gesture, false); if (nudge.current) finishVideoEditGesture(nudge.current, false); nudge.current = undefined; pending.current?.abort() }, [scope, instance.frame])
  // 切帧或换元素时正在改的字照常提交（与失去焦点一致）。
  const endTextRef = useRef(endText); endTextRef.current = endText
  useEffect(() => () => { endTextRef.current(true) }, [scope, instance.frame])
  useEffect(() => { hideMenu() }, [scope, instance.frame, hideMenu])
  const editing = Boolean(text)
  useLayoutEffect(() => {
    const element = root.current
    if (!editing || !element) return
    const measure = (): void => { const rect = element.getBoundingClientRect(); setSize(previous => previous.width === rect.width && previous.height === rect.height ? previous : { width: rect.width, height: rect.height }) }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure); observer.observe(element)
    return () => observer.disconnect()
  }, [editing])
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
            if (element.elementId === current.target.elementId && entry.clip.id === current.target.clipId || element.opacity < .01) continue
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
    if (tapped) { try { tap(framePoint(current.rect, event.clientX, event.clientY), event.altKey) } catch (error) { onError(error) } }
  }
  /** 选框按图层声明的范围画，常比画出来的东西大：轻点处若不是这个元素画的，改选点处真正看得到的东西；Alt 或元素没有字可改时在重叠的元素间轮换。 */
  const tap = (at: CodeEditPoint, alt: boolean): void => {
    const here = pickVideoEditProgram(instance, at)
    const onSelected = here?.hits.some(hit => hit.clip.id === target.clipId && hit.element.elementId === target.elementId)
    if (onSelected && !alt && readVideoEditCodeElementEdit(target).textTargets.length) return
    const next = onSelected ? pickVideoEditProgram(instance, at, true) : here
    if (next?.clip.kind === 'text') return
    if (next?.element) selectVideoEditCodeElement(instance, next.clip.id, next.element.elementId)
    else if (next?.clip.kind === 'code') selectVideoEditCodeElement(instance, next.clip.id, null)
    else setVideoEditView(instance.document.id, { selection: next?.clip.id ?? null, selectedCodeElement: null })
  }
  /** 双击处最近的一段字（Enter 或编辑条按钮取能直接改的第一段）进入原地编辑。 */
  const editText = (at?: { client: { x: number; y: number }; frame: CodeEditPoint }): void => {
    finish(true); endNudge(true); endText(true)
    const current = readVideoEditCodeElementEdit(target, true)
    const targets = current.textTargets
    if (!targets.length) return
    const placements = targets.map(item => textPlacement(selected, item, sequence))
    const index = at ? placements.reduce((best, placement, i) => codeTextPlacementDistance(placement, at.frame) < codeTextPlacementDistance(placements[best], at.frame) ? i : best, 0) : Math.max(0, targets.findIndex(item => item.binding))
    const item = targets[index]
    const layoutId = item.draw?.layoutId
    const first = layoutId && current.entry?.index.bounds.find(bound => bound.author.textDraws?.some(draw => draw.layoutId === layoutId))
    if (first && first.elementId !== target.elementId) {
      pendingTextEdit = { document: instance.document, frame: instance.frame, clipId: target.clipId, elementId: first.elementId, at }
      selectVideoEditCodeElement(instance, target.clipId, first.elementId)
      return
    }
    const styles = current.declarations.filter(parameter => parameter.type === 'textStyle' && current.element?.author.parameterKeys.includes(parameter.key))
    const style = styles.length === 1 ? current.parameters[styles[0].key] as TextStyle : undefined
    const placement = placements[index]
    const fontSize = item.draw?.fit?.fontSize ?? style?.fontSize ?? placement.height / Math.max(1, item.draw?.actualLines ?? 1) / 1.25
    const rect = root.current?.getBoundingClientRect(); if (rect) setSize({ width: rect.width, height: rect.height })
    setText({ target, index, binding: item.binding, initial: item.text, value: item.text, caret: at?.client, time: current.time, placement, style, fontSize, wrap: Boolean(item.draw?.constraint.width || item.draw?.constraint.maxWidth), maxLength: item.binding ? codeAuthorTextMaxLength(item.binding, current.declarations) : undefined })
  }
  /** 能直接改的字逐字写参数（整次一步撤销）；写死在源码里的字等按 Enter 时改源码。 */
  const typeText = (value: string): void => {
    const edit = textRef.current; if (!edit) return
    edit.value = value
    if (!edit.binding) return
    try {
      edit.gesture ??= beginVideoEditGesture(edit.target.projectId)
      setVideoEditCodeElementText(edit.target, edit.binding, value, { gesture: edit.gesture, time: edit.time })
    } catch (error) { endText(false); onError(error) }
  }
  /**
   * `send`：只有按 Enter 才改写死在源码里的字：源码里唯一一处同文字面量直接改掉，找不到唯一出处才交给助手（会调用模型）。
   * 失焦、切帧只结束编辑。改回原文的不留手改记录。
   */
  function endText(commit: boolean, send = false): void {
    const edit = textRef.current; if (!edit) return
    setText(undefined)
    if (edit.gesture) { try { finishVideoEditGesture(edit.gesture, commit && edit.value !== edit.initial) } catch (error) { finishVideoEditGesture(edit.gesture, false); onError(error) } }
    if (!send || edit.binding || edit.value === edit.initial) return
    if (pending.current) { onError(new Error('上一条交给助手的请求还在准备画面，请稍后再按 Enter。')); return }
    requestAssistant(`把元素「${selected.element.author.name}」里的文字「${edit.initial}」改成「${edit.value}」，并把这段文字写成 text 参数（同时加 textStyle 参数），用 layer 绑定到这个图层，以后可以在画面上直接改。`, false, { before: edit.initial, after: edit.value })
  }
  const run = (operation: () => void): void => { try { finish(true); endNudge(true); operation() } catch (error) { onError(error) } }
  /** `literal`：先试着直接改源码里的这处字，改不了再交给助手。 */
  function requestAssistant(request?: string, bake = false, literal?: { before: string; after: string }): void {
    if (pending.current) return
    const controller = new AbortController(); pending.current = controller; setBusy(true)
    const ask = (): Promise<unknown> => bake ? bakeVideoEditCodeElement(target, controller.signal) : askAssistantForVideoEditCodeElement(target, { request }, controller.signal)
    void (literal ? editVideoEditCodeElementLiteral(target, literal.before, literal.after, controller.signal).then(done => done || ask()) : ask()).catch(error => { if (!controller.signal.aborted) onError(error) }).finally(() => { if (pending.current === controller) { pending.current = undefined; setBusy(false) } })
  }
  useEffect(() => {
    const handoff = pendingTextEdit
    if (!metadata.ready || !handoff) return
    pendingTextEdit = undefined
    // 交接后画面或文档变了（没能挂出新层、用户已去做别的）就作废，免得以后选中时意外进入改字。
    if (handoff.clipId !== target.clipId || handoff.elementId !== target.elementId || handoff.document !== instance.document || handoff.frame !== instance.frame) return
    run(() => editText(handoff.at))
    // 只在换到这个字层、参数读好时接手一次。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metadata.ready])
  const cornerStyle = (point: CodeEditPoint) => ({ left: `${point.x * 100}%`, top: `${point.y * 100}%` })
  const rotationPoint = { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 }
  // 源码版本刚换、元素暂时读不到时只是不显示编辑条；选框与拖动照常。
  let barState: ReturnType<typeof readVideoEditCodeElementEdit> | undefined
  try { barState = metadata.ready ? readVideoEditCodeElementEdit(target, true) : undefined } catch { barState = undefined }
  if (metadata.error) return <UiError title="代码参数读取失败" message={metadata.error instanceof Error ? metadata.error.message : '请恢复源码文件后重试。'} onRetry={metadata.retry} />
  if (!metadata.ready) return <UiLoading message="正在读取代码参数…" />
  return <div ref={root} tabIndex={0} aria-label="代码元素变换层" data-code-element-edit className="pointer-events-none absolute inset-0 outline-none" onPointerMove={move} onPointerUp={up} onPointerCancel={event => { if (event.pointerId === drag.current?.pointerId) finish(false) }} onLostPointerCapture={event => { if (drag.current && event.pointerId === drag.current.pointerId) finish(false) }}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) { finish(false); endNudge(true) } }}
    onKeyDown={event => {
      // 编辑条的参数浮层渲染在别处，按键经 React 冒泡上来，只处理变换层自己 DOM 里的按键。
      if (!event.currentTarget.contains(event.target as Node) || (event.target as Element).closest('input,textarea,[role="textbox"]')) return
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finish(false); endNudge(false); return }
      if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); run(() => editText()); return }
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
      <polygon data-code-element-edit-body data-code-element-selected points={points.map(point => `${point.x * 1000},${point.y * 1000}`).join(' ')} className="pointer-events-auto cursor-move fill-transparent stroke-accent" strokeWidth={2} vectorEffect="non-scaling-stroke" onPointerDown={event => start(event, 'move')} onDragOver={event => { handleVideoEditElementEffectDragOver(event, target.projectId) }} onDrop={event => { handleVideoEditElementEffectDrop(event, target, onError) }} onDoubleClick={event => { event.stopPropagation(); const rect = root.current!.getBoundingClientRect(); run(() => editText({ client: { x: event.clientX, y: event.clientY }, frame: framePoint(rect, event.clientX, event.clientY) })) }} onContextMenu={event => menu.showMenu(event, [
        { id: 'ask', label: '让助手改这里', icon: <MessageSquare size={UI_ICON_SIZE.sm} />, disabled: busy, onClick: () => run(() => requestAssistant()) },
        { id: 'hide', label: '隐藏元素', icon: <EyeOff size={UI_ICON_SIZE.sm} />, onClick: () => run(() => updateVideoEditCodeElement(target, { hidden: true })) },
        { id: 'reset', label: '重置该元素的覆盖', icon: <RotateCcw size={UI_ICON_SIZE.sm} />, onClick: () => run(() => resetVideoEditCodeElement(target)) },
        { id: 'bake', label: busy ? '正在准备画面' : '写回源码', icon: <CornerUpLeft size={UI_ICON_SIZE.sm} />, disabled: busy || !readCodeElementOverride(selected.entry.clip.elementOverrides, target.elementId), onClick: () => run(() => requestAssistant(undefined, true)) },
        { id: 'source', label: '在源码中查看', icon: <FileCode size={UI_ICON_SIZE.sm} />, onClick: () => run(() => showVideoEditCodeElementSource(target)) },
      ])} />
      {guides.x !== undefined && <line data-code-element-guide="x" x1={guides.x * 1000} x2={guides.x * 1000} y1={0} y2={1000} className="stroke-accent" vectorEffect="non-scaling-stroke" />}
      {guides.y !== undefined && <line data-code-element-guide="y" y1={guides.y * 1000} y2={guides.y * 1000} x1={0} x2={1000} className="stroke-accent" vectorEffect="non-scaling-stroke" />}
    </svg>
    {!text && <>{points.map((point, corner) => <UiIconButton key={corner} size="2xs" aria-label={`缩放元素角${corner + 1}`} className="pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2" style={cornerStyle(point)} onPointerDown={event => start(event, 'resize', corner)}><span className="h-1 w-1 bg-current" /></UiIconButton>)}
      <UiIconButton size="xs" aria-label="旋转元素" className="pointer-events-auto absolute -translate-x-1/2 -translate-y-full" style={cornerStyle(rotationPoint)} onPointerDown={event => start(event, 'rotate')}><RotateCw  /></UiIconButton></>}
    {text && (() => {
      // 改字后画面重排：按同一段的新位置摆放编辑框，读不到（比如字删空了）时留在上一次的位置。
      let placement = text.placement
      try { const item = readVideoEditCodeElementEdit(text.target, true).textTargets[text.index]; if (item?.draw) placement = textRef.current!.placement = textPlacement(selected, item, sequence) } catch { /* 元素暂时读不到：沿用上一次的位置 */ }
      const { width: w, height: h } = size, style = text.style
      return <VideoEditInlineTextEditor key={`${text.target.elementId}:${text.index}`} text={text.initial} caret={text.caret} maxLength={text.maxLength} transparent={Boolean(text.binding)}
        ariaLabel={text.binding ? '原地编辑代码文字' : '原地编辑写在源码里的文字'} className={`pointer-events-auto absolute left-0 top-0 ${text.binding ? '' : 'bg-media-scrim text-on-media'}`}
        style={{ ...(text.wrap ? { width: placement.width } : { minWidth: placement.width }), minHeight: placement.height, transformOrigin: '0 0', transform: `matrix(${placement.u.x * w}, ${placement.u.y * h}, ${placement.v.x * w}, ${placement.v.y * h}, ${placement.origin.x * w}, ${placement.origin.y * h})`,
          whiteSpace: text.wrap ? 'pre-wrap' : 'pre', fontFamily: style?.fontFamily ?? 'sans-serif', fontWeight: style?.fontWeight, fontStyle: style?.fontStyle, fontSize: text.fontSize, lineHeight: `${style?.leading || text.fontSize * 1.25}px`,
          letterSpacing: style ? `${style.tracking / 1000}em` : undefined, textAlign: style ? (style.align.startsWith('justify') ? 'justify' : style.align as 'left' | 'center' | 'right') : 'left' }}
        onText={typeText} onEnter={() => endText(true, true)} onEscape={() => endText(false)} onBlur={() => { if (text.binding || textRef.current?.value === text.initial) endText(true) }} />
    })()}
    {!text && !drag.current && barState && <VideoEditCodeElementEditBar target={target} current={barState} polygon={points} busy={busy} onEditText={() => run(() => editText())} onAsk={request => run(() => requestAssistant(request))} onError={onError} />}
    <ContextMenu surface="glass" items={menu.menuItems} position={menu.menuPosition} visible={menu.menuVisible} onClose={menu.hideMenu} />
    <div className="pointer-events-auto absolute right-2 top-2 flex items-center gap-2 rounded-control bg-media-scrim px-2 py-1 text-xs text-on-media"><span>自动关键帧</span><UiSwitch aria-label="元素自动关键帧" checked={['dx', 'dy', 'scaleX', 'scaleY', 'rotation'].every(key => Boolean(readCodeElementOverride(selected.entry.clip.elementOverrides, target.elementId)?.curves?.[key as 'dx']))} onCheckedChange={enabled => run(() => setVideoEditCodeElementAutoKeyframes(target, enabled))} /></div>
  </div>
}
