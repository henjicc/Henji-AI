import { z } from 'zod'
import type { ApplicationEffectReceipt, ApplicationFieldDefinition, ApplicationRef, ApplicationSchemaDocument, JsonValue } from '@/core/application-control'
import type { ApplicationPropertyMutation } from '@/core/application-control/transactions'
import type { VideoEditDocument } from '@/core/videoEdit/document'
import type { CodeSceneMediaKind, CodeSceneValue } from '@/core/videoEdit/scene/sceneDeclaration'
import { VIDEO_EDIT_SCENE_LIMITS, videoEditSceneFieldPathSchema, videoEditSceneRecordSchema, videoEditSceneSchema, type VideoEditScene, type VideoEditSceneRecord } from '@/core/videoEdit/scene/sceneSchema'
import { videoEditSchemaRef } from './videoEditFields'
import { resolveVideoEditSceneView, videoEditSceneIssues, type VideoEditSceneChange, type VideoEditSceneDeclarationState } from './videoEditScenes'

/*
 * 片子数据的两个通用实体（每条属性只在这里声明一次，描述、读取、写入从同一条声明派生）：
 * - video_edit.scene：一份片子数据，引用 剪辑ID:片子数据ID。整份写 records 用于一次改很多条。
 * - video_edit.scene_record：其中一条记录，引用 剪辑ID:编码后的片子数据ID/编码后的记录ID。
 * 写入都交给领域服务（writeVideoEditScene，增删整份用 createVideoEditScenes / removeVideoEditScenes），校验、手调标记、撤销与事务批只有那一份。
 */
export const VIDEO_EDIT_SCENE = 'video_edit.scene'
export const VIDEO_EDIT_SCENE_RECORD = 'video_edit.scene_record'
export const VIDEO_EDIT_SCENE_TYPES = [VIDEO_EDIT_SCENE, VIDEO_EDIT_SCENE_RECORD] as const
export type VideoEditSceneEntityType = typeof VIDEO_EDIT_SCENE_TYPES[number]

export function videoEditSceneRef(projectId: string, scene: Pick<VideoEditScene, 'id' | 'name'>): ApplicationRef {
  return { kind: VIDEO_EDIT_SCENE, id: `${projectId}:${scene.id}`, label: scene.name }
}
export function videoEditSceneRecordRef(projectId: string, sceneId: string, record: Pick<VideoEditSceneRecord, 'id' | 'kind' | 'values'>): ApplicationRef {
  const name = ['name', 'text', 'title'].map(key => record.values[key]).find((value): value is string => typeof value === 'string' && value.length > 0)
  return { kind: VIDEO_EDIT_SCENE_RECORD, id: `${projectId}:${encodeURIComponent(sceneId)}/${encodeURIComponent(record.id)}`, label: name ? `${record.kind}：${name}` : `${record.kind} ${record.id}` }
}
export function parseVideoEditSceneRef(ref: ApplicationRef): { projectId: string; sceneId: string; recordId?: string } {
  const index = ref.id.indexOf(':')
  if (index < 0 || !VIDEO_EDIT_SCENE_TYPES.includes(ref.kind as VideoEditSceneEntityType)) throw new Error('请使用目录返回的完整片子数据引用。')
  const projectId = ref.id.slice(0, index), child = ref.id.slice(index + 1)
  if (ref.kind === VIDEO_EDIT_SCENE) return { projectId, sceneId: child }
  const slash = child.indexOf('/')
  if (slash < 0) throw new Error('片子数据记录引用须为 剪辑ID:片子数据ID/记录ID（目录返回的完整引用）。')
  return { projectId, sceneId: decodeURIComponent(child.slice(0, slash)), recordId: decodeURIComponent(child.slice(slash + 1)) }
}

