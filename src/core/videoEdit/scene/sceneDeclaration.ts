import { CODE_MATERIAL_LIMITS, assertCodeMaterialKey, isCodeColor } from '../codeMaterial/contract'
import { declarationBoolean, declarationEnum, declarationFail, declarationFields, declarationNumber, declarationObject, declarationText } from '../codeMaterial/declarationReader'
import { textStyleSchema } from '../../imaging/vectorContent/text'
import { videoEditSceneSchemaIdSchema, type VideoEditScene, type VideoEditSceneRecord } from './sceneSchema'

/**
 * 片子数据结构的作者声明（作者接口 v5 的 scene 参数）与按声明校验记录。
 * 声明写在作者代码里：每类记录有哪些字段、字段是什么含义，软件据此生成时间线、画面手柄与检查器的编辑方式。
 * 从严：声明里未知的键、记录里未声明的字段一律拒绝。时间单位都是秒。
 */
export const CODE_SCENE_MIN_API_VERSION = 5
export const CODE_SCENE_LIMITS = Object.freeze({ kinds: 64, fields: 64, cues: 16, options: 64, listItems: 4096, pathPoints: CODE_MATERIAL_LIMITS.pathPoints, coordinate: 1e9, seconds: 86_400, margin: 600, textLength: 4096, uiKeyLength: 512 })
export const CODE_SCENE_FIELD_TYPES = ['time', 'duration', 'sourceTime', 'media', 'ref', 'desk', 'deskRect', 'deskPoint', 'deskPath', 'windowRegion', 'uiTrack', 'region', 'list', 'number', 'text', 'boolean', 'choice', 'color', 'textStyle', 'seed'] as const
export const CODE_SCENE_LANE_STYLES = ['bar', 'block', 'key', 'row', 'cut'] as const
export const CODE_SCENE_INFLUENCES = ['span', 'untilNext', 'neighbors'] as const
export const CODE_SCENE_MEDIA_KINDS = ['video', 'image', 'audio'] as const
export const CODE_SCENE_ROLES = ['cut', 'segment', 'shot'] as const
/** 窗口内容（role 'shot'）的约定字段与类型：倍速、叠化进来的时长、是否画录制鼠标。 */
export const CODE_SCENE_SHOT_FIELDS = Object.freeze({ rate: 'number', xf: 'duration', cursor: 'boolean' } as const)
export type CodeSceneFieldType = typeof CODE_SCENE_FIELD_TYPES[number]
export type CodeSceneLaneStyle = typeof CODE_SCENE_LANE_STYLES[number]
export type CodeSceneInfluence = typeof CODE_SCENE_INFLUENCES[number]
export type CodeSceneMediaKind = typeof CODE_SCENE_MEDIA_KINDS[number]
export type CodeSceneRole = typeof CODE_SCENE_ROLES[number]
export type CodeSceneValue = null | boolean | number | string | CodeSceneValue[] | { [key: string]: CodeSceneValue }

/**
 * 字段取值的语义类型：
 * - time：引用这份片子数据的代码片段的素材时间（秒，0 = 素材开头，未剪切，见 sceneSchema.ts 的时间约定）；anchor:'footage' 时也可写 {src}，表示所属素材播到第 src 秒的那一刻。
 * - duration：时长；作为记录类型的 duration（起止）时是未剪时间轴上的长度，和 at 一样不随剪切改写，
 *   剪后结束由软件按 at + duration 换算（跨剪切的记录剪后变短）。sourceTime：所属素材里的源时间；media：剪辑里的素材 ID；ref：同一份片子数据里另一条记录的 ID。
 * - desk：台面上的长度（间距、尺寸）；deskRect {x,y,width,height}、deskPoint {x,y}、deskPath [{x,y}…]：台面坐标。
 *   台面由作者代码定义，台面到画面的换算由作者代码完成，软件只按台面单位存取。
 * - windowRegion：所属素材画面里的一块区域；region：节目画面里的一块区域；都按画面比例 0–1 的 {x,y,width,height}。
 * - uiTrack {key}：跟着所属录屏里的界面元素走，key 是界面元素位置轨里的元素键。
 * - 其余同代码参数：number、text、boolean、choice、color（RGBA 0–1）、textStyle、seed。
 * sourceTime、windowRegion、uiTrack 与 anchor:'footage' 的 time 都按记录类型的 footage 解释，声明它们的类型必须声明 footage。
 */
