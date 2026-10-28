import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { ChevronDown, ChevronRight, Diamond, Scissors, TriangleAlert } from 'lucide-react'
import { UiButton, UiIconButton } from '@/components/ui'
import Tooltip from '@/components/ui/Tooltip'
import type { VideoEditClip, VideoEditSequence } from '@/core/videoEdit/document'
import { videoEditClipFrameAtSource, videoEditClipFrameBoundaryAtSource, videoEditClipSourceRange, videoEditClipSourceSecondsAtTime } from '@/core/videoEdit/clipSpeed'
import type { CodeSceneKindDeclaration } from '@/core/videoEdit/scene/sceneDeclaration'
import { videoEditSceneAnchorAt, videoEditSceneLanes, videoEditSceneLaneVisibleItems, type VideoEditSceneLaneGroup, type VideoEditSceneLaneItem, type VideoEditSceneLaneRow, type VideoEditSceneLanes } from '@/core/videoEdit/scene/sceneLanes'
import { videoEditSceneMedia } from '@/core/videoEdit/scene/sceneMedia'
import type { ResolvedVideoEditScene } from '@/core/videoEdit/scene/sceneResolve'
import type { VideoEditScene } from '@/core/videoEdit/scene/sceneSchema'
import { useRafCallback } from '@/hooks/useRafCallback'
import { requestAlertConfirmation } from '@/stores/alertDialogStore'
import { ownerWindowOf } from '@/utils/crossRealmDom'
import { applyVideoEditSceneChanges, previewVideoEditSceneGesture, resolveVideoEditSceneView, VideoEditSceneRejection, writeVideoEditScene, type VideoEditSceneChange, type VideoEditSceneDeclarationState, type VideoEditSceneWriteContext } from '../application/videoEditScenes'
import { selectedVideoEditSceneRecord, selectVideoEditSceneRecord, subscribeVideoEditSceneSelection, videoEditSceneSelectionVersion } from '../application/videoEditSceneSelection'
import { beginVideoEditGesture, finishVideoEditGesture, setVideoEditView, videoEditCommittedDocument, type VideoEditGesture, type VideoEditInstance } from '../application/videoEditService'
import { videoEditSceneNamingFor } from '../panels/videoEditSceneNaming'
import { KEYFRAME_LANE_HEADER, KEYFRAME_LANE_ROW } from './keyframeLaneGeometry'
import { clearTimelineSnap, snapTimelineEdges, timelineSnapPoints, TIMELINE_SNAP_PIXELS } from './timelineSnap'
import { TIMELINE_HEADER_WIDTH, timelineTimecode, type TimelineViewport } from './timelineGeometry'

interface Props {
  instance: VideoEditInstance; sequence: VideoEditSequence; trackName: string; locked: boolean
  sceneId: string; clips: readonly VideoEditClip[]; state: VideoEditSceneDeclarationState | undefined
  /** 这条轨道上的片段还引用了别的片子数据（子轨道只显示第一份）。 */
  otherScenes: boolean
  collapsed: ReadonlySet<string>; onToggleGroup: (kind: string) => void
  top: number; height: number; pixels: number; fps: number; view: TimelineViewport
  onError: (error: unknown) => void
  /** 拖动中不能落下的原因（时间线顶部的状态提示）；null 收起。 */
  onFailure: (text: string | null) => void
}
/** 显示出来的一个子行：展开的组每个子行一行，收起的组把全部子行叠成一行。 */
interface DisplayRow { readonly group: VideoEditSceneLaneGroup; readonly rows: readonly VideoEditSceneLaneRow[]; readonly first: boolean; readonly label: string }
type DragMode = 'move' | 'start' | 'end' | 'hold'
interface Gesture {
  readonly handle: VideoEditGesture; readonly base: VideoEditScene; readonly baseResolved: ResolvedVideoEditScene
  /** 被改的记录：拖“停多久”时是下一项。 */
  readonly recordId: string
  /** 被改记录在手势开始时的剪后起止（拖“停多久”时是下一项的开始）与下限。 */
  readonly at: number; readonly end: number; readonly floor: number
  readonly edgeFrames: readonly number[]
  last?: readonly VideoEditSceneChange[]; rejected?: unknown
}
interface Drag { readonly pointerId: number; readonly mode: DragMode; readonly clip: VideoEditClip; readonly recordId: string; readonly startX: number; gesture?: Gesture }
/** 按录屏秒锚定的落点找不到唯一保留画面时的拒绝（与写入校验的拒绝一样，保留上一个合法预览）。 */
class AnchorRejection extends Error {}
const EDGE = 1e-6
/** 按下后移动超过这么多像素才算拖动；没越过只算点选，不开手势、不写回。 */
const DRAG_THRESHOLD_PX = 3
const isAnchor = (value: unknown): boolean => Boolean(value && typeof value === 'object' && !Array.isArray(value) && 'src' in value)
const draggableKind = (kind: CodeSceneKindDeclaration | undefined): boolean => Boolean(kind?.at) && kind?.role !== 'cut'

