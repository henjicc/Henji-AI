import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Database, Hand, LocateFixed, RotateCcw, TriangleAlert } from 'lucide-react'
import ContextMenu from '@/components/ContextMenu'
import { UiEmpty, UiFormRow, UiIconButton, UiInlineStatus, UiLoading, UiOptionButton, UiToolbar, UiVirtualList, type UiPanelFooterTool } from '@/components/ui'
import { UiFieldLayoutContext, UiPropertyMenuContext } from '@/components/ui/fieldLayout'
import { ParamField, type ParamGesture } from '@/components/ui/params/ParamField'
import type { ParamFieldSpec } from '@/components/ui/params/fieldSpec'
import { UI_DIVIDER_CLASS, UI_TEXT_TIMECODE_CLASS } from '@/components/ui/styleTokens'
import { UI_ICON_SIZE } from '@/core/theme/icons'
import { useContextMenu } from '@/hooks/useContextMenu'
import { isCodeSceneReference } from '@/core/videoEdit/codeMaterial/contract'
import type { CodeParameterValue } from '@/core/imaging/parameterTypes'
import type { VideoEditDocument } from '@/core/videoEdit/document'
import { videoEditClipFrameAtSource } from '@/core/videoEdit/clipSpeed'
import { videoEditFps } from '@/core/videoEdit/time'
import type { CodeSceneFieldDeclaration, CodeSceneKindDeclaration, CodeSceneMediaKind, CodeSceneValue } from '@/core/videoEdit/scene/sceneDeclaration'
import { videoEditSceneMedia } from '@/core/videoEdit/scene/sceneMedia'
import type { VideoEditScene, VideoEditSceneRecord } from '@/core/videoEdit/scene/sceneSchema'
import {
  findVideoEditScene, loadVideoEditSceneDeclarations, previewVideoEditSceneGesture, resolveVideoEditSceneView, videoEditSceneIssues, videoEditSceneTreeRows, writeVideoEditScene,
  VideoEditSceneRejection, type VideoEditSceneChange, type VideoEditSceneDeclarationState, type VideoEditSceneIssue, type VideoEditSceneTreeRow, type VideoEditSceneWriteContext,
} from '../application/videoEditScenes'
import { beginVideoEditGesture, finishVideoEditGesture, getActiveVideoEditSequence, setVideoEditView, videoEditCommittedDocument, type VideoEditGesture, type VideoEditInstance } from '../application/videoEditService'

/*
 * 片子数据检查器：一份片子数据按记录树列出（段落 → 窗口 → 窗口内容……），选中一条在下方改它的字段与剪后起止。
 * 所有修改都走片子数据领域服务 writeVideoEditScene（拖动时先用 previewVideoEditSceneGesture 预览，松手经同一入口校验并整笔提交），
 * 和助手的通用写入是同一条路，手调标记、校验与撤销规则只有那一份。
 * 服务的问题与拒绝文字是写给助手的（记录 ID、属性名、做法），界面经 sceneNaming 换成记录名、字段名和用户能做的事。
 */
const INDENT_PX = 12
const SECONDS_MAX = 86_400
type Declaration = VideoEditSceneDeclarationState['declaration']