export type CodeSceneValueDeclaration =
  | { type: 'time'; anchor?: 'footage' }
  | { type: 'duration'; min: number; max: number }
  | { type: 'sourceTime' }
  | { type: 'media'; accept: CodeSceneMediaKind[] }
  | { type: 'ref'; to: string[] }
  | { type: 'desk'; min: number; max: number }
  | { type: 'deskRect' }
  | { type: 'deskPoint' }
  | { type: 'deskPath'; maxPoints: number }
  | { type: 'windowRegion' }
  | { type: 'uiTrack' }
  | { type: 'region' }
  | { type: 'number'; min: number; max: number; step?: number; unit?: string }
  | { type: 'text'; maxLength: number; multiline: boolean }
  | { type: 'boolean' }
  | { type: 'choice'; options: string[] }
  | { type: 'color'; alpha: boolean }
  | { type: 'textStyle' }
  | { type: 'seed' }
export type CodeSceneListDeclaration = { type: 'list'; of: CodeSceneValueDeclaration; min: number; max: number }
/** 记录里的一个字段：没有 default 且未写 optional:true 的字段必填。 */
export type CodeSceneFieldDeclaration = (CodeSceneValueDeclaration | CodeSceneListDeclaration) & { title?: string; description?: string; optional: boolean; default?: CodeSceneValue }
export interface CodeSceneKindDeclaration {
  title?: string
  /**
   * 软件在解析片子数据时给这类记录的特殊处理。role 是特殊语义的唯一来源：不写就没有任何特殊语义，lane、influence
   * 等显示与时段声明不会被当成剪切、段落或窗口内容；未写 role 的旧声明（包括已发布黄金样本里的写法）按普通记录解析。
   * - cut：剪切。at 到结束这一段从片段时间里剪掉，之后的记录前移；可选布尔字段 enabled 为 false 时不生效。
   * - segment：段落。挂在它下面的记录随它一起被剪掉；{src} 锚定只在所在段落里找。须有起止。
   * - shot：窗口内容。同一父记录下同类的几项组成一张取帧时间表，软件据此取帧、默认叠化。须是 untilNext、声明 footage、
   *   恰好一个 sourceTime 字段（从素材第几秒放）；约定字段 rate（number）、xf（duration）、cursor（boolean）写了就要是这些类型。
   */
  role?: CodeSceneRole
  /** 允许的父记录类型：声明了就必须有父记录，没声明就不能有。 */
  parent?: string[]
  fields: Record<string, CodeSceneFieldDeclaration>
  /**
   * 记录在片段时间轴上的位置（必填 time 字段）；end（time 字段）或 duration（duration 字段）给出结束，二选一。
   * duration 是未剪时间轴上的长度：结束 = at + duration（未剪），写回时按未剪起止相减。
   */
  at?: string
  end?: string
  duration?: string
  /** 记录管多长：span 从 at 到结束；untilNext 到同一父记录下同类的下一条；neighbors 在前后两条之间过渡（像关键帧）。 */
  influence?: CodeSceneInfluence
  /** 前后余量（秒）：at 之前、结束之后还要留的时长，例如镜头提前起动、剪切口两侧的接缝。 */
  margin?: { before: number; after: number }
  /** 所属素材：必填的 media 字段，或 ref 字段（被引用的记录类型须自己声明 footage，{src} 与 windowRegion 按那条记录的素材换算）。 */
  footage?: string
  /** 时间线上怎么显示：bar 段落条、block 逐项小块、key 关键帧点、row 每项一条、cut 剪切标记；label 是显示名称的 text 字段。 */
  lane?: { style: CodeSceneLaneStyle; label?: string }
  /** 事件（音效等挂在它上面）：事件名 → 发生时刻的 time 字段。 */
  cues?: Record<string, { at: string; title?: string }>
}
export interface CodeSceneSchema { id: string; version: number; title?: string; kinds: Record<string, CodeSceneKindDeclaration> }

