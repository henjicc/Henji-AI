import { isCodeSceneReference } from '@/core/videoEdit/codeMaterial/contract'
import type { VideoEditClip } from '@/core/videoEdit/document'
import type { CodeSceneFieldDeclaration, CodeSceneKindDeclaration, CodeSceneMediaKind } from '@/core/videoEdit/scene/sceneDeclaration'
import type { ResolvedVideoEditScene } from '@/core/videoEdit/scene/sceneResolve'
import type { VideoEditScene, VideoEditSceneRecord } from '@/core/videoEdit/scene/sceneSchema'
import { VideoEditSceneRejection, videoEditSceneTreeRows, type VideoEditSceneDeclarationState, type VideoEditSceneIssue } from '../application/videoEditScenes'

/*
 * 片子数据在界面上的称呼：片子数据面板与时间线子轨道共用，同一条记录在两处叫同一个名字。
 * 服务的问题与拒绝文字是写给助手的（记录 ID、属性名、做法），这里换成记录名、字段名和用户能做的事。
 */
type Declaration = VideoEditSceneDeclarationState['declaration']

/** 剪后秒数的读数：分:秒.百分秒。 */
export function videoEditSceneClock(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${(seconds - minutes * 60).toFixed(2).padStart(5, '0')}`
}
export function videoEditSceneKindOf(declaration: Declaration, kind: string): CodeSceneKindDeclaration | undefined {
  return declaration && Object.hasOwn(declaration.schema.kinds, kind) ? declaration.schema.kinds[kind] : undefined
}
/** 记录自己的名称：时间线标签字段，其次 name / text / title。 */
function recordLabel(record: VideoEditSceneRecord, kind: CodeSceneKindDeclaration | undefined): string {
  const keys = [kind?.lane?.label, 'name', 'text', 'title'].filter((key): key is string => Boolean(key))
  return keys.map(key => record.values[key]).find((item): item is string => typeof item === 'string' && item.length > 0) ?? ''
}
/** 代码参数里引用的片子数据：片段自己的参数与它上面代码效果的参数。 */
export function videoEditClipSceneIds(clip: VideoEditClip): string[] {
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
 * 界面上对记录、字段与问题的称呼：没有名称的记录叫“类型 + 序号”（序号按记录树里看到的顺序），问题与拒绝按问题的
 * 结构（哪条记录、哪个字段、字段的类型与取值）给固定的用户说法，不在原文里做替换——原文是写给助手的，会带记录 ID、素材 ID 与英文种类。
 */
export interface VideoEditSceneNaming {
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
export function videoEditSceneNaming(scene: VideoEditScene | undefined, state: VideoEditSceneDeclarationState | undefined, order: readonly VideoEditSceneRecord[], media: ReadonlyMap<string, CodeSceneMediaKind>): VideoEditSceneNaming {
  const declaration = state?.declaration
  const kindTitle = (kind: string): string => videoEditSceneKindOf(declaration, kind)?.title ?? kind
  const ordinals = new Map<string, number>(), counts = new Map<string, number>()
  for (const record of order) { const next = (counts.get(record.kind) ?? 0) + 1; counts.set(record.kind, next); ordinals.set(record.id, next) }
  const shortName = (record: VideoEditSceneRecord): string => recordLabel(record, videoEditSceneKindOf(declaration, record.kind)) || String(ordinals.get(record.id) ?? '')
  const name = (record: VideoEditSceneRecord): string => recordLabel(record, videoEditSceneKindOf(declaration, record.kind)) || `${kindTitle(record.kind)} ${ordinals.get(record.id) ?? ''}`.trim()
  const byId = new Map(scene?.records.map(record => [record.id, record]))
  const block = state?.block ? state.reason ? BLOCK_TEXT[state.reason] : '这份数据现在不能修改。' : undefined
  /** 字段取值问题的说法：素材与记录引用按取值判断是被删了还是种类不对，带格式说明的类型用固定说法，其余原文本就只有数字与中文。 */
  const valueText = (record: VideoEditSceneRecord | undefined, segments: readonly string[], message: string): string => {
    const kind = record && videoEditSceneKindOf(declaration, record.kind)
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
    const kind = record && videoEditSceneKindOf(declaration, record.kind)
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
/** 按全部展开时的记录树顺序编序号的称呼（面板树与时间线子轨道看到的序号一致）。 */
export function videoEditSceneNamingFor(scene: VideoEditScene | undefined, state: VideoEditSceneDeclarationState | undefined, resolved: ResolvedVideoEditScene | undefined, media: ReadonlyMap<string, CodeSceneMediaKind>): VideoEditSceneNaming {
  const order = scene ? videoEditSceneTreeRows(scene, state?.declaration?.schema, resolved).map(item => item.record) : []
  return videoEditSceneNaming(scene, state, order, media)
}
