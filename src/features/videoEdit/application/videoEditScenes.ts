import { createLogger } from '@/core/logging'
import { isCodeSceneReference } from '@/core/videoEdit/codeMaterial/contract'
import type { CodeMaterialInstance } from '@/core/videoEdit/codeMaterialPersistence'
import type { VideoEditDocument } from '@/core/videoEdit/document'
import { validateCodeSceneRecords, type CodeSceneKindDeclaration, type CodeSceneMediaKind, type CodeSceneSchema, type CodeSceneValue } from '@/core/videoEdit/scene/sceneDeclaration'
import { videoEditSceneMedia } from '@/core/videoEdit/scene/sceneMedia'
import { resolveVideoEditScene, videoEditSceneWriteBackSpan, videoEditSceneWriteBackTime, type ResolvedVideoEditScene, type ResolvedVideoEditSceneRecord } from '@/core/videoEdit/scene/sceneResolve'
import { VIDEO_EDIT_SCENE_LIMITS, videoEditSceneSchema, type VideoEditScene, type VideoEditSceneRecord } from '@/core/videoEdit/scene/sceneSchema'
import { ensureVideoEditCodeParameterMetadata, readVideoEditCodeMetadata } from './videoEditCodeState'
import { isVideoEditContentCurrent } from './videoEditDocumentAlgorithm'
import { editVideoProject, finishVideoEditGesture, requireVideoEditInstance, updateVideoEditParameterGesture, videoEditCommittedDocument, withVideoEditCommitBatch, type VideoEditCommitBatch, type VideoEditGesture, type VideoEditInstance } from './videoEditService'

/*
 * 片子数据的领域服务：读（按引用它的代码版本声明解析、校验）与写入入口（writeVideoEditScene 改记录与名称，
 * createVideoEditScenes / removeVideoEditScenes 增删整份）。界面（检查器、时间线拖动）与助手通用写入都走这里，
 * 所以撤销栈、事务批与校验规则只有一份。
 *
 * 手调标记（tuned）与口播剪辑里 reason:'manual' 是同一规则：人或助手直接改过的地方归用户所有，
 * 之后重新生成、重排都绕开它。
 * - 逐条修改（update 的 values、retime）改到的字段自动记进 tuned。取值相等按规范化比较：键的顺序不算，写成声明默认值视同没写。
 * - 同一次修改显式给出整份 tuned 时以它为准；只是去掉几条路径（untune）时，去掉点名的，本次改到的字段照样记入。
 *   通用实体写入要求 tuned 单独一次修改（不和同一记录的 values、剪后时刻同步或同事务），这样 tuned 能按读回核对。
 * - 整份替换（replace_records）与新建（create）写的是完整状态，tuned 按写入的原样保存。
 * - origin 为 generated 的写入（重新生成、迁移）不记手调。
 * - 恢复自动只清掉标记，不改取值：下次重新生成时这些字段才被覆盖。
 */
const logger = createLogger('features.videoEdit.scenes')

export type VideoEditSceneRecordInput = Omit<VideoEditSceneRecord, 'id'> & { id?: string }
export type VideoEditSceneChange =
  | { kind: 'rename'; name: string }
  /** 整份替换全部记录（一次改很多条时用，不受事务步数限制）。 */
  | { kind: 'replace_records'; records: readonly VideoEditSceneRecord[] }
  | { kind: 'create'; records: readonly VideoEditSceneRecordInput[] }
  /** values 整体替换；parent 写 null 去掉父记录；tuned 是显式的整份手调路径，untune 是要去掉的几条。 */
  | { kind: 'update'; recordId: string; values?: Readonly<Record<string, CodeSceneValue>>; parent?: string | null; tuned?: readonly string[]; untune?: readonly string[] }
  /** 按剪后时刻改记录的位置：经写回函数换成文档里的未剪时刻。只给一侧时另一侧保持当前剪后时刻（改那一头）。 */
  | { kind: 'retime'; recordId: string; start?: number; end?: number }
  | { kind: 'remove'; recordIds: readonly string[] }
  /** 恢复自动：清掉这些手调路径（省略时清掉全部），取值不变。 */
  | { kind: 'restore_automatic'; recordId: string; paths?: readonly string[] }
export interface VideoEditSceneWriteOptions {
  /** 通用事务的提交批：同一事务对同一剪辑的多步写入合成一次提交、一步撤销。 */
  readonly batch?: VideoEditCommitBatch
  /** manual（默认）：人或助手的直接修改，改到的字段记手调；generated：重新生成、迁移等自动结果。 */
  readonly origin?: 'manual' | 'generated'
  /** 检查器拖动的手势（预览见 previewVideoEditSceneGesture）：松手时经这里按声明校验并整笔提交，一步撤销。 */
  readonly gesture?: VideoEditGesture
}
/** 读回与拒绝里的一条问题；severity 为 user 的会让画面缺内容、用户又难以察觉，必须呈现给用户。 */
export interface VideoEditSceneIssue { readonly recordId?: string; readonly path: string; readonly message: string; readonly severity?: 'user' }
/** 写入被拒（写入之前，剪辑没有任何改动）；issues 点名记录与字段，界面据此标出。 */
export class VideoEditSceneRejection extends Error {
  override readonly name = 'VideoEditSceneRejection'
  constructor(readonly sceneName: string, readonly issues: readonly VideoEditSceneIssue[], outcome = '未写入') {
    super(`片子数据“${sceneName}”${outcome}：${issues.slice(0, 8).map(formatIssue).join('；')}${issues.length > 8 ? `；等共 ${issues.length} 处` : ''}`)
  }
}
const formatIssue = (issue: VideoEditSceneIssue): string => `${issue.recordId === undefined ? '' : `记录 ${issue.recordId} 的 `}${issue.path}：${issue.message}`
const issueKey = (issue: VideoEditSceneIssue): string => JSON.stringify([issue.recordId ?? null, issue.path, issue.message])
/** 键序无关的 JSON 文本，取值比较都用它。 */
function canonical(value: unknown): string {
  const sort = (item: unknown): unknown => Array.isArray(item) ? item.map(sort) : item && typeof item === 'object' ? Object.fromEntries(Object.keys(item).sort().map(key => [key, sort((item as Record<string, unknown>)[key])])) : item
  return JSON.stringify(sort(value)) ?? 'undefined'
}