const FIELD_OPTIONS: Readonly<Record<CodeSceneFieldType, readonly string[]>> = {
  time: ['anchor'], duration: ['min', 'max'], sourceTime: [], media: ['accept'], ref: ['to'], desk: ['min', 'max'], deskRect: [], deskPoint: [], deskPath: ['maxPoints'],
  windowRegion: [], uiTrack: [], region: [], list: ['of', 'min', 'max'], number: ['min', 'max', 'step', 'unit'], text: ['maxLength', 'multiline'], boolean: [], choice: ['options'], color: ['alpha'], textStyle: [], seed: [],
}
const NEEDS_FOOTAGE: readonly CodeSceneFieldType[] = ['sourceTime', 'windowRegion', 'uiTrack']
/** 引用类字段没有通用默认值。 */
const NO_DEFAULT: readonly CodeSceneFieldType[] = ['media', 'ref', 'uiTrack']

function own<T>(record: Readonly<Record<string, T>>, key: string): T | undefined { return Object.hasOwn(record, key) ? record[key] : undefined }
function uniqueList<T extends string>(raw: unknown, label: string, allowed: readonly T[], expected: string): T[] {
  if (!Array.isArray(raw) || !raw.length || raw.length > CODE_SCENE_LIMITS.kinds) declarationFail(label, expected)
  const values = raw.map((value, index) => declarationEnum(value, allowed, `${label}[${index}]`))
  if (new Set(values).size !== values.length) declarationFail(label, `${expected}，不能重复`)
  return values
}

