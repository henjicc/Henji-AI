import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Database, Hand, LocateFixed, RotateCcw, TriangleAlert } from 'lucide-react'
import ContextMenu from '@/components/ContextMenu'
import { UiEmpty, UiFormRow, UiIconButton, UiInlineStatus, UiLoading, UiOptionButton, UiToolbar, UiVirtualList, type UiPanelFooterTool } from '@/components/ui'
import { UiFieldLayoutContext, UiPropertyMenuContext } from '@/components/ui/fieldLayout'
import { ParamField, type ParamGesture } from '@/components/ui/params/ParamField'
import type { ParamFieldSpec } from '@/components/ui/params/fieldSpec'
import { UI_DIVIDER_CLASS, UI_TEXT_TIMECODE_CLASS } from '@/components/ui/styleTokens'
import { UI_ICON_SIZE } from '@/core/theme/icons'
import { useContextMenu } from '@/hooks/useContextMenu'
import type { CodeParameterValue } from '@/core/imaging/parameterTypes'
import type { VideoEditDocument } from '@/core/videoEdit/document'
import { videoEditClipFrameAtSource } from '@/core/videoEdit/clipSpeed'
import { videoEditFps } from '@/core/videoEdit/time'
import type { CodeSceneFieldDeclaration, CodeSceneValue } from '@/core/videoEdit/scene/sceneDeclaration'
import { videoEditSceneMedia } from '@/core/videoEdit/scene/sceneMedia'
import type { VideoEditScene, VideoEditSceneRecord } from '@/core/videoEdit/scene/sceneSchema'
import {
  findVideoEditScene, previewVideoEditSceneGesture, resolveVideoEditSceneView, videoEditSceneIssues, videoEditSceneTreeRows, writeVideoEditScene,
  VideoEditSceneRejection, type VideoEditSceneChange, type VideoEditSceneDeclarationState, type VideoEditSceneIssue, type VideoEditSceneTreeRow, type VideoEditSceneWriteContext,
} from '../application/videoEditScenes'
import { selectedVideoEditSceneRecord, selectVideoEditSceneRecord, subscribeVideoEditSceneSelection, videoEditSceneSelectionVersion } from '../application/videoEditSceneSelection'
import { useVideoEditSceneDeclaration } from './useVideoEditSceneDeclaration'
import { videoEditClipSceneIds, videoEditSceneClock, videoEditSceneKindOf, videoEditSceneNamingFor, type VideoEditSceneNaming } from './videoEditSceneNaming'
import { beginVideoEditGesture, finishVideoEditGesture, getActiveVideoEditSequence, setVideoEditView, videoEditCommittedDocument, type VideoEditGesture, type VideoEditInstance } from '../application/videoEditService'

/*
 * 片子数据检查器：一份片子数据按记录树列出（段落 → 窗口 → 窗口内容……），选中一条在下方改它的字段与剪后起止。
 * 所有修改都走片子数据领域服务 writeVideoEditScene（拖动时先用 previewVideoEditSceneGesture 预览，松手经同一入口校验并整笔提交），
 * 和助手的通用写入是同一条路，手调标记、校验与撤销规则只有那一份。
 * 服务的问题与拒绝文字是写给助手的（记录 ID、属性名、做法），界面经 videoEditSceneNaming 换成记录名、字段名和用户能做的事。
 */
const INDENT_PX = 12
const SECONDS_MAX = 86_400

/**
 * 字段的编辑控件：按声明的语义类型换成参数面板的字段描述；没有合适控件的（素材、界面元素、路径、列表）只读显示。
 * 区域与台面坐标先用 x / y / 宽 / 高 数值编辑，画面手柄另做。
 */