function laneItems(lanes: VideoEditSceneLanes): Map<string, VideoEditSceneLaneItem> {
  const items = new Map<string, VideoEditSceneLaneItem>()
  for (const group of lanes.groups) for (const row of group.rows) for (const item of row.items) items.set(item.record.id, item)
  return items
}
const itemIndex = new WeakMap<VideoEditSceneLanes, Map<string, VideoEditSceneLaneItem>>()
/** 记录 ID → 子轨道条目，按分行结果的对象身份缓存。 */
function laneItemsOf(lanes: VideoEditSceneLanes): Map<string, VideoEditSceneLaneItem> {
  let items = itemIndex.get(lanes)
  if (!items) { items = laneItems(lanes); itemIndex.set(lanes, items) }
  return items
}
/** 记录在片段上显示的那一帧（读屏名称、双击跳转）：起点在片段外时夹到最近的一端。 */
function itemFrame(clip: VideoEditClip, at: number, fps: number): number {
  const range = videoEditClipSourceRange(clip, fps)
  const t = Math.max(range.from, Math.min(range.to, at))
  return videoEditClipFrameAtSource(clip, t, fps) ?? Math.max(clip.start, Math.min(clip.start + clip.duration - 1, Math.round(videoEditClipFrameBoundaryAtSource(clip, t, fps))))
}

/**
 * 片子数据子轨道（展开代码片段所在的轨道）：左侧是组名与收起开关，右侧按每条引用这份片子数据的片段自己的位置画记录——
 * 段落条、窗口行（窗口内容画在窗口行内）、关键点、剪切口（生效的剪切零宽画剪刀，停用的画虚线区间）。超出片段可见源时间的
 * 夹到片段边缘并画边缘标记。分行与称呼按已提交的数据算，拖动中行不重排、序号不跳。
 * 拖块体改起止、拖边改一侧、拖关键点改开始、拖窗口内容右边缘改下一项的开始（停多久），拖动量按整帧取整。按录屏秒锚定的
 * 开始或结束拖动后保持锚定，按住 Shift 改写成秒数。按帧合并预览，松手经 writeVideoEditScene 按声明校验后一步撤销；
 * Esc 取消，Delete 删除这里显示的选中记录（连同子记录时先确认）。
 */