function parseField(raw: unknown, label: string, kinds: readonly string[], footage: boolean, top: boolean): CodeSceneFieldDeclaration | CodeSceneValueDeclaration {
  const item = declarationObject(raw, label)
  const type = declarationEnum(item.type, CODE_SCENE_FIELD_TYPES, `${label}.type`)
  if (!top && type === 'list') declarationFail(`${label}.type`, '非列表类型（列表项不能再是列表）')
  declarationFields(item, [...(top ? ['type', 'title', 'description', 'optional', 'default'] : ['type']), ...FIELD_OPTIONS[type]], label)
  if ((NEEDS_FOOTAGE.includes(type) || type === 'time' && item.anchor !== undefined) && !footage) declarationFail(label, '所在记录类型声明 footage（所属素材），sourceTime、windowRegion、uiTrack 与 anchor 时刻都按它解释')
  const seconds = (key: string, fallback: number, min: number): number => declarationNumber(item[key] ?? fallback, `${label}.${key}`, min, CODE_SCENE_LIMITS.seconds)
  let value: CodeSceneValueDeclaration | CodeSceneListDeclaration
  switch (type) {
    case 'time': value = item.anchor === undefined ? { type } : { type, anchor: declarationEnum(item.anchor, ['footage'] as const, `${label}.anchor`) }; break
    case 'duration': { const min = seconds('min', 0, 0); value = { type, min, max: seconds('max', CODE_SCENE_LIMITS.seconds, min) }; break }
    case 'media': value = { type, accept: item.accept === undefined ? [...CODE_SCENE_MEDIA_KINDS] : uniqueList(item.accept, `${label}.accept`, CODE_SCENE_MEDIA_KINDS, 'video、image、audio 组成的数组') }; break
    case 'ref': value = { type, to: uniqueList(item.to, `${label}.to`, kinds, '已声明记录类型组成的数组') }; break
    case 'desk': { const min = declarationNumber(item.min ?? 0, `${label}.min`, -CODE_SCENE_LIMITS.coordinate, CODE_SCENE_LIMITS.coordinate); value = { type, min, max: declarationNumber(item.max ?? CODE_SCENE_LIMITS.coordinate, `${label}.max`, min, CODE_SCENE_LIMITS.coordinate) }; break }
    case 'deskPath': value = { type, maxPoints: declarationNumber(item.maxPoints ?? CODE_SCENE_LIMITS.pathPoints, `${label}.maxPoints`, 2, CODE_SCENE_LIMITS.pathPoints, true) }; break
    case 'list': {
      const min = declarationNumber(item.min ?? 0, `${label}.min`, 0, CODE_SCENE_LIMITS.listItems, true)
      value = { type, of: parseField(item.of, `${label}.of`, kinds, footage, false) as CodeSceneValueDeclaration, min, max: declarationNumber(item.max ?? CODE_SCENE_LIMITS.listItems, `${label}.max`, Math.max(1, min), CODE_SCENE_LIMITS.listItems, true) }
      break
    }
    case 'number': {
      const min = declarationNumber(item.min, `${label}.min`, -Number.MAX_VALUE, Number.MAX_VALUE)
      value = { type, min, max: declarationNumber(item.max, `${label}.max`, min, Number.MAX_VALUE),
        ...(item.step === undefined ? {} : { step: declarationNumber(item.step, `${label}.step`, Number.MIN_VALUE, Number.MAX_VALUE) }),
        ...(item.unit === undefined ? {} : { unit: declarationText(item.unit, `${label}.unit`, 32, true) }) }
      break
    }
    case 'text': value = { type, maxLength: declarationNumber(item.maxLength ?? CODE_SCENE_LIMITS.textLength, `${label}.maxLength`, 1, CODE_SCENE_LIMITS.textLength, true), multiline: declarationBoolean(item.multiline ?? false, `${label}.multiline`) }; break
    case 'choice': {
      if (!Array.isArray(item.options) || !item.options.length || item.options.length > CODE_SCENE_LIMITS.options) declarationFail(`${label}.options`, `1–${CODE_SCENE_LIMITS.options} 个字符串`)
      const options = item.options.map((option, index) => declarationText(option, `${label}.options[${index}]`, 128))
      if (new Set(options).size !== options.length) declarationFail(`${label}.options`, '不重复的选项')
      value = { type, options }; break
    }
    case 'color': value = { type, alpha: declarationBoolean(item.alpha ?? true, `${label}.alpha`) }; break
    default: value = { type }
  }
  if (!top) return value as CodeSceneValueDeclaration
  if (item.optional !== undefined) declarationBoolean(item.optional, `${label}.optional`)
  if (item.optional === false && item.default !== undefined) declarationFail(`${label}.optional`, '有 default 的字段可以省略，不写 optional:false')
  const field: CodeSceneFieldDeclaration = { ...value, optional: item.default !== undefined || item.optional === true,
    ...(item.title === undefined ? {} : { title: declarationText(item.title, `${label}.title`, 80) }),
    ...(item.description === undefined ? {} : { description: declarationText(item.description, `${label}.description`, 1000, true) }) }
  if (item.default !== undefined) {
    if (NO_DEFAULT.includes(type) || type === 'list' && NO_DEFAULT.includes((value as CodeSceneListDeclaration).of.type)) declarationFail(`${label}.default`, '省略（引用类字段没有通用默认值）')
    const problems: string[] = []
    checkValue(field, item.default, `${label}.default`, (path, message) => problems.push(`${path} ${message}`))
    if (problems.length) declarationFail(`${label}.default`, `合法取值：${problems[0]}`)
    field.default = item.default as CodeSceneValue
  }
  return field
}