/** 读取来源：片子数据本身、引用它的代码声明汇总与剪辑素材表；记录实体另带那条记录。 */
export interface VideoEditSceneFieldSource {
  readonly projectId: string
  readonly scene: VideoEditScene
  readonly state: VideoEditSceneDeclarationState
  readonly media: ReadonlyMap<string, CodeSceneMediaKind>
  readonly record?: VideoEditSceneRecord
}
/** 写入草稿：只记这次写到的属性，执行器据此生成 writeVideoEditScene 的修改。 */
export interface VideoEditSceneDraft {
  name?: string
  records?: VideoEditSceneRecord[]
  values?: Record<string, CodeSceneValue>
  parent?: string
  /** 显式写的整份手调路径。 */
  tuned?: string[]
  /** remove 掉的手调路径（没有整份写 tuned 时）。 */
  untune: string[]
  startCut?: number
  endCut?: number
}
type Field = ApplicationFieldDefinition<VideoEditSceneFieldSource, VideoEditSceneDraft>
const json = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value)) as JsonValue

const schemas = new Map<string, z.ZodType>()
interface FieldOptions { write?: (draft: VideoEditSceneDraft, value: unknown, mutation: ApplicationPropertyMutation) => void; operations?: ReadonlyArray<'set' | 'remove'>; readOnlyReason?: string; nullable?: boolean }
function field(entityType: VideoEditSceneEntityType, key: string, title: string, description: string, schema: z.ZodType, read: (source: VideoEditSceneFieldSource) => JsonValue, options: FieldOptions = {}): Field {
  const propertyId = `${entityType}.${key}`
  schemas.set(propertyId, schema)
  const write = options.write
  return {
    propertyId, storeActions: [], read,
    descriptor: { id: propertyId, entityType, version: 1, title, description, value: { kind: 'json', schemaRef: videoEditSchemaRef('property', `${propertyId}.value`) }, nullable: options.nullable ?? false, dataClass: 'C1', exposures: ['ui', 'assistant', 'local_adapter'], requiredPermissions: { read: ['video_edit:read'], write: write ? ['video_edit:write'] : [] }, revisionScopes: ['video_edit'], schemaRef: videoEditSchemaRef('property', propertyId), ...(write ? {} : { readOnlyReason: options.readOnlyReason ?? '由片子数据解析得出。' }) },
    ...(write ? { writer: { ...(options.operations ? { operations: options.operations } : {}), write: (draft: VideoEditSceneDraft, mutation: ApplicationPropertyMutation) => write(draft, mutation.operation === 'set' ? schema.parse(mutation.value) : mutation.value, mutation) } } : {}),
  }
}
function cutTime(draft: VideoEditSceneDraft, key: 'startCut' | 'endCut', value: unknown): void {
  if (typeof value !== 'number') throw new Error('写剪后时刻秒数（0–86400）。')
  draft[key] = value
}