export function findVideoEditScene(document: Pick<VideoEditDocument, 'scenes'>, sceneId: string): VideoEditScene {
  const scene = document.scenes?.find(item => item.id === sceneId)
  if (!scene) throw new Error(`NOT_FOUND：片子数据 ${sceneId} 不在这份剪辑里${document.scenes?.length ? `，现有：${document.scenes.map(item => item.id).join('、')}` : '，剪辑里还没有片子数据'}。`)
  return scene
}

/** 持有代码实例的对象：素材项、片段（含镜头版本里的链接音频片段）或片段上的代码效果。 */
export interface VideoEditSceneCodeHolder { readonly kind: 'video_edit.item' | 'video_edit.clip' | 'video_edit.effect'; readonly id: string; readonly name: string }
/** 引用这份片子数据的代码实例与参数键（与文档层的引用核对同一范围）。 */
export function videoEditSceneCodeReferences(document: VideoEditDocument, sceneId: string): Array<{ code: CodeMaterialInstance; key: string; holder: VideoEditSceneCodeHolder }> {
  const clips = document.sequences.flatMap(sequence => sequence.clips.flatMap(clip => [clip, ...(clip.takes ?? []).flatMap(take => take.linkedAudio?.map(entry => entry.clip) ?? [])]))
  const holders: Array<{ code: CodeMaterialInstance | undefined; holder: VideoEditSceneCodeHolder }> = [
    ...document.items.map(item => ({ code: item.code, holder: { kind: 'video_edit.item' as const, id: item.id, name: item.name } })),
    ...clips.flatMap(clip => [{ code: clip.code, holder: { kind: 'video_edit.clip' as const, id: clip.id, name: clip.name } }, ...(clip.effects ?? []).map(effect => ({ code: effect.code, holder: { kind: 'video_edit.effect' as const, id: effect.id, name: effect.name } }))]),
  ]
  return holders.flatMap(({ code, holder }) => code ? Object.entries(code.parameters).filter(([, value]) => isCodeSceneReference(value) && value.sceneId === sceneId).map(([key]) => ({ code, key, holder })) : [])
}

/** 一处引用读到的声明：结构，以及声明它的代码版本与 scene 参数键。 */
export interface VideoEditSceneDeclaration { readonly schema: CodeSceneSchema; readonly versionId: string; readonly parameterKey: string }
/** 引用片子数据的代码声明汇总；读回、解析与写入都按它判断用哪份声明、能不能写。 */
export interface VideoEditSceneDeclarationState {
  /** 解析、读回与校验用的声明：与片子数据记的结构（id@version）一致的那份，都不一致取第一份；一份都读不到时 undefined。 */
  readonly declaration: VideoEditSceneDeclaration | undefined
  /** 不能改记录的原因（这时只能改名）；可以改时 undefined。 */
  readonly block: string | undefined
  /** 不能改的原因归类（有 block 时给出）：block 是写给助手的做法，界面按它换成用户语言的说明。 */
  readonly reason?: 'unreferenced' | 'unreadable' | 'mismatch'
  /** 不挡写入、但读回要让人知道的情况。 */
  readonly notes: readonly VideoEditSceneIssue[]
}
const NO_DECLARATION = '没有代码片段引用这份片子数据，无法按代码声明校验；先把代码片段的 scene 参数写成 {kind:"scene",sceneId}（可以和改记录放在同一次事务里，写在前面）。'
const RESTRUCTURE = '结构不一致时只能改名。做法：在 video_edit.document 下新建一份片子数据（declaration_source 写新结构的代码版本与参数），把记录按新结构写进去，再把代码片段的 scene 参数改成引用新的，最后删掉这份。'
/**
 * 由各处引用读到的声明判断：一份都读不到时，没有引用和代码版本暂时读不到分开说；任何一处读到的结构与片子数据记的
 * 不一致都如实报出并只能改名（一处一致不能替另一处担保，按那份写会让另一处画错）。
 */