function parseKind(raw: unknown, label: string, kinds: readonly string[]): CodeSceneKindDeclaration {
  const item = declarationObject(raw, label)
  declarationFields(item, ['title', 'role', 'parent', 'fields', 'at', 'end', 'duration', 'influence', 'margin', 'footage', 'lane', 'cues'], label)
  const entries = Object.entries(declarationObject(item.fields, `${label}.fields`))
  if (!entries.length || entries.length > CODE_SCENE_LIMITS.fields) declarationFail(`${label}.fields`, `1–${CODE_SCENE_LIMITS.fields} 个字段`)
  const fields: Record<string, CodeSceneFieldDeclaration> = {}
  for (const [name, value] of entries) { assertCodeMaterialKey(name); fields[name] = parseField(value, `${label}.fields.${name}`, kinds, item.footage !== undefined, true) as CodeSceneFieldDeclaration }
  const field = (rawName: unknown, path: string, types: readonly CodeSceneFieldType[], required: boolean): string => {
    const name = declarationText(rawName, path, 64)
    const target = own(fields, name)
    if (!target || !types.includes(target.type) || required && target.optional) declarationFail(path, `本类记录${required ? '必填的' : '的'} ${types.join(' 或 ')} 字段名`)
    return name
  }
  const kind: CodeSceneKindDeclaration = { fields }
  if (item.title !== undefined) kind.title = declarationText(item.title, `${label}.title`, 80)
  if (item.parent !== undefined) kind.parent = uniqueList(item.parent, `${label}.parent`, kinds, '已声明记录类型组成的数组')
  if (item.footage !== undefined) kind.footage = field(item.footage, `${label}.footage`, ['media', 'ref'], true)
  if (item.at !== undefined) kind.at = field(item.at, `${label}.at`, ['time'], true)
  if (item.end !== undefined) kind.end = field(item.end, `${label}.end`, ['time'], true)
  if (item.duration !== undefined) kind.duration = field(item.duration, `${label}.duration`, ['duration'], true)
  if (kind.end && kind.duration) declarationFail(`${label}.duration`, 'end 与 duration 只给一个')
  const positioned = (key: string): void => { if (!kind.at) declarationFail(`${label}.${key}`, '先声明 at（记录在片段时间轴上的位置）') }
  if (kind.end || kind.duration) positioned(kind.end ? 'end' : 'duration')
  if (item.influence !== undefined) {
    positioned('influence')
    kind.influence = declarationEnum(item.influence, CODE_SCENE_INFLUENCES, `${label}.influence`)
    if (kind.influence === 'span' && !kind.end && !kind.duration) declarationFail(`${label}.influence`, 'span 同时声明 end 或 duration')
  }
  if (item.margin !== undefined) {
    positioned('margin')
    const margin = declarationObject(item.margin, `${label}.margin`); declarationFields(margin, ['before', 'after'], `${label}.margin`)
    kind.margin = { before: declarationNumber(margin.before ?? 0, `${label}.margin.before`, 0, CODE_SCENE_LIMITS.margin), after: declarationNumber(margin.after ?? 0, `${label}.margin.after`, 0, CODE_SCENE_LIMITS.margin) }
  }
  if (item.lane !== undefined) {
    positioned('lane')
    const lane = declarationObject(item.lane, `${label}.lane`); declarationFields(lane, ['style', 'label'], `${label}.lane`)
    kind.lane = { style: declarationEnum(lane.style, CODE_SCENE_LANE_STYLES, `${label}.lane.style`), ...(lane.label === undefined ? {} : { label: field(lane.label, `${label}.lane.label`, ['text'], false) }) }
  }
  if (item.cues !== undefined) {
    const cues = Object.entries(declarationObject(item.cues, `${label}.cues`))
    if (!cues.length || cues.length > CODE_SCENE_LIMITS.cues) declarationFail(`${label}.cues`, `1–${CODE_SCENE_LIMITS.cues} 个事件`)
    kind.cues = {}
    for (const [name, value] of cues) {
      assertCodeMaterialKey(name)
      const cue = declarationObject(value, `${label}.cues.${name}`); declarationFields(cue, ['at', 'title'], `${label}.cues.${name}`)
      kind.cues[name] = { at: field(cue.at, `${label}.cues.${name}.at`, ['time'], false), ...(cue.title === undefined ? {} : { title: declarationText(cue.title, `${label}.cues.${name}.title`, 80) }) }
    }
  }
  if (item.role !== undefined) {
    kind.role = declarationEnum(item.role, CODE_SCENE_ROLES, `${label}.role`)
    const require = (ok: boolean, expected: string): void => { if (!ok) declarationFail(`${label}.role`, `${kind.role} 记录类型${expected}`) }
    if (kind.role !== 'shot') require(Boolean(kind.at && (kind.end || kind.duration)), '声明 at 与 end 或 duration（起止）')
    if (kind.role === 'cut') require(!Object.hasOwn(fields, 'enabled') || fields.enabled.type === 'boolean', '的 enabled 字段是 boolean')
    if (kind.role === 'shot') {
      require(kind.influence === 'untilNext' && kind.footage !== undefined, '声明 influence: untilNext 与 footage')
      require(Object.values(fields).filter(value => value.type === 'sourceTime').length === 1, '恰好有一个 sourceTime 字段')
      for (const [name, type] of Object.entries(CODE_SCENE_SHOT_FIELDS)) require(!Object.hasOwn(fields, name) || fields[name].type === type, `的 ${name} 字段是 ${type}`)
    }
  }
  return kind
}