export const VIDEO_EDIT_SCENE_DECLARATION_SOURCE = z.object({ versionId: z.string().min(1).max(100), parameterKey: z.string().min(1).max(64) }).strict()
/** 不能改记录（没有引用、引用的代码读不到或结构不一致）时的状态阻断：同一事务里前面改了代码参数的，等到执行这一步前再复核。 */
export const VIDEO_EDIT_SCENE_DECLARATION_BLOCK = { kind: 'state' as const, requirementId: 'video_edit.scene.declaration', affectedEntityTypes: ['video_edit.clip', 'video_edit.item', 'video_edit.effect'], revisionScopes: ['video_edit'] }
const issueSchema = z.array(z.object({ recordId: z.string().optional(), path: z.string(), message: z.string(), severity: z.literal('user').optional() }).strict())
const TIME_CONVENTION = '时刻是引用这份数据的代码片段的素材时间（秒，0 = 素材开头），未剪切；剪切本身也是记录（role 为 cut）。'
const cutSeconds = z.number().min(0).max(86_400).nullable()
export const VIDEO_EDIT_SCENE_FIELDS: Record<VideoEditSceneEntityType, Field[]> = {
  [VIDEO_EDIT_SCENE]: [
    field(VIDEO_EDIT_SCENE, 'scene_id', '片子数据 ID', '片子数据 ID（剪辑里的标识全文档唯一），代码参数写 {kind:"scene",sceneId:这个 ID} 引用它；新建时可指定，省略自动生成。', videoEditSceneSchema.shape.id, source => source.scene.id, { readOnlyReason: '片子数据 ID 新建后不变；要换 ID 请新建一份再删掉旧的。' }),
    field(VIDEO_EDIT_SCENE, 'declaration_source', '声明来源', '{versionId,parameterKey}：声明这份数据结构的代码版本（video_edit.code_version 的 ID）与其中 type 为 scene 的参数键。新建时必填，数据按这个声明建立并校验初始记录；读回是当前引用它、用来校验的那处代码，没有可读的引用时为 null。没有引用时只能改名：先把代码片段的这个参数写成 {kind:"scene",sceneId}，可以和改记录放进同一次事务，写在前面。',
      VIDEO_EDIT_SCENE_DECLARATION_SOURCE.nullable(), source => source.state.declaration ? { versionId: source.state.declaration.versionId, parameterKey: source.state.declaration.parameterKey } : null, { nullable: true, readOnlyReason: '由引用这份数据的代码参数决定；换声明要改代码片段的 scene 参数或新建代码版本。' }),
    field(VIDEO_EDIT_SCENE, 'name', '名称', '片子数据名称。', videoEditSceneSchema.shape.name, source => source.scene.name, { write: (draft, value) => { draft.name = value as string } }),
    field(VIDEO_EDIT_SCENE, 'records', '全部记录', `整份记录（数组，整体替换），每项 {id,kind,parent?,values,tuned?}。一次改很多条时用（不受一次事务 32 步的限制）：先读出，改好后整份写回；按代码声明从严校验，任一条不合法整份不写并点名记录与字段。整份写入时 tuned 按写入原样保存：改了自动结果的字段，请自己把字段名加进那条记录的 tuned（逐条改 video_edit.scene_record.values 会自动记）。${TIME_CONVENTION}`,
      z.array(videoEditSceneRecordSchema).max(VIDEO_EDIT_SCENE_LIMITS.records), source => json(source.scene.records), { write: (draft, value) => { draft.records = value as VideoEditSceneRecord[] } }),
    field(VIDEO_EDIT_SCENE, 'schema', '代码声明的结构', '引用这份片子数据的代码版本声明的结构（id、version、kinds：每类记录的 role、parent、at/end/duration 与 fields 字段类型、取值范围、默认值），只读；没有可读的引用时为 null。字段类型：time 素材时刻秒（anchor 为 footage 时也可写 {src: 所属录屏的秒数}）、duration 时长、sourceTime 所属素材里的源时间、media 剪辑素材 ID、ref 同一份数据里的记录 ID、desk/deskRect/deskPoint/deskPath 台面单位、windowRegion 与 region 画面比例 0–1 的 {x,y,width,height}、uiTrack {key} 跟随录屏里的界面元素；其余同代码参数。',
      z.json().nullable(), source => source.state.declaration ? json(source.state.declaration.schema) : null, { nullable: true, readOnlyReason: '结构由代码版本的 scene 参数声明；要换结构就按新结构新建一份片子数据、改代码片段引用，再删掉旧的。' }),
    field(VIDEO_EDIT_SCENE, 'issues', '问题', '不能改记录的原因与按代码声明校验、解析时发现的问题 [{recordId?,path,message,severity?}]，只读。severity 为 user 的会让画面缺内容、用户又难以察觉（例如窗口取帧超限后后半段空白），要告诉用户或修正数据；其余是需要整理的数据（例如组件没挂在段落下，段落剪掉了它还留着）。',
      issueSchema, source => json(videoEditSceneIssues(source.scene, source.state, source.media)), { readOnlyReason: '由片子数据与代码声明校验、解析得出；改记录后重新读取。' }),
  ],
  [VIDEO_EDIT_SCENE_RECORD]: [
    field(VIDEO_EDIT_SCENE_RECORD, 'record_id', '记录 ID', '记录 ID（同一份片子数据里唯一），ref 字段与 parent 用它引用别的记录；创建时可指定，省略自动生成。', videoEditSceneRecordSchema.shape.id, source => source.record!.id, { readOnlyReason: '记录 ID 创建后不变；要换 ID 请删掉重建，或整份写 video_edit.scene.records。' }),
    field(VIDEO_EDIT_SCENE_RECORD, 'kind', '记录类型', '记录类型，video_edit.scene.schema 里 kinds 的键；创建时必填。', videoEditSceneRecordSchema.shape.kind, source => source.record!.kind, { readOnlyReason: '记录类型创建后不变；要换类型请删掉重建。' }),
    field(VIDEO_EDIT_SCENE_RECORD, 'parent', '父记录', '父记录的 record_id，空字符串表示没有父记录。类型声明了 parent 的记录必须挂在那几类记录下；挂在段落（role 为 segment）下的记录随段落一起被剪掉。',
      z.union([z.literal(''), videoEditSceneRecordSchema.shape.id]), source => source.record!.parent ?? '', { write: (draft, value) => { draft.parent = value as string } }),
    field(VIDEO_EDIT_SCENE_RECORD, 'values', '字段取值', `字段取值 {字段名: 值}，整体替换：没写的字段按声明默认值，只改一项时先读出再整体写回。按 schema.kinds[kind].fields 从严校验：未声明的字段、越界值、引用不存在的记录或素材都会被拒并点名字段。${TIME_CONVENTION}与 start/end 不同；按剪后时刻改位置写 start_cut/end_cut。改到的字段自动记进 tuned。`,
      videoEditSceneRecordSchema.shape.values, source => json(source.record!.values), { write: (draft, value) => { draft.values = value as Record<string, CodeSceneValue> } }),
    field(VIDEO_EDIT_SCENE_RECORD, 'tuned', '手调过的字段', '手调过的字段路径：字段名，可接用点分隔的对象键或数组下标（target、target.x、points.2）。重新生成、重排时保留这些字段的值。改 values、start_cut、end_cut 会把改到的字段自动记入。set 整份写入，remove 去掉点名的一条；去掉就是“恢复自动”：当前取值不变，下次重新生成会覆盖它们。要单独一次修改：不能和同一条记录的 values、start_cut、end_cut 放在同一步或同一次事务里（它们会自动记手调，核对对不上），先提交那些修改、读回后再写 tuned。',
      z.array(videoEditSceneFieldPathSchema).max(VIDEO_EDIT_SCENE_LIMITS.tuned), source => [...(source.record!.tuned ?? [])], { operations: ['set', 'remove'], write: (draft, value, mutation) => { if (mutation.operation !== 'remove') { draft.tuned = [...value as string[]]; draft.untune = [] } else if (draft.tuned) draft.tuned = draft.tuned.filter(path => path !== value); else draft.untune.push(value as string) } }),
    field(VIDEO_EDIT_SCENE_RECORD, 'start', '剪后开始', '剪后开始时刻（秒）：引用片段的素材时间扣掉前面生效的剪切，由解析得出，只读；{src} 锚定已换算。没有位置或被剪掉时为 null。窗口内容取它在取帧时间表里的开头。改位置写 start_cut。', z.number().nullable(), source => time(source, 'at'), { nullable: true, readOnlyReason: '由片子数据解析得出；按剪后时刻改位置写 start_cut/end_cut。' }),
    field(VIDEO_EDIT_SCENE_RECORD, 'end', '剪后结束', '剪后结束时刻（秒），由解析得出，只读。时间点记录、被剪掉或放到片段结尾不封口时为 null；untilNext 的记录结束于同组下一条的开始。改结束写 end_cut。', z.number().nullable(), source => time(source, 'end'), { nullable: true, readOnlyReason: '由片子数据解析得出；按剪后时刻改结束写 end_cut。' }),
    field(VIDEO_EDIT_SCENE_RECORD, 'start_cut', '改开始（剪后时刻）', '按剪后时刻改这条记录的开始（秒，与 start 同一条时间轴，读回同 start）。写入经写回换算成 values 里的未剪时刻（跨剪切口时落在不会被剪掉的一侧，开始的 {src} 锚定换成秒数），开始的字段记进 tuned。只写开始就是改开头：结束原值不动（{src} 锚定也保留），用时长表达结束的类型会重算时长；整条挪动同时写 start_cut 与 end_cut。会被剪掉、或窗口内容会从剪切口才开始放的位置拒绝。要和同一条记录的 values、tuned 分成不同的修改（不放在同一次事务里）。',
      cutSeconds, source => time(source, 'at'), { nullable: true, write: (draft, value) => cutTime(draft, 'startCut', value) }),
    field(VIDEO_EDIT_SCENE_RECORD, 'end_cut', '改结束（剪后时刻）', '按剪后时刻改这条记录的结束（秒，读回同 end），只用于有起止（声明了 end 或 duration）的记录；规则同 start_cut，只写结束就是改结尾、开始原值不动，结束（或时长）的字段记进 tuned。', cutSeconds, source => time(source, 'end'), { nullable: true, write: (draft, value) => cutTime(draft, 'endCut', value) }),
    field(VIDEO_EDIT_SCENE_RECORD, 'dropped', '已被剪掉', '解析时这条记录是否被丢掉：整段落在剪切里、所在父记录或窗口被剪掉，或时刻无法换算（原因见 issues）。', z.boolean(), source => Boolean(source.state.declaration && !resolveVideoEditSceneView(source.scene, source.state.declaration.schema, source.media)!.byId.has(source.record!.id)), { readOnlyReason: '由片子数据解析得出。' }),
    field(VIDEO_EDIT_SCENE_RECORD, 'issues', '问题', '这条记录的问题，结构与含义同 video_edit.scene.issues。', issueSchema, source => json(videoEditSceneIssues(source.scene, source.state, source.media).filter(issue => issue.recordId === source.record!.id)), { readOnlyReason: '由片子数据与代码声明校验、解析得出；改记录后重新读取。' }),
  ],
}
function time(source: VideoEditSceneFieldSource, key: 'at' | 'end'): number | null {
  const value = resolveVideoEditSceneView(source.scene, source.state.declaration?.schema, source.media)?.byId.get(source.record!.id)?.[key]
  return value !== undefined && Number.isFinite(value) ? value : null
}