export function VideoEditSceneLane({ instance, sequence, trackName, locked, sceneId, clips, state, otherScenes, collapsed, onToggleGroup, top, height, pixels, fps, view, onError, onFailure }: Props): React.ReactElement {
  const projectId = instance.document.id
  const root = useRef<HTMLDivElement>(null)
  const drag = useRef<Drag>()
  useSyncExternalStore(subscribeVideoEditSceneSelection, videoEditSceneSelectionVersion)
  const selection = selectedVideoEditSceneRecord(instance)
  const selectedId = selection?.sceneId === sceneId ? selection.recordId : undefined
  const schema = state?.declaration?.schema
  const committed = videoEditCommittedDocument(instance)
  const committedScene = committed.scenes?.find(item => item.id === sceneId)
  const committedMedia = videoEditSceneMedia(committed)
  const committedResolved = committedScene && resolveVideoEditSceneView(committedScene, schema, committedMedia)
  const lanes = committedResolved && videoEditSceneLanes(committedResolved)
  // 拖动中的草稿只改条目位置：分行仍按已提交的结果，行数与左侧行名不变（子轨道高度也按已提交的算）。
  const draftScene = instance.document.scenes?.find(item => item.id === sceneId)
  const draftResolved = draftScene && draftScene !== committedScene ? resolveVideoEditSceneView(draftScene, schema, videoEditSceneMedia(instance.document)) : undefined
  const draftItems = draftResolved ? laneItemsOf(videoEditSceneLanes(draftResolved)) : undefined
  const naming = useMemo(() => videoEditSceneNamingFor(committedScene, state, committedResolved, committedMedia), [committedScene, state, committedResolved, committedMedia])
  const editable = Boolean(schema) && !state?.block && !locked
  const display = useMemo<DisplayRow[]>(() => (lanes?.groups ?? []).flatMap((group): DisplayRow[] => collapsed.has(group.kind)
    ? [{ group, rows: group.rows, first: true, label: '' }]
    : group.rows.map((row, index) => ({ group, rows: [row], first: index === 0, label: row.record ? naming.name(row.record.source) : '' }))), [lanes, collapsed, naming])

  const failureText = (reason: unknown): string => reason instanceof VideoEditSceneRejection ? reason.issues[0] ? naming.issue(reason.issues[0]) : '这次修改不合法。' : reason instanceof Error ? reason.message : String(reason)
  const report = (reason: unknown): void => onError(reason instanceof AnchorRejection ? new Error(`没有改成：${reason.message}`) : naming.error(reason))

  const endDrag = (commit: boolean): void => {
    const current = drag.current?.gesture; drag.current = undefined
    scheduler.cancel(); clearTimelineSnap(); onFailure(null)
    if (!current) return
    if (!commit || current.rejected || !current.last) {
      finishVideoEditGesture(current.handle, false)
      if (commit && current.rejected) report(current.rejected)
      return
    }
    void writeVideoEditScene(projectId, sceneId, current.last, { gesture: current.handle }).catch(report)
  }
  const latestEnd = useRef(endDrag); latestEnd.current = endDrag
  useEffect(() => () => latestEnd.current(false), [])

  /** 越过起拖阈值时开始手势：基准取此刻的片子数据，按下到这时之间别处的修改不会被覆盖。 */
  const beginGesture = (current: Drag): Gesture | undefined => {
    const base = instance.document.scenes?.find(item => item.id === sceneId)
    const baseResolved = base && resolveVideoEditSceneView(base, schema, videoEditSceneMedia(instance.document))
    if (!base || !baseResolved) return undefined
    const baseLanes = videoEditSceneLanes(baseResolved)
    const item = laneItemsOf(baseLanes).get(current.recordId)
    if (!item) return undefined
    const target = current.mode === 'hold' ? item.next && { at: item.next.at, end: item.next.at, floor: item.at, recordId: item.next.record.id } : { at: item.at, end: item.end, floor: 0, recordId: item.record.id }
    if (!target) return undefined
    const range = videoEditClipSourceRange(current.clip, fps)
    const own = new Set([target.at, target.end])
    const edgeFrames = baseLanes.edges.filter(edge => !own.has(edge) && edge >= range.from && edge <= range.to).map(edge => videoEditClipFrameBoundaryAtSource(current.clip, edge, fps))
    const handle = beginVideoEditGesture(projectId)
    return { handle, base, baseResolved, recordId: target.recordId, at: target.at, end: target.end, floor: target.floor, edgeFrames }
  }
  /** 一次拖动样本：整帧位移 → 新的剪后起止（吸附时按吸上的那条边换算） → 修改列表 → 预览。 */
  const preview = (clientX: number, shift: boolean): void => {
    const current = drag.current
    if (!current || !schema || !state) return
    const frames = Math.round((clientX - current.startX) / pixels)
    // 越过起拖阈值、且取整后真有一帧位移时才开手势：手势期间助手的写入会被挡住
    if (!current.gesture && (Math.abs(clientX - current.startX) < DRAG_THRESHOLD_PX || frames === 0)) return
    try {
      current.gesture ??= beginGesture(current)
      if (!current.gesture) { drag.current = undefined; return }
    } catch (reason) { drag.current = undefined; onError(reason); return }
    const gesture = current.gesture
    const record = gesture.base.records.find(item => item.id === gesture.recordId)!
    const kind = schema.kinds[record.kind]
    const spans = Boolean(kind.end || kind.duration)
    const { clip, mode } = current
    const frameOf = (seconds: number): number => videoEditClipFrameBoundaryAtSource(clip, seconds, fps)
    const secondsOf = (frame: number): number => videoEditClipSourceSecondsAtTime(clip, frame / fps, fps)
    let at = gesture.at, end = gesture.end
    if (mode === 'move') { at = Math.max(0, secondsOf(frameOf(gesture.at) + frames)); if (spans) end = gesture.end + (at - gesture.at) }
    else if (mode === 'end') end = Math.max(gesture.at, secondsOf(frameOf(gesture.end) + frames))
    else at = Math.max(gesture.floor, Math.min(spans ? gesture.end : Infinity, secondsOf(frameOf(gesture.at) + frames)))
    // 吸附：吸附点与被拖的边都在帧轴上比较；吸上时只把吸上的那条边落到吸附帧，整条拖动的另一条边按同样的源时间位移跟着走
    const moving = mode === 'end' ? [end] : mode === 'move' && spans ? [at, end] : [at]
    const points = instance.snapping ? timelineSnapPoints(sequence, { playhead: instance.frame, extra: gesture.edgeFrames }) : []
    const offset = snapTimelineEdges(sequence.id, points, moving.map(frameOf), TIMELINE_SNAP_PIXELS / pixels)
    if (offset) {
      const snapped = moving.find(edge => points.some(point => Math.abs(frameOf(edge) + offset - point) < 1e-6)) ?? moving[0]
      const shiftBy = secondsOf(frameOf(snapped) + offset) - snapped
      if (mode === 'end') end += shiftBy
      else { at += shiftBy; if (mode === 'move') end += shiftBy }
    }
    const context: VideoEditSceneWriteContext = { schema, block: state.block, media: videoEditSceneMedia(committed) }
    try {
      if (Math.abs(at - gesture.at) < EDGE && Math.abs(end - gesture.end) < EDGE) {
        // 拖回原处：草稿回到起点，松手时取消手势，不留撤销步与手调标记
        previewVideoEditSceneGesture(gesture.handle, sceneId, gesture.base, [], context)
        gesture.last = undefined; gesture.rejected = undefined; onFailure(null)
        return
      }
      const changes = sceneChanges(gesture, record, kind, mode, at, end, shift, context)
      previewVideoEditSceneGesture(gesture.handle, sceneId, gesture.base, changes, context)
      gesture.last = changes; gesture.rejected = undefined; onFailure(null)
    } catch (reason) {
      if (reason instanceof VideoEditSceneRejection || reason instanceof AnchorRejection) { gesture.rejected = reason; onFailure(failureText(reason)); return }
      endDrag(false); onError(reason)
    }
  }
  const scheduler = useRafCallback(preview, ownerWindowOf(root.current))

  const select = (recordId: string | null): void => { try { selectVideoEditSceneRecord(projectId, recordId ? { sceneId, recordId } : null) } catch (error) { onError(error) } }
  const latest = useRef({ locked, editable }); latest.current = { locked, editable }
  /** 这条记录连同全部子孙（只删父记录会留下指向它的子记录，整笔被拒）。 */
  const subtree = (scene: VideoEditScene, recordId: string): Set<string> => {
    const gone = new Set([recordId])
    for (let grew = true; grew;) { grew = false; for (const record of scene.records) if (record.parent !== undefined && gone.has(record.parent) && !gone.has(record.id)) { gone.add(record.id); grew = true } }
    return gone
  }
  /**
   * 选中的记录此刻显示在这条子轨道上（有条目且落在某条片段的可见源时间里）时才删；连同子记录时先确认。
   * 取舍：只要求子轨道显示着这条记录，不要求它在横向视野里——用户刚点选、随后滚开的记录照样能删，单条也不再确认（可以撤销）。
   * 确认期间数据可能变了（撤销、助手增删子记录）：确认后按当时的数据重新取要删的集合，并重新检查轨道锁定。
   */
  const remove = async (recordId: string): Promise<void> => {
    const item = lanes && laneItemsOf(lanes).get(recordId)
    if (!committedScene || !editable || !item || !draggableKind(schema?.kinds[item.record.kind])) return
    if (!clips.some(clip => { const range = videoEditClipSourceRange(clip, fps); return !clip.frameHold && item.end >= range.from && item.at <= range.to })) return
    const planned = subtree(committedScene, recordId)
    const name = naming.name(item.record.source)
    if (planned.size > 1 && !await requestAlertConfirmation({ title: '删除记录', message: `将删除“${name}”，连同下面 ${planned.size - 1} 条记录一起删除，可以撤销。`, type: 'warning', confirmLabel: '删除', confirmTone: 'danger' })) return
    const now = videoEditCommittedDocument(instance).scenes?.find(scene => scene.id === sceneId)
    if (!now?.records.some(record => record.id === recordId) || !latest.current.editable || latest.current.locked) return
    try { await writeVideoEditScene(projectId, sceneId, [{ kind: 'remove', recordIds: [...subtree(now, recordId)] }]) } catch (reason) { report(reason); return }
    if (selectedVideoEditSceneRecord(instance)?.recordId === recordId) select(null)
  }

  const header = <div className="flex h-8 min-w-0 shrink-0 items-center gap-1.5 overflow-hidden text-2xs">
    <span data-user-content className="min-w-0 truncate text-text2">{committedScene?.name ?? '片子数据'}</span>
    {otherScenes && <span className="shrink-0 text-text3">另有片子数据未显示</span>}
  </div>
  const hint = !sceneId || !committedScene || !clips.length ? '这条轨道上没有使用片子数据的代码片段' : !state ? '正在读取…' : !schema ? naming.block ?? '这份片子数据暂时读不到代码声明' : !display.length ? '这份片子数据没有要在时间线上显示的记录' : undefined
  const viewFrom = view.left / pixels - 2, viewTo = (view.left + view.width - TIMELINE_HEADER_WIDTH) / pixels + 2

  const renderItem = (clip: VideoEditClip, base: VideoEditSceneLaneItem, rowTop: number, range: { from: number; to: number }): React.ReactElement | null => {
    const item = draftItems?.get(base.record.id) ?? base
    const from = Math.max(item.at, range.from), to = Math.min(item.end, range.to)
    if (to < from) return null
    const a = videoEditClipFrameBoundaryAtSource(clip, from, fps), b = videoEditClipFrameBoundaryAtSource(clip, to, fps)
    const reversed = Boolean(clip.reverse)
    const cutBefore = item.at < range.from - EDGE || item.clippedStart, cutAfter = item.end > range.to + EDGE || item.clippedEnd
    const clippedLeft = reversed ? cutAfter : cutBefore, clippedRight = reversed ? cutBefore : cutAfter
    const left = TIMELINE_HEADER_WIDTH + Math.min(a, b) * pixels, width = Math.abs(b - a) * pixels
    const selected = item.record.id === selectedId
    const kind = schema?.kinds[item.record.kind]
    const name = naming.name(item.record.source)
    const userIssue = item.issues.some(issue => issue.severity === 'user')
    const point = item.style === 'key' || item.style === 'cut' && item.cut?.enabled
    const spans = Boolean(kind?.end || kind?.duration)
    const draggable = editable && draggableKind(kind)
    // 开始边在源时间早的一侧，结束边（或“停多久”）在晚的一侧；倒放片段两侧对调
    const edges: Array<{ mode: DragMode; side: 'left' | 'right' }> = draggable && !point && width >= 12 ? [
      ...(spans && !cutBefore ? [{ mode: 'start' as const, side: reversed ? 'right' as const : 'left' as const }] : []),
      ...((spans || kind?.role === 'shot' && item.next) && !cutAfter ? [{ mode: spans ? 'end' as const : 'hold' as const, side: reversed ? 'left' as const : 'right' as const }] : []),
    ] : []
    const cutText = item.cut ? item.cut.enabled ? `剪掉了 ${item.cut.removedDuration.toFixed(2)} 秒` : `停用的剪切：${(item.cut.to - item.cut.from).toFixed(2)} 秒` : ''
    const tooltip = [name, cutText, ...item.issues.map(issue => naming.issue(issue, false))].filter(Boolean).join('\n')
    const frame = itemFrame(clip, item.at, fps)
    const shape = item.style === 'key' ? '!h-4 !w-4 -ml-2 !p-0' : point ? '!h-6 !w-4 -ml-2 !p-0' : item.style === 'block' ? '!h-4 !rounded-md border !px-1' : `!h-5 !rounded-md border !px-1.5 ${item.style === 'cut' ? 'border-dashed' : ''}`
    const tone = point ? selected ? 'text-accent-text' : 'text-text2'
      : selected ? 'border-accent-ring bg-selected text-text1 ring-1 ring-accent-ring'
        : item.style === 'cut' ? 'border-line-strong !bg-transparent text-text3' : item.style === 'row' ? 'border-line !bg-transparent text-text2' : item.style === 'block' ? 'border-line bg-control text-text1' : 'border-line-strong bg-raised text-text1'
    const offsetTop = item.style === 'key' || item.style === 'block' ? 6 : point ? 2 : 4
    return <span key={`${clip.id}:${item.record.id}`} className="pointer-events-auto">
      {/* ui-surface-allow 片子数据记录块：时间轴记号（段落条、窗口内容块、关键点、剪切口），外观随记录样式，不是按钮档位（同关键帧记号） */}
      <UiButton data-ui-timeline-item data-video-edit-scene-item={item.record.id} data-video-edit-scene-clip={clip.id} data-scene-style={item.style} data-clipped={clippedLeft || clippedRight ? [clippedLeft ? 'left' : '', clippedRight ? 'right' : ''].filter(Boolean).join(' ') : undefined}
        size="sm" aria-label={`${name} ${timelineTimecode(frame, fps)}`} aria-pressed={selected} tooltip={tooltip}
        className={`absolute min-w-0 !justify-start overflow-hidden ${shape} ${tone} ${clippedLeft ? '!rounded-l-none' : ''} ${clippedRight ? '!rounded-r-none' : ''} ${draggable ? point ? 'cursor-ew-resize' : 'cursor-grab' : ''}`}
        style={{ left, top: rowTop + offsetTop, ...(point ? {} : { width: Math.max(3, width) }) }}
        onPointerDown={event => {
          event.stopPropagation()
          if (event.button !== 0) return
          select(item.record.id)
          if (!draggable || !schema) return
          const edge = (event.target as Element).closest?.('[data-video-edit-scene-edge]')?.getAttribute('data-video-edit-scene-edge') as DragMode | null
          root.current?.setPointerCapture?.(event.pointerId)
          drag.current = { pointerId: event.pointerId, mode: edge ?? 'move', clip, recordId: item.record.id, startX: event.clientX }
        }}
        onDoubleClick={() => { try { setVideoEditView(projectId, { frame, playing: false }) } catch (error) { onError(error) } }}>
        {item.style === 'key' ? <Diamond fill="currentColor" aria-hidden="true" />
          : point ? <><span aria-hidden="true" className="absolute inset-y-0 left-1/2 w-px bg-line-strong" /><Scissors aria-hidden="true" className="relative" /></>
            : <>
              {width >= 40 && item.style !== 'row' && <span data-user-content className="min-w-0 truncate text-2xs leading-4">{name}</span>}
              {userIssue && width >= 20 && <TriangleAlert aria-label="画面会缺内容" className="ml-auto shrink-0 text-danger-text" />}
              {item.style === 'cut' && width >= 20 && <Scissors aria-hidden="true" className="ml-auto shrink-0" />}
              {clippedLeft && <span aria-hidden="true" data-video-edit-scene-clipped="left" className="absolute inset-y-0 left-0 w-0.5 bg-text3" />}
              {clippedRight && <span aria-hidden="true" data-video-edit-scene-clipped="right" className="absolute inset-y-0 right-0 w-0.5 bg-text3" />}
              {edges.map(edge => <span key={edge.mode} aria-hidden="true" data-video-edit-scene-edge={edge.mode} className={`absolute inset-y-0 w-1.5 cursor-ew-resize ${edge.side === 'left' ? 'left-0' : 'right-0'}`} />)}
            </>}
      </UiButton>
    </span>
  }

  return <div ref={root} tabIndex={-1} role="group" aria-label={`${trackName}片子数据`} data-video-edit-scene-lane={sceneId} className="absolute left-0 right-0 border-b border-gap bg-window outline-none" style={{ top, height }}
    onPointerDown={event => { event.stopPropagation(); root.current?.focus({ preventScroll: true }); if (event.target === event.currentTarget) select(null) }}
    // 拖动中记录块会换位置重新挂载：指针捕获、移动与松开都在不卸载的根节点上处理
    onPointerMove={event => { if (drag.current?.pointerId === event.pointerId) scheduler.schedule(event.clientX, event.shiftKey) }}
    onPointerUp={event => { if (drag.current?.pointerId === event.pointerId) { scheduler.flush(); endDrag(true) } }}
    onPointerCancel={() => endDrag(false)} onLostPointerCapture={() => { if (drag.current) { scheduler.flush(); endDrag(true) } }}
    onContextMenu={event => { event.preventDefault(); event.stopPropagation() }} onDoubleClick={event => event.stopPropagation()}
    onKeyDown={event => {
      if (event.key === 'Escape' && drag.current) { event.preventDefault(); event.stopPropagation(); endDrag(false); return }
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedId && !drag.current) { event.preventDefault(); event.stopPropagation(); void remove(selectedId) }
    }}>
    <div className="sticky left-0 z-sticky flex h-full flex-col border-r border-gap bg-panel pl-8 pr-1.5" style={{ width: TIMELINE_HEADER_WIDTH }}>
      {header}
      {display.map((row, index) => <div key={index} className="flex h-7 min-w-0 shrink-0 items-center gap-1 overflow-hidden" data-video-edit-scene-group-row={row.group.kind}>
        {row.first ? <UiIconButton size="2xs" aria-expanded={!collapsed.has(row.group.kind)} aria-label={`${collapsed.has(row.group.kind) ? '展开' : '收起'}${row.group.label}`} tooltip={collapsed.has(row.group.kind) ? '展开这一组' : '收起这一组'} onClick={() => onToggleGroup(row.group.kind)}>{collapsed.has(row.group.kind) ? <ChevronRight /> : <ChevronDown />}</UiIconButton> : <span aria-hidden="true" className="w-5 shrink-0" />}
        {row.first && <Tooltip asChild content={row.group.label} placement="right"><span className="min-w-0 truncate text-2xs text-text2">{row.group.label}</span></Tooltip>}
        {row.label && <Tooltip asChild content={row.label} placement="right"><span data-user-content className="min-w-0 flex-1 truncate text-2xs text-text3">{row.label}</span></Tooltip>}
      </div>)}
    </div>
    {hint && <span className="pointer-events-none absolute truncate text-2xs text-text3" style={{ top: KEYFRAME_LANE_HEADER + 6, left: TIMELINE_HEADER_WIDTH + view.left + 12, maxWidth: Math.max(0, view.width - TIMELINE_HEADER_WIDTH - 24) }}>{hint}</span>}
    {!hint && display.map((row, index) => {
      const rowTop = KEYFRAME_LANE_HEADER + index * KEYFRAME_LANE_ROW
      return <div key={`${row.group.kind}:${index}`} className="pointer-events-none absolute left-0 right-0" style={{ top: 0, height: 0 }}>
        {clips.flatMap(clip => {
          if (clip.frameHold) return []
          const f0 = Math.max(clip.start, viewFrom), f1 = Math.min(clip.start + clip.duration, viewTo)
          if (f1 < f0) return []
          const range = videoEditClipSourceRange(clip, fps)
          const s0 = videoEditClipSourceSecondsAtTime(clip, f0 / fps, fps), s1 = videoEditClipSourceSecondsAtTime(clip, f1 / fps, fps)
          const from = Math.max(range.from, Math.min(s0, s1)), to = Math.min(range.to, Math.max(s0, s1))
          // 已提交的条目用二分过滤；拖动中只有少数条目换了位置，按草稿位置逐项过滤
          const visible = (laneRow: VideoEditSceneLaneRow): readonly VideoEditSceneLaneItem[] => draftItems
            ? laneRow.items.filter(value => { const moved = draftItems.get(value.record.id) ?? value; return moved.at <= to && moved.end >= from })
            : videoEditSceneLaneVisibleItems(laneRow, from, to)
          return row.rows.flatMap(laneRow => visible(laneRow).map(item => renderItem(clip, item, rowTop, range)))
        })}
      </div>
    })}
  </div>

  /**
   * 拖动结果写成修改：按录屏秒锚定的开始或结束（不按 Shift）反解成新的 {src}，其余走 retime。
   * 先改开始，再在已换上新开始的数据上反解结束：解析器把结束收到不早于开始，在旧开始上反解，整条往左拖过自身长度时结束会被收住、
   * 一定反解失败。update 整体替换取值，所以按顺序排：开始的修改在前，结束的 update 取开始改完后的那条记录的取值。
   */
  function sceneChanges(gesture: Gesture, record: VideoEditScene['records'][number], kind: CodeSceneKindDeclaration, mode: DragMode, at: number, end: number, shift: boolean, context: VideoEditSceneWriteContext): VideoEditSceneChange[] {
    const anchor = (resolved: ResolvedVideoEditScene, t: number, side: 'start' | 'end'): { src: number } => {
      const result = videoEditSceneAnchorAt(resolved, resolved.byId.get(record.id)!, t, side)
      if (!result.ok) throw new AnchorRejection(`${result.message}按住 Shift 拖动可改成固定秒数。`)
      return result.anchor
    }
    const movesStart = mode !== 'end', movesEnd = mode === 'end' || mode === 'move'
    const anchorStart = movesStart && !shift && isAnchor(record.values[kind.at!])
    const anchorEnd = movesEnd && !shift && Boolean(kind.end) && isAnchor(record.values[kind.end!])
    const spans = Boolean(kind.end || kind.duration)
    // 用时长表达结束的类型改了开始的锚点，结束跟着时长挪了：拉回原来的结束
    const retimeEnd = spans && !anchorEnd && (movesEnd || anchorStart && Boolean(kind.duration))
    const changes: VideoEditSceneChange[] = []
    if (anchorStart) changes.push({ kind: 'update', recordId: record.id, values: { ...record.values, [kind.at!]: anchor(gesture.baseResolved, at, 'start') } })
    if (movesStart && !anchorStart) changes.push({ kind: 'retime', recordId: record.id, start: at, ...retimeEnd && !anchorStart ? { end } : {} })
    else if (retimeEnd) changes.push({ kind: 'retime', recordId: record.id, end })
    if (!anchorEnd) return changes
    const working = changes.length ? applyVideoEditSceneChanges(gesture.base, changes, context) : gesture.base
    const resolved = changes.length ? resolveVideoEditSceneView(working, context.schema, context.media)! : gesture.baseResolved
    const current = working.records.find(item => item.id === record.id)!
    return [...changes, { kind: 'update', recordId: record.id, values: { ...current.values, [kind.end!]: anchor(resolved, end, 'end') } }]
  }
}