export function videoEditSceneDeclarationState(scene: Pick<VideoEditScene, 'schema'>, readable: readonly VideoEditSceneDeclaration[], unreadable: readonly string[]): VideoEditSceneDeclarationState {
  const same = (item: VideoEditSceneDeclaration): boolean => item.schema.id === scene.schema.id && item.schema.version === scene.schema.version
  const unreadableText = `引用它的代码版本暂时读不到（${[...new Set(unreadable)].join('、')}）`
  if (!readable.length) return unreadable.length
    ? { declaration: undefined, block: `${unreadableText}，无法按代码声明校验；代码恢复可读（补齐源码或编译通过）后再改。`, reason: 'unreadable', notes: [] }
    : { declaration: undefined, block: NO_DECLARATION, reason: 'unreferenced', notes: [] }
  const mismatched = readable.filter(item => !same(item))
  return {
    declaration: readable.find(same) ?? readable[0],
    ...(mismatched.length ? { reason: 'mismatch' as const } : {}),
    block: mismatched.length ? `片子数据按 ${scene.schema.id}@${scene.schema.version} 写成，引用它的代码里 ${mismatched.map(item => `版本 ${item.versionId} 的参数 ${item.parameterKey} 声明的是 ${item.schema.id}@${item.schema.version}`).join('、')}。${RESTRUCTURE}` : undefined,
    notes: unreadable.length ? [{ path: 'schema', message: `${unreadableText}，没有用它们核对。` }] : [],
  }
}
/** 读引用这份片子数据的各处代码声明（读不到的代码版本单独记下）。 */
export async function loadVideoEditSceneDeclarations(owner: VideoEditInstance, document: VideoEditDocument, sceneId: string): Promise<VideoEditSceneDeclarationState> {
  const scene = findVideoEditScene(document, sceneId)
  const readable: VideoEditSceneDeclaration[] = [], unreadable: string[] = []
  for (const { code, key } of videoEditSceneCodeReferences(document, sceneId)) {
    try {
      await ensureVideoEditCodeParameterMetadata(owner, document, code.definitionId, code.versionId)
      const declaration = readVideoEditCodeMetadata(owner, document)(code).parameters.find(parameter => parameter.key === key)
      if (declaration?.type === 'scene' && !readable.some(item => item.schema === declaration.schema)) readable.push({ schema: declaration.schema, versionId: code.versionId, parameterKey: key })
    } catch (error) {
      unreadable.push(code.versionId)
      logger.debug('引用片子数据的代码版本读不到', { event: 'video_edit.scene.declaration.unreadable', error, context: { sceneId, versionId: code.versionId } })
    }
  }
  return videoEditSceneDeclarationState(scene, readable, unreadable)
}

const validated = new WeakMap<VideoEditScene, { schema: CodeSceneSchema; media: ReadonlyMap<string, CodeSceneMediaKind>; issues: readonly VideoEditSceneIssue[] }>()
/**
 * 读回的问题：不能改记录的原因与说明在前，再是按声明校验与解析时发现的问题（同一条只报一次；校验与解析按片子数据、
 * 声明与素材表的对象身份缓存）。
 */
export function videoEditSceneIssues(scene: VideoEditScene, state: VideoEditSceneDeclarationState, media: ReadonlyMap<string, CodeSceneMediaKind>): readonly VideoEditSceneIssue[] {
  const head: VideoEditSceneIssue[] = [...(state.block ? [{ path: 'schema', message: state.block }] : []), ...state.notes]
  const schema = state.declaration?.schema
  if (!schema) return head
  let cached = validated.get(scene)
  if (cached?.schema !== schema || cached.media !== media) {
    const all: VideoEditSceneIssue[] = [...validateCodeSceneRecords(schema, scene, { media }), ...resolveVideoEditScene(scene, schema, { media }).issues]
    const seen = new Set<string>()
    cached = { schema, media, issues: all.filter(issue => { const key = issueKey(issue); if (seen.has(key)) return false; seen.add(key); return true }) }
    validated.set(scene, cached)
  }
  // 结构不一致已经由 block 说清楚，校验再报的同义问题不重复。
  return [...head, ...state.block ? cached.issues.filter(issue => issue.path !== 'schema') : cached.issues]
}
/** 剪后时刻的全片描述；没有声明时 undefined。 */
export function resolveVideoEditSceneView(scene: VideoEditScene, schema: CodeSceneSchema | undefined, media: ReadonlyMap<string, CodeSceneMediaKind>): ResolvedVideoEditScene | undefined {
  return schema ? resolveVideoEditScene(scene, schema, { media }) : undefined
}
/** 检查器记录树的一行：深度、子记录数与解析结果（被剪掉的记录没有解析结果）。 */
export interface VideoEditSceneTreeRow {
  readonly record: VideoEditSceneRecord
  readonly depth: number
  readonly childCount: number
  readonly resolved: ResolvedVideoEditSceneRecord | undefined
}
/**
 * 记录树按 parent 展开成行：同一层先按声明里记录类型的顺序（段落、窗口、窗口内容……，未声明的类型排最后），
 * 再按开始时刻（剪后；被剪掉的取记录里的时刻），最后按文档顺序。collapsed 里的记录不展开子记录。
 */
export function videoEditSceneTreeRows(scene: VideoEditScene, schema: CodeSceneSchema | undefined, resolved: ResolvedVideoEditScene | undefined, collapsed: ReadonlySet<string> = new Set()): VideoEditSceneTreeRow[] {
  const kinds = schema ? Object.keys(schema.kinds) : []
  const order = new Map(scene.records.map((record, index) => [record.id, index]))
  const kindIndex = (record: VideoEditSceneRecord): number => { const index = kinds.indexOf(record.kind); return index < 0 ? kinds.length : index }
  const start = (record: VideoEditSceneRecord): number => {
    const at = resolved?.byId.get(record.id)?.at
    if (at !== undefined) return at
    const field = schema && Object.hasOwn(schema.kinds, record.kind) ? schema.kinds[record.kind].at : undefined
    const raw = field === undefined ? undefined : record.values[field]
    return typeof raw === 'number' ? raw : Infinity
  }
  const children = new Map<string | undefined, VideoEditSceneRecord[]>()
  for (const record of scene.records) {
    const parent = record.parent !== undefined && order.has(record.parent) ? record.parent : undefined
    const list = children.get(parent) ?? []; list.push(record); children.set(parent, list)
  }
  // 时刻相同（含都没有时刻）时按文档顺序：Infinity − Infinity 是 NaN，不能直接相减。
  const byStart = (a: VideoEditSceneRecord, b: VideoEditSceneRecord): number => { const x = start(a), y = start(b); return x === y ? 0 : x < y ? -1 : 1 }
  for (const list of children.values()) list.sort((a, b) => kindIndex(a) - kindIndex(b) || byStart(a, b) || order.get(a.id)! - order.get(b.id)!)
  const rows: VideoEditSceneTreeRow[] = []
  const visit = (parent: string | undefined, depth: number): void => {
    for (const record of children.get(parent) ?? []) {
      const count = children.get(record.id)?.length ?? 0
      rows.push({ record, depth, childCount: count, resolved: resolved?.byId.get(record.id) })
      if (count && !collapsed.has(record.id)) visit(record.id, depth + 1)
    }
  }
  visit(undefined, 0)
  return rows
}
/** 解析阶段会让画面缺内容的问题（severity 为 user）：写入不因它们被拒，但要在回执里告诉调用方。 */
function userWarnings(scene: VideoEditScene, schema: CodeSceneSchema | undefined, media: ReadonlyMap<string, CodeSceneMediaKind>): VideoEditSceneIssue[] {
  return schema ? resolveVideoEditScene(scene, schema, { media }).issues.filter(issue => issue.severity === 'user') : []
}