function fieldControl(name: string, field: CodeSceneFieldDeclaration, value: CodeSceneValue | undefined, scene: VideoEditScene, document: VideoEditDocument, naming: VideoEditSceneNaming): { spec: ParamFieldSpec; value: CodeParameterValue } | { text: string } {
  const base = { key: name, title: field.title ?? name, animatable: false, source: 'code' as const, bindingKeys: [name] }
  const seconds = (min: number, max: number) => ({ ...base, type: 'number' as const, default: 0, min, max, step: 0.01, unit: '秒', control: 'input' as const })
  const numberOf = (fallback: number): number => typeof value === 'number' ? value : fallback
  const axes = (keys: readonly string[], min: number, max: number, step: number): ParamFieldSpec => ({ ...base, type: 'custom', typeName: field.type, layout: 'grid', default: {}, children: keys.map(key => ({ key, title: { x: 'X', y: 'Y', width: '宽', height: '高' }[key] ?? key, animatable: false, source: 'code' as const, bindingKeys: [key], type: 'number' as const, default: 0, min, max, step, unit: '', control: 'input' as const })) })
  switch (field.type) {
    case 'time': return typeof value === 'number' || value === undefined ? { spec: seconds(0, SECONDS_MAX), value: numberOf(0) } : { text: value && typeof value === 'object' && !Array.isArray(value) && typeof value.src === 'number' ? `录屏第 ${value.src} 秒` : '—' }
    case 'duration': return { spec: seconds(field.min, field.max), value: numberOf(typeof field.default === 'number' ? field.default : field.min) }
    case 'sourceTime': return { spec: seconds(0, SECONDS_MAX), value: numberOf(0) }
    case 'desk': return { spec: { ...base, type: 'number', default: 0, min: field.min, max: field.max, step: 1, unit: '', control: 'input' }, value: numberOf(0) }
    case 'number': return { spec: { ...base, type: 'number', default: 0, min: field.min, max: field.max, step: field.step ?? 0.01, unit: field.unit ?? '', control: 'input' }, value: numberOf(field.min) }
    case 'text': return { spec: { ...base, type: 'text', default: '', maxLength: field.maxLength, multiline: field.multiline }, value: typeof value === 'string' ? value : '' }
    case 'boolean': return { spec: { ...base, type: 'boolean', default: false }, value: value === true }
    case 'choice': return { spec: { ...base, type: 'choice', default: field.options[0], options: field.options }, value: typeof value === 'string' ? value : field.options[0] }
    case 'color': return { spec: { ...base, type: 'color', default: [1, 1, 1, 1], alpha: field.alpha }, value: (Array.isArray(value) ? value : [1, 1, 1, 1]) as CodeParameterValue }
    case 'seed': return { spec: { ...base, type: 'seed', default: 0 }, value: numberOf(0) }
    case 'textStyle': return value && typeof value === 'object' ? { spec: { ...base, type: 'textStyle', default: value as never }, value: value as CodeParameterValue } : { text: '默认样式' }
    case 'windowRegion': case 'region': return value && typeof value === 'object' && !Array.isArray(value) ? { spec: axes(['x', 'y', 'width', 'height'], 0, 1, 0.001), value: value as CodeParameterValue } : { text: '—' }
    case 'deskRect': return value && typeof value === 'object' && !Array.isArray(value) ? { spec: axes(['x', 'y', 'width', 'height'], -1e9, 1e9, 1), value: value as CodeParameterValue } : { text: '—' }
    case 'deskPoint': return value && typeof value === 'object' && !Array.isArray(value) ? { spec: axes(['x', 'y'], -1e9, 1e9, 1), value: value as CodeParameterValue } : { text: '—' }
    case 'ref': {
      const targets = scene.records.filter(record => field.to.includes(record.kind))
      // 下拉显示的必须是实际存的值：指向的记录已删除或还没选时单列一项说明，不冒充成第一个选项。
      const stored = typeof value === 'string' ? value : ''
      const missing = !targets.some(record => record.id === stored)
      if (!targets.length && missing) return { text: stored ? '已删除的记录' : '未选择' }
      const options = [...(missing ? [stored] : []), ...targets.map(record => record.id)]
      const labels = Object.fromEntries([...(missing ? [[stored, stored ? '已删除的记录' : '未选择']] : []), ...targets.map(record => [record.id, `${naming.kindTitle(record.kind)} ${naming.shortName(record)}`])])
      return { spec: { ...base, type: 'choice', default: options[0], options, optionLabels: labels }, value: stored }
    }
    case 'media': return { text: typeof value === 'string' ? document.media.find(media => media.id === value)?.name ?? '已删除的素材' : '—' }
    case 'uiTrack': return { text: value && typeof value === 'object' && !Array.isArray(value) && typeof value.key === 'string' ? '跟随界面元素' : '—' }
    case 'deskPath': return { text: Array.isArray(value) ? `${value.length} 个点` : '—' }
    case 'list': return { text: Array.isArray(value) ? `${value.length} 项` : '—' }
  }
}