export function videoEditSceneSchemaDocuments(entityType: VideoEditSceneEntityType): ApplicationSchemaDocument[] {
  return VIDEO_EDIT_SCENE_FIELDS[entityType].map(item => {
    const schema = schemas.get(item.propertyId)!
    return { ref: videoEditSchemaRef('property', `${item.propertyId}.value`), value: z.toJSONSchema(schema, { io: 'input' }) as JsonValue, validator: schema }
  })
}

/** 写入表执行完后，把草稿换成领域服务的修改：只带这次写到的属性；按剪后时刻改位置排在其他修改之后。 */
export function videoEditSceneDraftChanges(entityType: VideoEditSceneEntityType, draft: VideoEditSceneDraft, recordId?: string): VideoEditSceneChange[] {
  if (entityType === VIDEO_EDIT_SCENE) return [...(draft.name !== undefined ? [{ kind: 'rename' as const, name: draft.name }] : []), ...(draft.records ? [{ kind: 'replace_records' as const, records: draft.records }] : [])]
  const timing = draft.startCut !== undefined || draft.endCut !== undefined
  if (timing && draft.values) throw new Error('同一次修改不能既写 values 又写 start_cut/end_cut（剪后时刻会改写 values 里的时刻，核对对不上）：改位置写 start_cut/end_cut，改别的字段写 values，分成两次修改，先提交一个再写另一个。')
  // values 与剪后时刻会把改到的字段自动并进 tuned；和显式的 tuned 分开写，tuned 才能按读回核对。
  // 事务按开始前的读数预算结果、只核对每个属性最后一次写入，所以同一事务里分两步也对不上，要另起一次修改。
  if ((draft.tuned || draft.untune.length) && (draft.values || timing)) throw new Error('tuned 要单独一次修改：values、start_cut、end_cut 会自动记手调，和 tuned 放在同一步或同一次事务里都核对不上；先提交取值或位置的修改，读回 tuned 后再另起一次修改写它。')
  const update = draft.values || draft.parent !== undefined || draft.tuned || draft.untune.length
  return [
    ...(update ? [{ kind: 'update' as const, recordId: recordId!, ...(draft.values ? { values: draft.values } : {}), ...(draft.parent !== undefined ? { parent: draft.parent || null } : {}), ...(draft.tuned ? { tuned: draft.tuned } : {}), ...(draft.untune.length ? { untune: draft.untune } : {}) }] : []),
    ...(timing ? [{ kind: 'retime' as const, recordId: recordId!, ...(draft.startCut !== undefined ? { start: draft.startCut } : {}), ...(draft.endCut !== undefined ? { end: draft.endCut } : {}) }] : []),
  ]
}