export interface VideoEditSceneWriteContext {
  readonly schema: CodeSceneSchema | undefined
  /** 不能改记录的原因（来自 videoEditSceneDeclarationState）；省略时只按 schema 有没有、与片子数据记的结构是否一致判断。 */
  readonly block?: string
  readonly media: ReadonlyMap<string, CodeSceneMediaKind>
  readonly origin?: 'manual' | 'generated'
}
/**
 * 按顺序套用修改并从严校验，返回新的片子数据；任何问题都整体拒绝（VideoEditSceneRejection），不改输入。
 * 纯函数：时间线拖动的实时预览可以直接用它算草稿。
 * 校验规则：结构问题（记录重复、父级悬空或成环、超限）一律拒绝；按声明校验时只拒绝这次修改新引入的问题，
 * 写入前就有的（例如引用的素材后来被删）不挡住改别处，读回时仍会报出来。问题按 记录、路径、问题与那处的取值认同一条：
 * 同一字段从一个不合法值改成另一个不合法值也算新问题；列表下标不参与比较，删掉前面的项不会让后面原有的问题变“新”。
 */
export function applyVideoEditSceneChanges(scene: VideoEditScene, changes: readonly VideoEditSceneChange[], context: VideoEditSceneWriteContext): VideoEditScene {
  const manual = (context.origin ?? 'manual') === 'manual'
  let name = scene.name
  let records: VideoEditSceneRecord[] = scene.records.slice()
  const reject = (issues: VideoEditSceneIssue[]): never => {
    logger.info('片子数据修改被拒', { event: 'video_edit.scene.write.rejected', context: { sceneId: scene.id, issues: issues.length, first: issues[0] && formatIssue(issues[0]).slice(0, 200) } })
    throw new VideoEditSceneRejection(scene.name, issues)
  }
  const indexOf = (recordId: string): number => {
    const index = records.findIndex(record => record.id === recordId)
    if (index < 0) reject([{ recordId, path: 'id', message: `记录不存在${records.length ? `；这份片子数据有 ${records.length} 条记录，用读回的 record_id` : '，片子数据里还没有记录'}。` }])
    return index
  }
  const schemaOrReject = (): CodeSceneSchema => {
    const block = context.block ?? (!context.schema ? NO_DECLARATION : context.schema.id !== scene.schema.id || context.schema.version !== scene.schema.version ? `片子数据按 ${scene.schema.id}@${scene.schema.version} 写成，代码声明的是 ${context.schema.id}@${context.schema.version}。${RESTRUCTURE}` : undefined)
    if (block) reject([{ path: 'schema', message: block }])
    return context.schema!
  }
  const kindOf = (schema: CodeSceneSchema, record: VideoEditSceneRecord): CodeSceneKindDeclaration | undefined => Object.hasOwn(schema.kinds, record.kind) ? schema.kinds[record.kind] : undefined
  let recordsChanged = false
  for (const change of changes) {
    if (change.kind === 'rename') { name = change.name; continue }
    const schema = schemaOrReject()
    recordsChanged = true
    switch (change.kind) {
      case 'replace_records': records = change.records.slice(); break
      case 'create': {
        const ids = new Set(records.map(record => record.id))
        for (const input of change.records) {
          const id = input.id ?? crypto.randomUUID()
          if (ids.has(id)) reject([{ recordId: id, path: 'id', message: '记录 ID 已存在，换一个或省略自动生成。' }])
          ids.add(id)
          records.push({ ...input, id })
        }
        break
      }
      case 'update': {
        const index = indexOf(change.recordId), current = records[index]
        const values = change.values ? { ...change.values } as VideoEditSceneRecord['values'] : current.values
        const next: VideoEditSceneRecord = { ...current, values }
        if (change.parent === null || change.parent === '') delete next.parent
        else if (change.parent !== undefined) next.parent = change.parent
        const kept = (current.tuned ?? []).filter(path => !change.untune?.includes(path))
        setTuned(next, change.tuned ?? (manual && change.values ? markTuned(kept, changedFields(current.values, values, kindOf(schema, current)), values) : kept))
        records[index] = next
        break
      }
      case 'retime': {
        const index = indexOf(change.recordId)
        records[index] = retimeRecord(records[index], change, schema, { ...scene, name, records }, context.media, manual, reject)
        break
      }
      case 'remove': {
        const gone = new Set(change.recordIds.map(id => records[indexOf(id)].id))
        records = records.filter(record => !gone.has(record.id))
        break
      }
      case 'restore_automatic': {
        const index = indexOf(change.recordId), current = records[index]
        const next = { ...current }
        setTuned(next, change.paths ? current.tuned?.filter(path => !change.paths!.includes(path)) : undefined)
        records[index] = next
        break
      }
    }
  }
  const draft = { ...scene, name, records }
  const parsed = videoEditSceneSchema.safeParse(draft)
  if (!parsed.success) reject(parsed.error.issues.map(issue => {
    const [records, index, ...path] = issue.path
    const recordId = records === 'records' && typeof index === 'number' ? draft.records[index]?.id : undefined
    return { ...(recordId === undefined ? {} : { recordId }), path: (recordId === undefined ? issue.path : path).join('.') || 'records', message: issue.message }
  }))
  const next = parsed.data!
  if (!recordsChanged) return next
  const schema = context.schema!
  const before = existingIssueKeys(scene, schema, context.media)
  const identity = issueIdentity(next)
  const introduced = validateCodeSceneRecords(schema, next, { media: context.media }).filter(issue => !before.has(identity(issue)))
  if (introduced.length) reject(introduced)
  return next
}
const existingIssues = new WeakMap<VideoEditScene, { schema: CodeSceneSchema; media: ReadonlyMap<string, CodeSceneMediaKind>; keys: ReadonlySet<string> }>()
/** 写入前就有的问题：拖动时每一下都按同一份手势起点套用修改，起点的校验按对象身份只算一次。 */
function existingIssueKeys(scene: VideoEditScene, schema: CodeSceneSchema, media: ReadonlyMap<string, CodeSceneMediaKind>): ReadonlySet<string> {
  const cached = existingIssues.get(scene)
  if (cached?.schema === schema && cached.media === media) return cached.keys
  const keys = new Set(validateCodeSceneRecords(schema, scene, { media }).map(issueIdentity(scene)))
  existingIssues.set(scene, { schema, media, keys })
  return keys
}
/** 认同一条问题：记录、去掉列表下标的路径、问题文字，以及路径那处的取值。 */
function issueIdentity(scene: VideoEditScene): (issue: VideoEditSceneIssue) => string {
  const records = new Map(scene.records.map(record => [record.id, record]))
  return issue => {
    const record = issue.recordId === undefined ? undefined : records.get(issue.recordId)
    const value = !record ? undefined : issue.path.startsWith('values.') ? valueAt(record.values, issue.path.slice('values.'.length)).value : issue.path === 'kind' || issue.path === 'parent' || issue.path === 'tuned' ? record[issue.path] : undefined
    return JSON.stringify([issue.recordId ?? null, issue.path.replace(/\.(?:0|[1-9]\d*)(?=\.|$)/g, '.*'), issue.message, canonical(value)])
  }
}