/**
 * 一处修改的手势：拖动、连续输入时每一下都按手势开始时的片子数据预览（previewVideoEditSceneGesture），松手经
 * writeVideoEditScene 按声明重新校验后整笔提交、写日志；单击类修改（开关、选项）直接写一次。
 * 预览被拒时保留上一个合法预览，松手时最后一下仍不合法就整笔取消并说明原因。
 */
function useSceneGesture(instance: VideoEditInstance, sceneId: string, context: VideoEditSceneWriteContext | undefined, naming: VideoEditSceneNaming, onError: (reason: unknown) => void) {
  const projectId = instance.document.id
  const handle = useRef<VideoEditGesture>()
  const base = useRef<VideoEditScene>()
  const last = useRef<VideoEditSceneChange>()
  const armed = useRef(false)
  const rejected = useRef<unknown>()
  const contextRef = useRef(context); contextRef.current = context
  const report = useRef((reason: unknown): void => onError(naming.error(reason))); report.current = reason => onError(naming.error(reason))
  const [epoch, setEpoch] = useState(0)
  const end = useCallback((commit: boolean): void => {
    const current = handle.current, error = rejected.current, change = last.current
    handle.current = undefined; base.current = undefined; last.current = undefined; armed.current = false; rejected.current = undefined
    if (!current) return
    if (!commit || error || !change) {
      finishVideoEditGesture(current, false); setEpoch(value => value + 1)
      if (commit && error) report.current(error)
      return
    }
    // 松手到提交完成之间（重读代码声明，通常已缓存、很快）剪辑手势仍未结束：这时开始另一处修改会被提示“请先完成当前参数调整”。
    // 不为这段很难碰到的间隙另做排队：排队要么按旧起点合并两次修改，要么引入第二条提交路径。
    void writeVideoEditScene(projectId, sceneId, [change], { gesture: current }).catch(reason => { setEpoch(value => value + 1); report.current(reason) })
  }, [projectId, sceneId])
  useEffect(() => () => end(false), [end])
  /**
   * change 在写入那一刻拿到当时的片子数据（拖动中是手势开始时的，否则是当前文档里的），只改自己那一处：
   * 用渲染时的记录拼整份取值，会把助手或另一次写入刚改的其他字段静默改回去。
   */
  return (change: (value: CodeParameterValue, latest: VideoEditScene) => VideoEditSceneChange): ParamGesture => ({
    epoch,
    active: () => armed.current,
    begin: () => { armed.current = true },
    finish: () => end(true),
    cancel: () => end(false),
    write: value => {
      const write = contextRef.current
      if (!write) return
      try {
        if (!handle.current) { base.current = findVideoEditScene(instance.document, sceneId); handle.current = beginVideoEditGesture(projectId) }
        armed.current = true
        const next = change(value, base.current!)
        previewVideoEditSceneGesture(handle.current, sceneId, base.current!, [next], write)
        last.current = next; rejected.current = undefined
      } catch (reason) {
        if (reason instanceof VideoEditSceneRejection && handle.current) rejected.current = reason
        else { end(false); report.current(reason) }
      }
    },
    atomic: value => {
      try { void writeVideoEditScene(projectId, sceneId, [change(value, findVideoEditScene(instance.document, sceneId))]).catch(reason => report.current(reason)) } catch (reason) { report.current(reason) }
    },
  })
}

function IssueIcon({ issues }: { issues: readonly VideoEditSceneIssue[] }): React.ReactElement | null {
  if (!issues.length) return null
  const user = issues.some(issue => issue.severity === 'user')
  return <TriangleAlert size={UI_ICON_SIZE.xs} className={`shrink-0 ${user ? 'text-danger-text' : 'text-warning-text'}`} aria-label={user ? '画面会缺内容' : '有问题'} />
}