/** 读作者代码里 scene 参数的 schema 声明，返回规范化的结构；任何未知键或不自洽的声明都抛 PARAMETERS 错误。 */
export function parseCodeSceneSchema(raw: unknown, label = 'schema'): CodeSceneSchema {
  const item = declarationObject(raw, label)
  declarationFields(item, ['id', 'version', 'title', 'kinds'], label)
  const id = declarationText(item.id, `${label}.id`, 100)
  if (!videoEditSceneSchemaIdSchema.safeParse(id).success) declarationFail(`${label}.id`, '小写字母、数字与 . _ - 组成、首尾为字母或数字的结构标识')
  const version = declarationNumber(item.version, `${label}.version`, 1, 1_000_000, true)
  const entries = Object.entries(declarationObject(item.kinds, `${label}.kinds`))
  if (!entries.length || entries.length > CODE_SCENE_LIMITS.kinds) declarationFail(`${label}.kinds`, `1–${CODE_SCENE_LIMITS.kinds} 类记录`)
  const names = entries.map(([name]) => { assertCodeMaterialKey(name); return name })
  const kinds: Record<string, CodeSceneKindDeclaration> = {}
  for (const [name, value] of entries) kinds[name] = parseKind(value, `${label}.kinds.${name}`, names)
  // footage 经 ref 转给另一类记录时，沿引用一路走到 media 字段，不能断开或绕回自己。
  // 已确认能走到素材的类型记下来不再走，声明再怎么交叉引用也只把每类走一遍。
  const resolved = new Set<string>()
  for (const [name, kind] of Object.entries(kinds)) {
    const visit = (current: string, seen: readonly string[]): void => {
      if (resolved.has(current)) return
      const footage = own(kinds, current)!.footage
      if (footage === undefined) declarationFail(`${label}.kinds.${name}.footage`, `沿引用找到所属素材（${current} 类记录没有声明 footage）`)
      const field = own(kinds, current)!.fields[footage]
      if (field.type === 'ref') for (const target of field.to) {
        if (seen.includes(target)) declarationFail(`${label}.kinds.${name}.footage`, `不绕回的所属素材引用（${[...seen, target].join(' → ')}）`)
        visit(target, [...seen, target])
      }
      resolved.add(current)
    }
    if (kind.footage !== undefined) visit(name, [name])
  }
  return { id, version, ...(item.title === undefined ? {} : { title: declarationText(item.title, `${label}.title`, 80) }), kinds }
}

interface CheckEnvironment { records: ReadonlyMap<string, VideoEditSceneRecord>; recordId: string; media?: ReadonlyMap<string, CodeSceneMediaKind> }
type Report = (path: string, message: string) => void
const finite = (value: unknown, min = -Infinity, max = Infinity): value is number => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
function plain(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && [null, Object.prototype].includes(Object.getPrototypeOf(value))
    && Object.keys(value as object).length === keys.length && keys.every(key => Object.hasOwn(value as object, key))
}
function deskPoint(value: unknown): boolean { return plain(value, ['x', 'y']) && finite(value.x, -CODE_SCENE_LIMITS.coordinate, CODE_SCENE_LIMITS.coordinate) && finite(value.y, -CODE_SCENE_LIMITS.coordinate, CODE_SCENE_LIMITS.coordinate) }
function rect(value: unknown, ratio: boolean): boolean {
  if (!plain(value, ['x', 'y', 'width', 'height'])) return false
  const limit = CODE_SCENE_LIMITS.coordinate
  if (!ratio) return finite(value.x, -limit, limit) && finite(value.y, -limit, limit) && finite(value.width, Number.MIN_VALUE, limit) && finite(value.height, Number.MIN_VALUE, limit)
  // 比例区域允许浮点相加的微小误差，不允许伸出画面。
  return finite(value.x, 0, 1) && finite(value.y, 0, 1) && finite(value.width, Number.MIN_VALUE, 1) && finite(value.height, Number.MIN_VALUE, 1) && value.x + value.width <= 1 + 1e-9 && value.y + value.height <= 1 + 1e-9
}