function setTuned(record: VideoEditSceneRecord, tuned: readonly string[] | undefined): void {
  if (tuned?.length) record.tuned = [...tuned]
  else delete record.tuned
}
/**
 * 取值变了或新写的字段：按规范化取值比较（键序不算；没写的字段按声明默认值，写成默认值视同没写）。
 * 删掉的字段回到默认值，不算手调。
 */
function changedFields(before: Readonly<Record<string, unknown>>, after: Readonly<Record<string, unknown>>, kind: CodeSceneKindDeclaration | undefined): string[] {
  const effective = (values: Readonly<Record<string, unknown>>, key: string): unknown => Object.hasOwn(values, key) ? values[key] : kind && Object.hasOwn(kind.fields, key) ? kind.fields[key].default : undefined
  return Object.keys(after).filter(key => canonical(effective(before, key)) !== canonical(after[key]))
}
/**
 * 把改到的字段并进手调路径：已有的路径保持原顺序，被整字段覆盖的子路径（target.x 之于 target）并掉，
 * 取值里已经不存在的路径（字段删掉、列表变短）去掉。
 */
function markTuned(tuned: readonly string[], fields: readonly string[], values: Readonly<Record<string, unknown>>): string[] {
  const kept = tuned.filter(path => !fields.some(field => path.startsWith(`${field}.`)) && valueAt(values, path).found)
  return [...kept, ...fields.filter(field => !kept.includes(field))]
}
/**
 * 按剪后时刻改位置。两侧都给时整条按 videoEditSceneWriteBackSpan 写回；只给一侧时只改那一侧，另一侧的原值
 * （包括按录屏秒锚定的 {src}）原样保留、不记手调。用时长表达结束的类型改开始时按“结束不动”重算未剪时长。
 * 写完按解析结果核对：剪后时刻要等于要求的（落进剪切被丢掉、窗口内容从剪切口才开始放的都拒绝），读回才对得上。
 */