/** 剪后秒数的读数：分:秒.百分秒。 */
function clock(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${(seconds - minutes * 60).toFixed(2).padStart(5, '0')}`
}
function kindOf(declaration: Declaration, kind: string): CodeSceneKindDeclaration | undefined {
  return declaration && Object.hasOwn(declaration.schema.kinds, kind) ? declaration.schema.kinds[kind] : undefined
}
/** 记录自己的名称：时间线标签字段，其次 name / text / title。 */
function recordLabel(record: VideoEditSceneRecord, kind: CodeSceneKindDeclaration | undefined): string {
  const keys = [kind?.lane?.label, 'name', 'text', 'title'].filter((key): key is string => Boolean(key))
  return keys.map(key => record.values[key]).find((item): item is string => typeof item === 'string' && item.length > 0) ?? ''
}
/** 代码参数里引用的片子数据：片段自己的参数与它上面代码效果的参数。 */
function referencedScenes(clip: VideoEditDocument['sequences'][number]['clips'][number]): string[] {
  const codes = [clip.code, ...(clip.effects ?? []).map(effect => effect.code)]
  return codes.flatMap(code => Object.values(code?.parameters ?? {})).flatMap(value => isCodeSceneReference(value) ? [value.sceneId] : [])
}

const BLOCK_TEXT: Record<NonNullable<VideoEditSceneDeclarationState['reason']>, string> = {
  unreferenced: '还没有代码片段使用这份数据，接到代码片段上之后才能修改。',
  unreadable: '使用这份数据的代码暂时读不到，代码恢复后才能修改。',
  mismatch: '代码里的结构和这份数据对不上，要按新结构重建这份数据后才能修改。',
}
const PATH_TITLES: Readonly<Record<string, string>> = { kind: '类型', parent: '所属', tuned: '手调标记', timetable: '窗口内容' }
const MEDIA_KIND_TITLES: Readonly<Record<CodeSceneMediaKind, string>> = { video: '视频', image: '图片', audio: '音频' }
const GENERIC_ISSUE = '这里的数据有问题，可以让助手检查修正。'
/** 结构化取值的问题原文带着写给助手的格式说明（{x,y,width,height}、RGBA），界面按字段类型换成固定说法。 */
const VALUE_TEXT: Partial<Record<CodeSceneFieldDeclaration['type'], string>> = {
  windowRegion: '区域要在画面内，宽和高大于 0。', region: '区域要在画面内，宽和高大于 0。', deskRect: '要填有效的位置和大小，宽和高大于 0。', deskPoint: '要填有效的位置。',
  deskPath: '路径的点数不对。', uiTrack: '要选一个跟随的界面元素。', textStyle: '文字样式不完整。', color: '颜色不合法。', choice: '不是可选的选项。',
}
function valueAt(values: Readonly<Record<string, unknown>>, segments: readonly string[]): unknown {
  let current: unknown = values
  for (const segment of segments) current = current && typeof current === 'object' ? (current as Record<string, unknown>)[segment] : undefined
  return current
}

/**
 * 界面上对记录、字段与问题的称呼：没有名称的记录叫“类型 + 序号”（序号按树里看到的顺序），问题与拒绝按问题的
 * 结构（哪条记录、哪个字段、字段的类型与取值）给固定的用户说法，不在原文里做替换——原文是写给助手的，会带记录 ID、素材 ID 与英文种类。
 */
interface SceneNaming {
  readonly kindTitle: (kind: string) => string
  /** 树里类型名后面那一段：记录自己的名称，没有就是同类里的序号。 */
  readonly shortName: (record: VideoEditSceneRecord) => string
  readonly name: (record: VideoEditSceneRecord) => string
  readonly block: string | undefined
  readonly notes: readonly string[]
  readonly issue: (issue: VideoEditSceneIssue, withRecord?: boolean) => string
  /** 写入失败时给用户看的原因；不是片子数据拒绝的错误原样交出去。 */
  readonly error: (reason: unknown) => unknown
}
function sceneNaming(scene: VideoEditScene | undefined, state: VideoEditSceneDeclarationState | undefined, order: readonly VideoEditSceneRecord[], media: ReadonlyMap<string, CodeSceneMediaKind>): SceneNaming {
  const declaration = state?.declaration
  const kindTitle = (kind: string): string => kindOf(declaration, kind)?.title ?? kind
  const ordinals = new Map<string, number>(), counts = new Map<string, number>()
  for (const record of order) { const next = (counts.get(record.kind) ?? 0) + 1; counts.set(record.kind, next); ordinals.set(record.id, next) }
  const shortName = (record: VideoEditSceneRecord): string => recordLabel(record, kindOf(declaration, record.kind)) || String(ordinals.get(record.id) ?? '')
  const name = (record: VideoEditSceneRecord): string => recordLabel(record, kindOf(declaration, record.kind)) || `${kindTitle(record.kind)} ${ordinals.get(record.id) ?? ''}`.trim()
  const byId = new Map(scene?.records.map(record => [record.id, record]))
  const block = state?.block ? state.reason ? BLOCK_TEXT[state.reason] : '这份数据现在不能修改。' : undefined
  /** 字段取值问题的说法：素材与记录引用按取值判断是被删了还是种类不对，带格式说明的类型用固定说法，其余原文本就只有数字与中文。 */
  const valueText = (record: VideoEditSceneRecord | undefined, segments: readonly string[], message: string): string => {
    const kind = record && kindOf(declaration, record.kind)
    const declared = kind && Object.hasOwn(kind.fields, segments[0]) ? kind.fields[segments[0]] : undefined
    if (!record || !kind) return GENERIC_ISSUE
    if (!declared) return '代码里没有这个字段。'
    const listItem = declared.type === 'list' && segments.length > 1
    const field = declared.type === 'list' ? listItem ? declared.of : undefined : declared
    const value = valueAt(record.values, listItem ? segments.slice(0, 2) : segments.slice(0, 1))
    // 没有取值（缺少必填字段）与列表项数不对的原文只有中文与数字，原样用。
    if (!field || value === undefined) return message
    if (field.type === 'media') return typeof value === 'string' && media.has(value) ? `素材类型不对：这里要${field.accept.map(item => MEDIA_KIND_TITLES[item]).join('或')}。` : '引用的素材已从剪辑里删除。'
    if (field.type === 'ref') return value === record.id ? '不能引用这条记录自己。' : typeof value === 'string' && byId.has(value) ? `引用的记录类型不对：这里要${field.to.map(kindTitle).join('或')}。` : '引用的记录已删除。'
    if (field.type === 'time') return typeof value === 'number' || (value && typeof value === 'object' && 'src' in value) ? message : '要填一个时刻（秒）。'
    return VALUE_TEXT[field.type] ?? message
  }
  const issue = (item: VideoEditSceneIssue, withRecord = true): string => {
    if (item.path === 'schema') return block ?? '有一处使用这份数据的代码暂时读不到，没有拿它核对。'
    if (item.path === 'id') return '这条记录已经不在了，请重新选择。'
    const record = item.recordId === undefined ? undefined : byId.get(item.recordId)
    const kind = record && kindOf(declaration, record.kind)
    const [head, ...segments] = item.path.split('.')
    let text: string
    if (head === 'values' && segments.length) text = valueText(record, segments, item.message)
    else if (head === 'values') text = item.message
    else if (head === 'kind') text = '代码里没有这一类记录。'
    else if (head === 'tuned') text = '手调标记指向的字段已经不在了。'
    else if (head === 'timetable') text = '这扇窗口的内容太多，后面的部分不会显示；把内容拆到几扇窗口里。'
    else if (head === 'parent') {
      const parent = record?.parent === undefined ? undefined : byId.get(record.parent)
      text = kind?.parent && !(parent && kind.parent.includes(parent.kind)) ? `要放在${kind.parent.map(kindTitle).join('或')}下面。`
        : kind && !kind.parent && record?.parent !== undefined ? '这一类记录不能放在别的记录下面。'
          : '时刻落在已剪掉的段落里，但没有挂在那个段落下，所以留了下来。'
    } else text = GENERIC_ISSUE
    const fieldTitle = head === 'values' && segments[0] ? kind?.fields[segments[0]]?.title || segments[0] : PATH_TITLES[head]
    const prefix = [withRecord && record ? name(record) : '', fieldTitle ?? ''].filter(Boolean).join(' ')
    return `${prefix ? `${prefix}：` : ''}${text}`
  }
  return {
    kindTitle, shortName, name, block, issue,
    notes: state?.notes.length ? ['有一处使用这份数据的代码暂时读不到，没有拿它核对。'] : [],
    error: reason => reason instanceof VideoEditSceneRejection ? new Error(`没有改成：${reason.issues[0] ? issue(reason.issues[0]) : '这次修改不合法。'}`) : reason,
  }
}

/**
 * 字段的编辑控件：按声明的语义类型换成参数面板的字段描述；没有合适控件的（素材、界面元素、路径、列表）只读显示。
 * 区域与台面坐标先用 x / y / 宽 / 高 数值编辑，画面手柄另做。
 */
function fieldControl(name: string, field: CodeSceneFieldDeclaration, value: CodeSceneValue | undefined, scene: VideoEditScene, document: VideoEditDocument, naming: SceneNaming): { spec: ParamFieldSpec; value: CodeParameterValue } | { text: string } {
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
function useSceneGesture(instance: VideoEditInstance, sceneId: string, context: VideoEditSceneWriteContext | undefined, naming: SceneNaming, onError: (reason: unknown) => void) {
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
  row: VideoEditSceneTreeRow; naming: SceneNaming; selected: boolean; expanded: boolean; issues: readonly VideoEditSceneIssue[]
  onSelect: () => void; onToggle: () => void; onJump: () => void
}): React.ReactElement {
  const { record, resolved } = row
  const time = !resolved ? '已剪掉' : resolved.at === undefined ? '' : resolved.end !== undefined && Number.isFinite(resolved.end) ? `${clock(resolved.at)}–${clock(resolved.end)}` : clock(resolved.at)
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
  naming: SceneNaming
  issues: readonly VideoEditSceneIssue[]
  gesture: ReturnType<typeof useSceneGesture>
  onRestore: (paths: readonly string[]) => void
}
function RecordInspector({ instance, scene, record, row, state, naming, issues, gesture, onRestore }: InspectorProps): React.ReactElement {
  const menu = useContextMenu()
  const kind = kindOf(state.declaration, record.kind)
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
  // 默认看所选片段引用的那份；所选片段没有引用时取当前序列里第一份被引用的，再没有就第一份。
  const sceneId = useMemo(() => {
    if (chosen && scenes.some(scene => scene.id === chosen)) return chosen
    const selected = sequence.clips.find(clip => clip.id === instance.selection)
    const candidates = [...(selected ? referencedScenes(selected) : []), ...sequence.clips.flatMap(referencedScenes)]
    return candidates.find(id => scenes.some(scene => scene.id === id)) ?? scenes[0]?.id
  }, [chosen, scenes, sequence.clips, instance.selection])
  const scene = scenes.find(item => item.id === sceneId)
  // 问题按已提交的片子数据算：拖动中的草稿每一下都整份校验太重，松手提交后再更新。
  const committedScene = committed.scenes?.find(item => item.id === sceneId)
  const [loaded, setLoaded] = useState<{ sceneId: string; state: VideoEditSceneDeclarationState }>()
  const state = loaded?.sceneId === sceneId ? loaded.state : undefined
  const media = videoEditSceneMedia(document)
  const committedMedia = videoEditSceneMedia(committed)
  const resolved = useMemo(() => scene && resolveVideoEditSceneView(scene, state?.declaration?.schema, media), [scene, state, media])
  // 全部展开时的树序：没有名称的记录按它在树里的位置编“类型 + 序号”，与用户看到的顺序一致。
  const order = useMemo(() => scene ? videoEditSceneTreeRows(scene, state?.declaration?.schema, resolved).map(item => item.record) : [], [scene, state, resolved])
  const naming = useMemo(() => sceneNaming(scene, state, order, media), [scene, state, order, media])
  const report = useRef((reason: unknown): void => onError(naming.error(reason))); report.current = reason => onError(naming.error(reason))
  useEffect(() => {
    if (!visible || !sceneId || !committed.scenes?.some(item => item.id === sceneId)) return undefined
    let live = true
    loadVideoEditSceneDeclarations(instance, committed, sceneId).then(next => { if (live) setLoaded({ sceneId, state: next }) }, reason => { if (live) report.current(reason) })
    return () => { live = false }
  }, [visible, instance, committed, sceneId])
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
  const [selectedId, setSelectedId] = useState<string>()
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
    const clips = sequence.clips.filter(clip => referencedScenes(clip).includes(sceneId))
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
        <UiVirtualList data={rows} getKey={item => item.record.id} renderItem={renderRow} emptyState={<UiEmpty size="sm" title="这份片子数据还没有记录" />} />
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