/** 新建片子数据时可写的属性（name、declaration_source 必填）。 */
export const VIDEO_EDIT_SCENE_CREATE_KEYS = ['scene_id', 'name', 'declaration_source', 'records'] as const
export const VIDEO_EDIT_SCENE_REQUIRED = [`${VIDEO_EDIT_SCENE}.name`, `${VIDEO_EDIT_SCENE}.declaration_source`]
/** 创建记录时可写的属性（kind、values 必填）。 */
export const VIDEO_EDIT_SCENE_RECORD_CREATE_KEYS = ['record_id', 'kind', 'parent', 'values', 'tuned'] as const
export const VIDEO_EDIT_SCENE_RECORD_REQUIRED = [`${VIDEO_EDIT_SCENE_RECORD}.kind`, `${VIDEO_EDIT_SCENE_RECORD}.values`]

/** 整份写 records 带出的记录增删改（直接写的那条记录不算级联）。 */
export const VIDEO_EDIT_SCENE_RECORD_CASCADES = (['create', 'update', 'delete'] as const).map(effect => ({ declarationId: `video_edit.scene_records_${effect}`, effect, entityType: VIDEO_EDIT_SCENE_RECORD, propertyIds: effect === 'update' ? ['kind', 'parent', 'values', 'tuned'].map(key => `${VIDEO_EDIT_SCENE_RECORD}.${key}`) : [], revisionScopes: ['video_edit'] }))
export function videoEditSceneRecordCascades(before: VideoEditDocument, after: VideoEditDocument, direct: readonly ApplicationRef[]): ApplicationEffectReceipt[] {
  const directIds = new Set(direct.map(ref => ref.id))
  const refs: Record<'create' | 'update' | 'delete', ApplicationRef[]> = { create: [], update: [], delete: [] }
  for (const sceneId of new Set([...(before.scenes ?? []), ...(after.scenes ?? [])].map(scene => scene.id))) {
    const old = new Map(before.scenes?.find(scene => scene.id === sceneId)?.records.map(record => [record.id, record]))
    const now = new Map(after.scenes?.find(scene => scene.id === sceneId)?.records.map(record => [record.id, record]))
    for (const [id, record] of now) {
      const previous = old.get(id)
      if (!previous) refs.create.push(videoEditSceneRecordRef(after.id, sceneId, record))
      else if (JSON.stringify(previous) !== JSON.stringify(record)) refs.update.push(videoEditSceneRecordRef(after.id, sceneId, record))
    }
    for (const [id, record] of old) if (!now.has(id)) refs.delete.push(videoEditSceneRecordRef(after.id, sceneId, record))
  }
  return VIDEO_EDIT_SCENE_RECORD_CASCADES.flatMap(declaration => {
    const list = refs[declaration.effect].filter(ref => !directIds.has(ref.id))
    return Array.from({ length: Math.ceil(list.length / 256) }, (_, chunk): ApplicationEffectReceipt => ({ effect: declaration.effect, entityType: declaration.entityType, propertyIds: declaration.propertyIds, refs: list.slice(chunk * 256, chunk * 256 + 256), origin: { kind: 'cascade', declarationId: declaration.declarationId } }))
  })
}