function retimeRecord(record: VideoEditSceneRecord, change: Extract<VideoEditSceneChange, { kind: 'retime' }>, schema: CodeSceneSchema, working: VideoEditScene, media: ReadonlyMap<string, CodeSceneMediaKind>, manual: boolean, reject: (issues: VideoEditSceneIssue[]) => never): VideoEditSceneRecord {
  const kind = Object.hasOwn(schema.kinds, record.kind) ? schema.kinds[record.kind] : undefined
  const fail = (message: string): never => reject([{ recordId: record.id, path: kind?.at ? `values.${kind.at}` : 'kind', message }])
  if (!kind?.at) return fail(`${record.kind} 记录没有声明时刻（at），不能改位置。`)
  const spans = Boolean(kind.end || kind.duration)
  if (!spans && change.end !== undefined) return fail(`${record.kind} 记录是时间点，只有开始时刻。`)
  if (change.start === undefined && change.end === undefined) return fail('给出开始或结束的剪后时刻。')
  for (const value of [change.start, change.end]) if (value !== undefined && (!Number.isFinite(value) || value < 0)) return fail('剪后时刻须是非负的秒数。')
  if (change.start !== undefined && change.end !== undefined && change.end < change.start) return fail('结束不能早于开始。')
  const { cuts, byId } = resolveVideoEditScene(working, schema, { media })
  const current = byId.get(record.id)
  const number = (name: string | undefined): number | undefined => { const value = name === undefined ? undefined : record.values[name]; return typeof value === 'number' && Number.isFinite(value) ? value : undefined }
  const at = number(kind.at), duration = number(kind.duration)
  // 未剪开始：按录屏秒锚定的取剪后开始在剪切前那一侧的来源（与解析器算时长结束的口径一致）。
  const rawStart = at ?? (current?.at === undefined ? undefined : videoEditSceneWriteBackTime(cuts, current.at))
  const values = { ...record.values }
  if (change.start !== undefined && change.end !== undefined) {
    const originalEnd = kind.end ? number(kind.end) : at === undefined ? undefined : at + (duration ?? 0)
    const span = videoEditSceneWriteBackSpan(cuts, change.start, change.end, at === undefined || originalEnd === undefined ? undefined : { start: at, end: originalEnd })
    values[kind.at] = span.start
    if (kind.end) values[kind.end] = span.end
    // 时长与 at 一样记在未剪时间轴上：跨剪切时未剪长度比剪后长度多出剪掉的那段。
    else values[kind.duration!] = span.end - span.start
  } else if (change.start !== undefined) {
    const nextStart = videoEditSceneWriteBackTime(cuts, change.start, { original: at, point: !spans })
    values[kind.at] = nextStart
    if (kind.duration) {
      if (rawStart === undefined || duration === undefined) return fail('这条记录现在没有剪后时刻，改开始时请同时给出结束。')
      values[kind.duration] = rawStart + duration - nextStart
    }
  } else {
    if (kind.end) values[kind.end] = videoEditSceneWriteBackTime(cuts, change.end!, { original: number(kind.end) })
    else {
      if (rawStart === undefined || duration === undefined) return fail('这条记录现在没有剪后时刻，改结束时请同时给出开始。')
      values[kind.duration!] = videoEditSceneWriteBackTime(cuts, change.end!, { original: rawStart + duration }) - rawStart
    }
  }
  const next: VideoEditSceneRecord = { ...record, values }
  const landed = resolveVideoEditScene({ ...working, records: working.records.map(item => item.id === record.id ? next : item) }, schema, { media }).byId.get(record.id)
  const differs = (want: number | undefined, got: number | undefined): boolean => want !== undefined && (got === undefined || Math.abs(got - want) > 1e-6)
  if (!landed) return fail('改到这个位置后，这条记录会落在剪切里被剪掉；换一个时刻。')
  if (differs(change.start, landed.at)) return fail(kind.role === 'shot' ? `开始落在剪切里的窗口内容会从剪切口开始放（剪后 ${landed.at} 秒），不能停在剪后 ${change.start} 秒；换一个时刻。` : `改到这里后剪后开始是 ${landed.at} 秒，不是要求的 ${change.start} 秒（落在剪切口一带）；换一个时刻。`)
  if (differs(change.end, landed.end)) return fail(`改到这里后剪后结束是 ${landed.end ?? '不封口'}，不是要求的 ${change.end} 秒（落在剪切口一带或早于开始）；换一个时刻。`)
  if (manual) {
    // 只记这次写到的那一侧：改开始记开始的字段（用时长表达结束的类型，时长跟着重算但它代表的结束没动），改结束记结束的字段。
    const written = change.start !== undefined && change.end !== undefined ? changedFields(record.values, values, kind) : change.start !== undefined ? [kind.at] : [kind.end ?? kind.duration!]
    setTuned(next, markTuned(record.tuned ?? [], written.filter(field => canonical(record.values[field]) !== canonical(values[field])), values))
  }
  return next
}

/**
 * 拖动中的预览：按手势开始时的片子数据 base 套用修改（与 writeVideoEditScene 同一份规则，手调按 base 比较），
 * 写进手势草稿，只用于实时看效果；松手时用 writeVideoEditScene 的 gesture 选项按声明重新校验并提交。
 * 被拒时抛 VideoEditSceneRejection，草稿不变。
 */
export function previewVideoEditSceneGesture(handle: VideoEditGesture, sceneId: string, base: VideoEditScene, changes: readonly VideoEditSceneChange[], context: VideoEditSceneWriteContext): VideoEditScene {
  const next = applyVideoEditSceneChanges(base, changes, context)
  updateVideoEditParameterGesture(handle, document => ({ ...document, scenes: (document.scenes ?? []).map(item => item.id === sceneId ? next : item) }))
  return next
}

/** 写入结果：提交后的片子数据，以及解析发现的会让画面缺内容的问题（写入照常进行，回执里告诉调用方）。 */
export interface VideoEditSceneWriteResult { readonly scene: VideoEditScene; readonly warnings: readonly VideoEditSceneIssue[] }
/**
 * 改记录与名称的入口：读引用它的代码声明，按顺序套用修改、从严校验，再以一次剪辑修改提交（同一撤销栈；带事务批时
 * 与同一事务的其他写入合成一次提交）。不提交代码、不升级素材。被拒时抛 VideoEditSceneRejection，剪辑不变。
 */