function TreeRow({ row, naming, selected, expanded, issues, onSelect, onToggle, onJump }: {
  row: VideoEditSceneTreeRow; naming: VideoEditSceneNaming; selected: boolean; expanded: boolean; issues: readonly VideoEditSceneIssue[]
  onSelect: () => void; onToggle: () => void; onJump: () => void
}): React.ReactElement {
  const { record, resolved } = row
  const time = !resolved ? '已剪掉' : resolved.at === undefined ? '' : resolved.end !== undefined && Number.isFinite(resolved.end) ? `${videoEditSceneClock(resolved.at)}–${videoEditSceneClock(resolved.end)}` : videoEditSceneClock(resolved.at)
  const Chevron = expanded ? ChevronDown : ChevronRight
  return <div className="flex min-w-0 items-center px-1" role="treeitem" aria-level={row.depth + 1} aria-selected={selected} aria-expanded={row.childCount ? expanded : undefined} style={{ paddingLeft: Math.min(row.depth, 10) * INDENT_PX }} data-video-edit-scene-record={record.id}>
    {row.childCount ? <UiIconButton size="2xs" tone="bare" aria-label={`${expanded ? '收起' : '展开'}${naming.name(record)}`} onClick={onToggle}><Chevron /></UiIconButton> : <span className="w-5 shrink-0" aria-hidden="true" />}
    <UiOptionButton variant="menu" size="sm" active={selected} className="min-h-7 w-full min-w-0 gap-1.5" tooltip={issues.length ? issues.map(issue => naming.issue(issue, false)).join('\n') : undefined} onClick={onSelect} onDoubleClick={onJump}>
      <span className={`shrink-0 text-xs ${resolved ? 'text-text3' : 'text-text3 line-through'}`}>{naming.kindTitle(record.kind)}</span>
      <span className={`min-w-0 flex-1 truncate text-left text-xs ${resolved ? '' : 'text-text3 line-through'}`}>{naming.shortName(record)}</span>
      <IssueIcon issues={issues} />
      {time && <span className={`shrink-0 text-2xs text-text3 ${UI_TEXT_TIMECODE_CLASS}`}>{time}</span>}
    </UiOptionButton>
  </div>
}