/** 单个取值按声明检查；env 省略时（检查声明里的 default）不核对素材与记录引用是否存在。 */
function checkValue(field: CodeSceneValueDeclaration | CodeSceneListDeclaration, value: unknown, path: string, report: Report, env?: CheckEnvironment): void {
  const seconds = CODE_SCENE_LIMITS.seconds
  switch (field.type) {
    case 'time':
      if (!finite(value, 0, seconds) && !(field.anchor === 'footage' && plain(value, ['src']) && finite(value.src, 0, seconds))) report(path, field.anchor ? '期望片段时刻秒数，或 {src: 所属素材的源时间秒数}。' : '期望片段时刻秒数（0–86400）。')
      return
    case 'duration': if (!finite(value, field.min, field.max)) report(path, `期望 ${field.min}–${field.max} 秒的时长。`); return
    case 'sourceTime': if (!finite(value, 0, seconds)) report(path, '期望所属素材的源时间秒数（0–86400）。'); return
    case 'media': {
      if (typeof value !== 'string' || !value.length || value.length > 100) { report(path, '期望素材 ID。'); return }
      const kind = env?.media?.get(value)
      if (env?.media && !kind) report(path, `素材 ${value} 不在剪辑里。`)
      else if (kind && !field.accept.includes(kind)) report(path, `期望 ${field.accept.join('、')} 素材，${value} 是 ${kind}。`)
      return
    }
    case 'ref': {
      if (typeof value !== 'string' || !value.length || value.length > 100) { report(path, '期望同一份片子数据里的记录 ID。'); return }
      if (!env) return
      const target = env.records.get(value)
      if (value === env.recordId) report(path, '不能引用记录自己。')
      else if (!target || !field.to.includes(target.kind)) report(path, `期望引用 ${field.to.join('、')} 记录，${value} ${target ? `是 ${target.kind}` : '不存在'}。`)
      return
    }
    case 'desk': if (!finite(value, field.min, field.max)) report(path, `期望台面长度 ${field.min}–${field.max}。`); return
    case 'deskRect': if (!rect(value, false)) report(path, '期望台面矩形 {x,y,width,height}，宽高为正。'); return
    case 'deskPoint': if (!deskPoint(value)) report(path, '期望台面点 {x,y}。'); return
    case 'deskPath': if (!Array.isArray(value) || value.length < 2 || value.length > field.maxPoints || !value.every(deskPoint)) report(path, `期望 2–${field.maxPoints} 个台面点 [{x,y}…]。`); return
    case 'windowRegion': case 'region': if (!rect(value, true)) report(path, '期望画面比例 0–1 的区域 {x,y,width,height}，宽高为正且不伸出画面。'); return
    case 'uiTrack': if (!plain(value, ['key']) || typeof value.key !== 'string' || !value.key.length || value.key.length > CODE_SCENE_LIMITS.uiKeyLength) report(path, '期望界面元素 {key}。'); return
    case 'number': if (!finite(value, field.min, field.max)) report(path, `期望 ${field.min}–${field.max} 的数值。`); return
    case 'text': if (typeof value !== 'string' || value.length > field.maxLength) report(path, `期望不超过 ${field.maxLength} 字的文字。`); return
    case 'boolean': if (typeof value !== 'boolean') report(path, '期望布尔值。'); return
    case 'choice': if (typeof value !== 'string' || !field.options.includes(value)) report(path, `期望 ${field.options.join(' | ')}。`); return
    case 'color': if (!isCodeColor(value) || !field.alpha && value[3] !== 1) report(path, field.alpha ? '期望 RGBA 0–1 颜色。' : '期望 RGBA 0–1 颜色，alpha 固定 1。'); return
    case 'textStyle': if (!textStyleSchema.safeParse(value).success) report(path, '期望文字样式。'); return
    case 'seed': if (!Number.isInteger(value) || !finite(value, 0, 4294967295)) report(path, '期望 0–4294967295 的整数种子。'); return
    case 'list':
      if (!Array.isArray(value) || value.length < field.min || value.length > field.max) { report(path, `期望 ${field.min}–${field.max} 项的数组。`); return }
      value.forEach((item, index) => checkValue(field.of, item, `${path}.${index}`, report, env))
  }
}
function pathResolves(values: Readonly<Record<string, unknown>>, path: string): boolean {
  const [head, ...rest] = path.split('.')
  if (!Object.hasOwn(values, head)) return false
  let current: unknown = values[head]
  for (const segment of rest) {
    if (Array.isArray(current)) { const index = Number(segment); if (!/^(?:0|[1-9]\d*)$/.test(segment) || index >= current.length) return false; current = current[index] }
    else if (current && typeof current === 'object' && Object.hasOwn(current, segment)) current = (current as Record<string, unknown>)[segment]
    else return false
  }
  return true
}