export async function writeVideoEditScene(projectId: string, sceneId: string, changes: readonly VideoEditSceneChange[], options: VideoEditSceneWriteOptions = {}): Promise<VideoEditSceneWriteResult> {
  const owner = requireVideoEditInstance(projectId); const contentVersion = owner.contentVersion
  const { gesture } = options
  if (gesture && (gesture.projectId !== projectId || options.batch)) throw new Error('拖动手势只能提交到它所属的剪辑，且不和事务批一起用。')
  // 拖动提交：按手势开始时的剪辑（预览之前）读声明、校验，结果写进草稿后整笔提交；任何一步失败都取消手势回到起点。
  const document = gesture ? videoEditCommittedDocument(owner) : owner.document
  const replace = (next: VideoEditScene) => (current: VideoEditDocument): VideoEditDocument => ({ ...current, scenes: (current.scenes ?? []).map(item => item.id === sceneId ? next : item) })
  let schema: CodeSceneSchema | undefined
  try {
    const scene = findVideoEditScene(document, sceneId)
    const state = changes.some(change => change.kind !== 'rename') ? await loadVideoEditSceneDeclarations(owner, document, sceneId) : undefined
    if (!isVideoEditContentCurrent(owner, contentVersion)) throw new Error('读取代码声明期间剪辑已有后续修改，请重读当前状态。')
    schema = state?.declaration?.schema
    const next = applyVideoEditSceneChanges(scene, changes, { schema, block: state?.block, media: videoEditSceneMedia(document), origin: options.origin })
    if (gesture) { updateVideoEditParameterGesture(gesture, replace(next)); finishVideoEditGesture(gesture) }
    else withVideoEditCommitBatch(options.batch, () => editVideoProject(projectId, replace(next)))
  } catch (error) {
    if (gesture) finishVideoEditGesture(gesture, false)
    throw error
  }
  logger.debug('片子数据已修改', { event: 'video_edit.scene.write.completed', context: { sceneId, changes: changes.map(change => change.kind) } })
  const committed = requireVideoEditInstance(projectId).document
  const result = findVideoEditScene(committed, sceneId)
  return { scene: result, warnings: userWarnings(result, schema, videoEditSceneMedia(committed)) }
}

export interface VideoEditSceneCreateInput {
  /** 省略时自动生成；代码参数用 {kind:'scene', sceneId} 引用它。 */
  readonly id?: string
  readonly name: string
  /** 按哪个代码版本里哪个 scene 参数的声明建立。 */
  readonly declarationSource: { readonly versionId: string; readonly parameterKey: string }
  readonly records?: readonly VideoEditSceneRecord[]
}
/** 剪辑里已用的标识 → 是什么：剪辑要求这些标识全文档唯一（与文档校验同一范围）。 */
function documentIdOwners(document: VideoEditDocument): Map<string, string> {
  const owners = new Map<string, string>()
  const add = (label: string, items: ReadonlyArray<{ id: string; name?: string }> | undefined): void => { for (const item of items ?? []) if (!owners.has(item.id)) owners.set(item.id, `${label}${item.name ? `“${item.name}”` : ''}`) }
  add('片子数据', document.scenes); add('风格', document.styles); add('模板', document.templates); add('LUT', document.colorLuts); add('素材', document.media); add('素材箱', document.bins); add('素材项', document.items)
  add('代码素材', document.codeMaterials); add('代码版本', document.codeMaterials?.flatMap(definition => definition.versions)); add('序列', document.sequences)
  for (const sequence of document.sequences) {
    add('轨道', sequence.tracks); add('片段', sequence.clips); add('批注', sequence.annotations); add('标记', sequence.markers); add('字幕', sequence.captions); add('转场', sequence.transitions)
    add('片段效果', sequence.clips.flatMap(clip => clip.effects ?? []))
  }
  return owners
}
/**
 * 新建片子数据（一次提交、一步撤销）：数据记下声明来源那个 scene 参数声明的 id 与版本，初始记录按它从严校验、
 * 原样保存（tuned 不自动记）。新建时还没有代码引用它，之后改记录要先把代码片段的 scene 参数指向它。
 */