interface InspectorProps {
  instance: VideoEditInstance
  scene: VideoEditScene
  record: VideoEditSceneRecord
  row: VideoEditSceneTreeRow | undefined
  state: VideoEditSceneDeclarationState
  naming: VideoEditSceneNaming
  issues: readonly VideoEditSceneIssue[]
  gesture: ReturnType<typeof useSceneGesture>
  onRestore: (paths: readonly string[]) => void
}
function RecordInspector({ instance, scene, record, row, state, naming, issues, gesture, onRestore }: InspectorProps): React.ReactElement {
  const menu = useContextMenu()
  const kind = videoEditSceneKindOf(state.declaration, record.kind)
  const tunedPaths = (field: string | undefined): string[] => field === undefined ? [] : (record.tuned ?? []).filter(path => path === field || path.startsWith(`${field}.`))
  const disabled = Boolean(state.block)
  const resolved = row?.resolved
  /** 手调标记在秒表列；右键名称也能恢复自动。 */
  const tunedSlots = (title: string, paths: readonly string[]) => paths.length ? {
    leading: <UiIconButton size="2xs" on aria-label={`恢复自动：${title}`} tooltip="手调过，点击恢复自动" disabled={disabled} disabledReason={naming.block} onClick={() => onRestore(paths)}><Hand /></UiIconButton>,
    onContextMenu: (event: React.MouseEvent) => menu.showMenu(event, [{ id: 'restore', label: '恢复自动', icon: <RotateCcw size={UI_ICON_SIZE.sm} />, disabled, onClick: () => onRestore(paths) }]),
  } : {}
  const timeRow = (side: 'start' | 'end', title: string, value: number | undefined, field: string | undefined) => {
    const slots = tunedSlots(title, tunedPaths(field))
    const editable = value !== undefined && Number.isFinite(value)
    const spec: ParamFieldSpec = { key: side, title, animatable: false, source: 'code', bindingKeys: [side], type: 'number', default: 0, min: 0, max: SECONDS_MAX, step: 0.01, unit: '秒', control: 'input' }
    return <UiFormRow key={side} label={title} leading={slots.leading} onContextMenu={slots.onContextMenu}>
      {editable ? <ParamField field={spec} value={value} disabled={disabled} gesture={gesture(next => ({ kind: 'retime', recordId: record.id, [side]: next as number }))} />
        : <span className="truncate text-xs text-text3">{!resolved ? '已剪掉' : side === 'end' ? '到下一项' : '—'}</span>}
    </UiFormRow>
  }
  const timing = new Set([kind?.at, kind?.end, kind?.duration].filter((key): key is string => Boolean(key)))
  return <UiFieldLayoutContext.Provider value="property"><UiPropertyMenuContext.Provider value={menu.showMenu}>
    <div className="flex flex-col pb-3" aria-label="记录字段">
      <div className="flex h-control-sm min-w-0 items-center gap-1.5 px-3 text-xs">
        <span className="shrink-0 text-text3">{naming.kindTitle(record.kind)}</span>
        <span className="min-w-0 truncate text-text1">{naming.shortName(record)}</span>
      </div>
      {issues.map((issue, index) => <div key={index} className="px-3 pb-1"><UiInlineStatus tone={issue.severity === 'user' ? 'error' : 'warning'} truncate>{naming.issue(issue, false)}</UiInlineStatus></div>)}
      {!kind ? null : <>
        {kind.at && timeRow('start', '开始', resolved?.at, kind.at)}
        {(kind.end || kind.duration) && timeRow('end', '结束', resolved?.end, kind.end ?? kind.duration)}
        {Object.entries(kind.fields).filter(([name]) => !timing.has(name)).map(([name, field]) => {
          const title = field.title ?? name
          const value = Object.hasOwn(record.values, name) ? record.values[name] : field.default
          const control = fieldControl(name, field, value, scene, instance.document, naming)
          const slots = tunedSlots(title, tunedPaths(name))
          const wide = 'spec' in control && ['text', 'custom', 'textStyle'].includes(control.spec.type)
          return <UiFormRow key={name} label={title} wide={wide} leading={slots.leading} onContextMenu={slots.onContextMenu}>
            {'spec' in control ? <ParamField field={control.spec} value={control.value} disabled={disabled} gesture={gesture((next, latest) => ({ kind: 'update', recordId: record.id, values: { ...(latest.records.find(item => item.id === record.id) ?? record).values, [name]: next as CodeSceneValue } }))} />
              : <span className="min-w-0 truncate text-xs text-text2">{control.text}</span>}
          </UiFormRow>
        })}
      </>}
    </div>
    <ContextMenu items={menu.menuItems} position={menu.menuPosition} onClose={menu.hideMenu} visible={menu.menuVisible} />
  </UiPropertyMenuContext.Provider></UiFieldLayoutContext.Provider>
}