export interface CodeSceneIssue { recordId?: string; path: string; message: string }
export interface CodeSceneValidationContext {
  /** 剪辑里的素材 ID → 种类；给出时核对 media 字段引用的素材存在且种类相符。 */
  media?: ReadonlyMap<string, CodeSceneMediaKind>
}
/**
 * 按代码声明逐条检查片子数据（文档层的通用外形、记录 ID 唯一与父级存在已由 videoEditSceneSchema 保证）。
 * 返回全部问题，空数组即合法；调用方据此拒绝写入，或把问题标在时间线上。
 */
export function validateCodeSceneRecords(schema: CodeSceneSchema, scene: VideoEditScene, context: CodeSceneValidationContext = {}): CodeSceneIssue[] {
  const issues: CodeSceneIssue[] = []
  if (scene.schema.id !== schema.id || scene.schema.version !== schema.version) issues.push({ path: 'schema', message: `片子数据按 ${scene.schema.id}@${scene.schema.version} 写成，代码声明的是 ${schema.id}@${schema.version}。` })
  const records = new Map(scene.records.map(record => [record.id, record]))
  for (const record of scene.records) {
    const report: Report = (path, message) => { issues.push({ recordId: record.id, path, message }) }
    const kind = own(schema.kinds, record.kind)
    if (!kind) { report('kind', `代码没有声明 ${record.kind} 类记录。`); continue }
    const parent = record.parent === undefined ? undefined : records.get(record.parent)
    if (kind.parent && (!parent || !kind.parent.includes(parent.kind))) report('parent', `${record.kind} 记录的父记录须是 ${kind.parent.join('、')}。`)
    else if (!kind.parent && record.parent !== undefined) report('parent', `${record.kind} 记录不能有父记录。`)
    for (const key of Object.keys(record.values)) if (!Object.hasOwn(kind.fields, key)) report(`values.${key}`, `${record.kind} 记录没有声明这个字段。`)
    for (const [name, field] of Object.entries(kind.fields)) {
      if (Object.hasOwn(record.values, name)) checkValue(field, record.values[name], `values.${name}`, report, { records, recordId: record.id, media: context.media })
      else if (!field.optional) report(`values.${name}`, '缺少必填字段。')
    }
    const at = kind.at === undefined ? undefined : record.values[kind.at], end = kind.end === undefined ? undefined : record.values[kind.end]
    if (typeof at === 'number' && typeof end === 'number' && end < at) report(`values.${kind.end}`, '结束不能早于开始。')
    for (const path of record.tuned ?? []) if (!pathResolves(record.values, path)) report('tuned', `手调字段 ${path} 不在记录的取值里。`)
  }
  return issues
}