export async function createVideoEditScenes(projectId: string, inputs: readonly VideoEditSceneCreateInput[], options: Pick<VideoEditSceneWriteOptions, 'batch'> = {}): Promise<{ scenes: VideoEditScene[]; warnings: VideoEditSceneIssue[] }> {
  const owner = requireVideoEditInstance(projectId); const contentVersion = owner.contentVersion; const document = owner.document
  const schemas: CodeSceneSchema[] = []
  for (const input of inputs) {
    const { versionId, parameterKey } = input.declarationSource
    const definition = document.codeMaterials?.find(item => item.versions.some(version => version.id === versionId))
    const fail = (message: string): never => { throw new VideoEditSceneRejection(input.name, [{ path: 'declaration_source', message }], '未新建') }
    if (!definition) fail(`代码版本 ${versionId} 不在这份剪辑里；用 video_edit.code_version 的 ID。`)
    await ensureVideoEditCodeParameterMetadata(owner, document, definition!.id, versionId)
    const parameters = readVideoEditCodeMetadata(owner, document)({ definitionId: definition!.id, versionId, parameters: {} }).parameters
    const declaration = parameters.find(parameter => parameter.key === parameterKey)
    if (declaration?.type !== 'scene') fail(`代码版本 ${versionId} 没有叫 ${parameterKey} 的片子数据参数；这个版本的片子数据参数：${parameters.filter(parameter => parameter.type === 'scene').map(parameter => parameter.key).join('、') || '没有'}。`)
    schemas.push((declaration as Extract<typeof declaration, { type: 'scene' }>).schema)
  }
  if (!isVideoEditContentCurrent(owner, contentVersion)) throw new Error('读取代码声明期间剪辑已有后续修改，请重读当前状态。')
  const media = videoEditSceneMedia(document), owners = documentIdOwners(document)
  const created = inputs.map((input, index) => {
    const id = input.id ?? crypto.randomUUID()
    const taken = owners.get(id)
    if (taken) throw new VideoEditSceneRejection(input.name, [{ path: 'scene_id', message: `ID ${id} 已被剪辑里的${taken}占用（剪辑里的标识要全文档唯一），换一个或省略自动生成。` }], '未新建')
    owners.set(id, `片子数据“${input.name}”`)
    const schema = schemas[index]
    const empty: VideoEditScene = { id, name: input.name, schema: { id: schema.id, version: schema.version }, records: [] }
    return applyVideoEditSceneChanges(empty, input.records ? [{ kind: 'replace_records', records: input.records }] : [], { schema, media, origin: 'generated' })
  })
  if ((document.scenes?.length ?? 0) + created.length > VIDEO_EDIT_SCENE_LIMITS.scenes) throw new VideoEditSceneRejection(inputs[0]?.name ?? '', [{ path: 'scenes', message: `一份剪辑最多 ${VIDEO_EDIT_SCENE_LIMITS.scenes} 份片子数据。` }], '未新建')
  withVideoEditCommitBatch(options.batch, () => editVideoProject(projectId, current => ({ ...current, scenes: [...current.scenes ?? [], ...created] })))
  logger.info('已新建片子数据', { event: 'video_edit.scene.create.completed', context: { sceneIds: created.map(scene => scene.id) } })
  const committed = requireVideoEditInstance(projectId).document
  const scenes = created.map(scene => findVideoEditScene(committed, scene.id))
  return { scenes, warnings: scenes.flatMap((scene, index) => userWarnings(scene, schemas[index], videoEditSceneMedia(committed))) }
}
/** 删除片子数据（一次提交、一步撤销）；还有代码参数引用的拒绝，并点名引用它的素材项、片段或效果。 */
export function removeVideoEditScenes(projectId: string, sceneIds: readonly string[], options: Pick<VideoEditSceneWriteOptions, 'batch'> = {}): void {
  const document = requireVideoEditInstance(projectId).document
  for (const sceneId of sceneIds) {
    const scene = findVideoEditScene(document, sceneId)
    const references = videoEditSceneCodeReferences(document, sceneId)
    if (references.length) throw new VideoEditSceneRejection(scene.name, references.map(({ key, holder }) => ({ path: `${holder.kind} ${projectId}:${holder.id}（${holder.name}）`, message: `代码参数 ${key} 引用它；先把这个参数改成 null 或指向别的片子数据` })), '还被代码参数引用，没有删除')
  }
  const gone = new Set(sceneIds)
  withVideoEditCommitBatch(options.batch, () => editVideoProject(projectId, current => {
    const scenes = (current.scenes ?? []).filter(scene => !gone.has(scene.id))
    const next: VideoEditDocument = { ...current, scenes }
    if (!scenes.length) delete next.scenes
    return next
  }))
  logger.info('已删除片子数据', { event: 'video_edit.scene.remove.completed', context: { sceneIds: [...gone] } })
}

/**
 * 重新生成类能力并回结果时必须用它：generated 是重新生成后这批记录的完整结果（同一 id 表示同一条），
 * current 是重新生成前这批记录（调用方只传自己负责生成的那部分）。
 * - 同一 id 的记录：手调路径上的取值用 current 的，手调标记保留。
 * - current 里手调过、这次没再生成的记录原样保留（用户改过的不丢），它的父记录链也一起保留：父记录这次没再生成时
 *   沿用 current 里的那条，不改挂到别处（改挂会换掉记录的语义，父记录类型也未必允许）。
 * - 没手调过的按 generated 去留。ref 字段引用的记录不自动保留，缺了写入时校验会点名。
 * 写回时用 origin:'generated'，这次写入本身不再记手调。
 */
export function mergeVideoEditSceneRegeneration(current: readonly VideoEditSceneRecord[], generated: readonly VideoEditSceneRecord[]): VideoEditSceneRecord[] {
  const byId = new Map(current.map(record => [record.id, record]))
  const merged = generated.map(record => {
    const previous = byId.get(record.id)
    if (!previous?.tuned?.length) return record
    let values = structuredClone(record.values)
    for (const path of previous.tuned) {
      const kept = valueAt(previous.values, path)
      if (!kept.found) continue
      // 生成结果里没有容纳这条子路径的结构时，整个字段沿用原值。
      if (!setValueAt(values, path, kept.value)) { const field = path.split('.')[0]; values = { ...values, [field]: structuredClone(previous.values[field]) } }
    }
    return { ...record, values, tuned: [...previous.tuned] }
  })
  const present = new Set(generated.map(record => record.id))
  const kept = current.filter(record => record.tuned?.length && !present.has(record.id))
  kept.forEach(record => present.add(record.id))
  const ancestors: VideoEditSceneRecord[] = []
  for (const record of kept) {
    for (let parent = byId.get(record.parent ?? ''); parent && !present.has(parent.id); parent = byId.get(parent.parent ?? '')) { ancestors.push(parent); present.add(parent.id) }
  }
  return [...merged, ...ancestors, ...kept]
}

function valueAt(values: Readonly<Record<string, unknown>>, path: string): { found: boolean; value?: unknown } {
  let current: unknown = values
  for (const segment of path.split('.')) {
    if (Array.isArray(current) ? !/^(?:0|[1-9]\d*)$/.test(segment) || Number(segment) >= current.length : !current || typeof current !== 'object' || !Object.hasOwn(current, segment)) return { found: false }
    current = (current as Record<string, unknown>)[segment]
  }
  return { found: true, value: current }
}
function setValueAt(values: Record<string, unknown>, path: string, value: unknown): boolean {
  const segments = path.split('.'), last = segments.pop()!
  let container: unknown = values
  for (const segment of segments) {
    if (!container || typeof container !== 'object' || !Object.hasOwn(container, segment)) return false
    container = (container as Record<string, unknown>)[segment]
  }
  if (!container || typeof container !== 'object' || Array.isArray(container) && (!/^(?:0|[1-9]\d*)$/.test(last) || Number(last) >= container.length)) return false
  ;(container as Record<string, unknown>)[last] = structuredClone(value)
  return true
}