export function VideoEditScenePanel({ instance, onError, visible }: { instance: VideoEditInstance; onError: (reason: unknown) => void; visible: boolean }): React.ReactElement {
  const projectId = instance.document.id
  const document = instance.document
  const committed = videoEditCommittedDocument(instance)
  const scenes = useMemo(() => document.scenes ?? [], [document.scenes])
  const sequence = getActiveVideoEditSequence(instance)
  const [chosen, setChosen] = useState<string>()
  // 选中的记录在时间线子轨道、面板与助手之间共用：在时间线上点了别的片子数据里的记录，面板跟着切过去。
  useSyncExternalStore(subscribeVideoEditSceneSelection, videoEditSceneSelectionVersion)
  const selection = selectedVideoEditSceneRecord(instance)
  // 默认看所选片段引用的那份；所选片段没有引用时取当前序列里第一份被引用的，再没有就第一份。
  const sceneId = useMemo(() => {
    if (selection && scenes.some(scene => scene.id === selection.sceneId)) return selection.sceneId
    if (chosen && scenes.some(scene => scene.id === chosen)) return chosen
    const selected = sequence.clips.find(clip => clip.id === instance.selection)
    const candidates = [...(selected ? videoEditClipSceneIds(selected) : []), ...sequence.clips.flatMap(videoEditClipSceneIds)]
    return candidates.find(id => scenes.some(scene => scene.id === id)) ?? scenes[0]?.id
  }, [selection, chosen, scenes, sequence.clips, instance.selection])
  const scene = scenes.find(item => item.id === sceneId)
  // 问题按已提交的片子数据算：拖动中的草稿每一下都整份校验太重，松手提交后再更新。
  const committedScene = committed.scenes?.find(item => item.id === sceneId)
  const report = useRef((reason: unknown): void => onError(reason))
  const state = useVideoEditSceneDeclaration(instance, committed.scenes?.some(item => item.id === sceneId) ? sceneId : undefined, visible, reason => report.current(reason))
  const media = videoEditSceneMedia(document)
  const committedMedia = videoEditSceneMedia(committed)
  const resolved = useMemo(() => scene && resolveVideoEditSceneView(scene, state?.declaration?.schema, media), [scene, state, media])
  // 没有名称的记录按它在记录树里的位置编“类型 + 序号”；按已提交的数据编号，拖动中与时间线子轨道的称呼一致、不跳号。
  const naming = useMemo(() => {
    const base = committedScene ?? scene
    return videoEditSceneNamingFor(base, state, base && resolveVideoEditSceneView(base, state?.declaration?.schema, committedMedia), committedMedia)
  }, [committedScene, scene, state, committedMedia])
  report.current = reason => onError(naming.error(reason))
  const issues = useMemo(() => committedScene && state ? videoEditSceneIssues(committedScene, state, committedMedia) : [], [committedScene, state, committedMedia])
  const issuesByRecord = useMemo(() => {
    const map = new Map<string, VideoEditSceneIssue[]>()
    for (const issue of issues) if (issue.recordId !== undefined) map.set(issue.recordId, [...map.get(issue.recordId) ?? [], issue])
    return map
  }, [issues])
  // 片子数据整体的情况：不能改的原因与读不到的代码换成用户语言，其余没挂在记录上的问题按名称改写。
  const sceneNotices = [...naming.block ? [naming.block] : [], ...naming.notes, ...issues.filter(issue => issue.recordId === undefined && issue.path !== 'schema').map(issue => naming.issue(issue))]
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const rows = useMemo(() => scene ? videoEditSceneTreeRows(scene, state?.declaration?.schema, resolved, collapsed) : [], [scene, state, resolved, collapsed])
  const selectedId = selection?.sceneId === sceneId ? selection.recordId : undefined
  const setSelectedId = (recordId: string | undefined): void => {
    try { selectVideoEditSceneRecord(projectId, recordId && sceneId ? { sceneId, recordId } : null) } catch (reason) { onError(reason) }
  }
  const record = scene?.records.find(item => item.id === selectedId)
  const row = rows.find(item => item.record.id === selectedId)
  const context = useMemo<VideoEditSceneWriteContext | undefined>(() => state && { schema: state.declaration?.schema, block: state.block, media }, [state, media])
  const gesture = useSceneGesture(instance, sceneId ?? '', context, naming, onError)
  const write = (changes: readonly VideoEditSceneChange[]): void => { if (sceneId) void writeVideoEditScene(projectId, sceneId, changes).catch(reason => report.current(reason)) }
  const restore = (paths?: readonly string[]): void => { if (record) write([{ kind: 'restore_automatic', recordId: record.id, ...(paths ? { paths } : {}) }]) }

  /** 跳到记录的剪后开始：引用这份片子数据的片段（优先所选片段）上这一刻所在的帧。 */
  const jumpFrame = (target: VideoEditSceneTreeRow | undefined): number | undefined => {
    const at = target?.resolved?.at
    if (at === undefined || !sceneId) return undefined
    const clips = sequence.clips.filter(clip => videoEditClipSceneIds(clip).includes(sceneId))
    const clip = clips.find(item => item.id === instance.selection) ?? clips[0]
    return clip && videoEditClipFrameAtSource(clip, at, videoEditFps(sequence.frameRate))
  }
  const jump = (target: VideoEditSceneTreeRow | undefined): void => {
    const frame = jumpFrame(target)
    if (frame !== undefined) { try { setVideoEditView(projectId, { frame }) } catch (reason) { onError(reason) } }
  }

  const renderRow = (item: VideoEditSceneTreeRow): React.ReactElement => <TreeRow row={item} naming={naming} selected={item.record.id === selectedId}
    expanded={!collapsed.has(item.record.id)} issues={issuesByRecord.get(item.record.id) ?? []}
    onSelect={() => setSelectedId(item.record.id)} onJump={() => { setSelectedId(item.record.id); jump(item) }}
    onToggle={() => setCollapsed(previous => { const next = new Set(previous); if (next.has(item.record.id)) next.delete(item.record.id); else next.add(item.record.id); return next })} />

  const parents = useMemo(() => [...new Set(scene?.records.flatMap(item => item.parent === undefined ? [] : [item.parent]))], [scene])
  const allCollapsed = parents.length > 0 && parents.every(id => collapsed.has(id))
  const tools: UiPanelFooterTool[] = !scene ? [] : [
    ...(scenes.length > 1 ? [{ kind: 'menu' as const, id: 'scene', label: '切换片子数据', icon: Database, menu: () => scenes.map(item => <UiOptionButton key={item.id} variant="menu" size="sm" active={item.id === sceneId} onClick={() => { setChosen(item.id); setSelectedId(undefined) }}>{item.name}</UiOptionButton>) }] : []),
    { kind: 'action', id: 'collapse', label: allCollapsed ? '全部展开' : '全部收起', icon: allCollapsed ? ChevronsUpDown : ChevronsDownUp, disabled: !parents.length, disabledReason: '没有带子记录的记录', onSelect: () => setCollapsed(allCollapsed ? new Set() : new Set(parents)) },
    { kind: 'action', id: 'jump', label: '跳到开始', tooltip: '播放头跳到这条记录的开始（也可以双击记录）', icon: LocateFixed, disabled: jumpFrame(row) === undefined, disabledReason: !record ? '先选一条记录' : '这条记录在当前序列里没有画面位置', onSelect: () => jump(row) },
    { kind: 'action', id: 'restore', label: '全部恢复自动', tooltip: '这条记录手调过的字段全部恢复自动：取值不变，下次重新生成时覆盖', icon: RotateCcw, disabled: !record?.tuned?.length || Boolean(naming.block), disabledReason: !record ? '先选一条记录' : naming.block ?? '这条记录没有手调过的字段', onSelect: () => restore() },
  ]
  const problemCount = issues.length
  const status = scene ? `${scene.name} · ${scene.records.length} 条${problemCount ? ` · ${problemCount} 处问题` : ''}` : ''

  const body = (): React.ReactNode => {
    if (!scene) return <UiEmpty className="h-full" size="sm" title="还没有片子数据" />
    return <>
      {sceneNotices.length > 0 && <div className="flex flex-col gap-1 px-3 py-1">{sceneNotices.map((text, index) => <UiInlineStatus key={index} tone="warning" truncate>{text}</UiInlineStatus>)}</div>}
      <div className="min-h-0 flex-1 py-1" role="tree" aria-label={`${scene.name}的记录`}>
        <UiVirtualList data={rows} getKey={item => item.record.id} renderItem={renderRow} highlightedIndex={selectedId ? rows.findIndex(item => item.record.id === selectedId) : undefined} emptyState={<UiEmpty size="sm" title="这份片子数据还没有记录" />} />
      </div>
      {record && <div className={`min-h-0 flex-1 overflow-auto ${UI_DIVIDER_CLASS}`}>
        {state ? <RecordInspector key={record.id} instance={instance} scene={scene} record={record} row={row} state={state} naming={naming} issues={issuesByRecord.get(record.id) ?? []} gesture={gesture} onRestore={restore} />
          : <UiLoading size="sm" message="正在读取…" />}
      </div>}
    </>
  }
  return <div className="flex h-full min-h-0 flex-col" aria-label="片子数据" data-video-edit-panel="scenes" tabIndex={-1}>
    {body()}
    <UiToolbar variant="footer" aria-label="片子数据工具" tools={tools}>{status}</UiToolbar>
  </div>
}
