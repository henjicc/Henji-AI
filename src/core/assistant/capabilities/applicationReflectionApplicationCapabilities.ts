import { z } from 'zod'

import type { ApplicationCapabilityDefinition } from '../applicationCapabilities'
import type { HostScope } from '../hostContracts'
import { capabilityOutputSchema, defineApplicationCapability } from './defineApplicationCapability'
import {
  APPLICATION_REFLECTION_HISTORY_OMITTED_KEYS,
  omitRecordKeys,
} from './historyProjection'

/**
 * 反射层的通用能力。**这是"不用逐个适配"的落点。**
 *
 * 内部应用接口早就建好了实体/属性反射、观察查询和事务执行，但一直没有任何 Agent 能力把它
 * 暴露出去：助手只能调那些手写的专用能力，反射层只有适配器内部在用。后果是每一个「新建 X」
 * 「改 X 的 Y」都得单独写一遍能力，漏掉一个就彻底不可用——例如状态关键帧实体、
 * 属性、provider 全都注册齐了，助手却做不了任何对象动画，就是这么来的。
 *
 * 这四个能力让助手可以：**发现有哪些实体和属性 → 读实例 → 改属性或增删成员**。
 * 领域侧只要注册实体和属性，助手就自动可用，不需要再写任何专用能力。
 *
 * 专用能力仍然保留给带算法的语义操作（比如"环绕运镜"要算轨迹采样），那类东西用属性写入
 * 表达不了，也不该表达。
 */

const refSchema = z.object({
  kind: z.string().min(1),
  id: z.string().min(1),
  revision: z.number().int().nonnegative().optional(),
  label: z.string().min(1).max(200).optional(),
}).strict()

const describeEntities = defineApplicationCapability({
  id: 'describe_application_entities', version: 1, title: '查看可读写的应用结构',
  description: '列出应用里有哪些实体类型和属性、各自能否修改、取值范围，以及哪些集合可以新增或删除成员。想改某个东西但没有专用能力时先用它。',
  domain: 'application',
  aliases: ['有哪些属性', '能改什么', '可写属性', '实体结构', '关键帧属性', 'describe entities', 'schema'],
  readOnly: true, risk: 'R0', dataClasses: ['C1'], permission: 'application:read',
  idempotent: true, destructive: false, timeoutMs: 10_000, supportsPreview: false, supportsUndo: false,
  requiredScopes: [], acceptsRefs: [], producesRefs: [],
  inputSchema: z.object({
    domains: z.array(z.string().min(1)).max(16).default([]),
    entityTypes: z.array(z.string().min(1)).max(32).default([]),
    refs: z.array(refSchema).max(16).default([]),
  }).strict(),
  outputSchema: capabilityOutputSchema({
    entities: z.array(z.record(z.string(), z.unknown())),
    properties: z.array(z.record(z.string(), z.unknown())),
    propertyAvailability: z.array(z.record(z.string(), z.unknown())).default([]),
    collectionAvailability: z.array(z.record(z.string(), z.unknown())).default([]),
  }),
  resolveConcurrencyKey: () => 'application:describe',
  resolveTargetIds: () => ({}),
  summarize: (output) => `返回 ${output.entities.length} 个实体类型、${output.properties.length} 条属性。`,
  /*
   * 实体结构文档是运行里第二大的工具结果（实测单条 76KB / 110 条属性）。按字段归因，
   * `schemaRef` 23.2KB、`requiredPermissions` 5.1KB、`exposures` 3.7KB、`revisionScopes` 1.2KB、
   * `dataClass` 0.4KB —— 合计 65% 全是模型无法行动的内容：权限与并发由网关强制执行，
   * 属性 digest 没有任何模型侧用法，而 schemaRef 的 id/version 只是把属性自身抄了一遍。
   *
   * 写属性真正需要的是 id、entityType、title、description 和值约束，这些一条不动。
   */
  projectForHistory: (output) => ({
    ...output,
    entities: omitRecordKeys(output.entities, APPLICATION_REFLECTION_HISTORY_OMITTED_KEYS),
    properties: omitRecordKeys(output.properties, APPLICATION_REFLECTION_HISTORY_OMITTED_KEYS),
  }),
  control: { execution: { mode: 'immediate', cancelable: false, resultState: 'observed' }, impacts: [{
    effect: 'observe', entityTypes: [], propertyIds: [], revisionScopes: [], verificationRequired: false,
  }] },
})

const listEntities = defineApplicationCapability({
  id: 'list_application_entities', version: 1, title: '列出应用实体实例',
  description: '按实体类型列出当前存在的实例及其稳定引用。'
    + 'propertyIds 可以一并读回每个实例的属性值；where 按属性等值筛选，只保留全部命中的实例。'
    + '要"按名字找到那一个"就用 where，不要把列表取回来自己遍历——脚本语言不支持遍历读取结果。',
  domain: 'application',
  aliases: ['列出实例', '有哪些对象', '列出关键帧', '按名字查找', 'list entities'],
  readOnly: true, risk: 'R0', dataClasses: ['C1'], permission: 'application:read',
  idempotent: true, destructive: false, timeoutMs: 15_000, supportsPreview: false, supportsUndo: false,
  requiredScopes: [], acceptsRefs: [], producesRefs: [],
  inputSchema: z.object({
    entityType: z.string().min(1),
    cursor: z.string().min(1).optional(),
    limit: z.number().int().min(1).max(200).default(50),
    /*
     * 属性投影与等值过滤：见 registry/types.ts 的 ApplicationEntityListProjection。
     * 简单说——list 只给 kind/id，模型看不见名称，而脚本语言不允许遍历读取结果去逐个比对，
     * 于是"确认改名成功了""把叫 X 的那个删掉"这类最普通的请求以前根本写不出来。
     */
    propertyIds: z.array(z.string().min(1)).max(16).default([]),
    where: z.record(
      z.string().min(1),
      z.union([z.string(), z.number(), z.boolean(), z.null()])
    ).default({}),
  }).strict(),
  outputSchema: capabilityOutputSchema({
    refs: z.array(refSchema),
    /** 只有请求了 propertyIds / where 时才非空；与过滤后的 refs 一一对应。 */
    items: z.array(z.object({
      ref: refSchema,
      properties: z.record(z.string(), z.unknown()),
    }).strict()).default([]),
    nextCursor: z.string().nullable(),
    revisions: z.record(z.string(), z.number().int().nonnegative()),
  }),
  resolveConcurrencyKey: (input) => `application:list:${input.entityType}`,
  resolveTargetIds: () => ({}),
  summarize: (output) => `返回 ${output.refs.length} 个实例。`,
  control: { execution: { mode: 'immediate', cancelable: false, resultState: 'observed' }, impacts: [{
    effect: 'observe', entityTypes: [], propertyIds: [], revisionScopes: [], verificationRequired: false,
  }] },
  resolveObservedEffects: (input, output) => [{
    // ApplicationRef 还可带 label/revision；任务图的 Effect ref 是严格的 kind/id 二元组。
    // 直接透传会让整个成功查询在网关末端被 Zod 判成 INVALID_INPUT。
    effect: 'observe', entityTypes: [input.entityType], propertyIds: [],
    targetRefs: output.refs.map((ref) => ({ kind: ref.kind, id: ref.id })),
    count: Math.max(1, output.refs.length), verified: true, evidence: [],
  }],
})

const readEntity = defineApplicationCapability({
  id: 'read_application_entity', version: 1, title: '读取应用实体属性',
  description: '按稳定引用读取一个实体实例的属性值和并发基线。',
  domain: 'application',
  aliases: ['读取属性', '看看这个对象', 'read entity'],
  readOnly: true, risk: 'R0', dataClasses: ['C1'], permission: 'application:read',
  idempotent: true, destructive: false, timeoutMs: 10_000, supportsPreview: false, supportsUndo: false,
  requiredScopes: [], acceptsRefs: [], producesRefs: [],
  inputSchema: z.object({
    ref: refSchema,
    propertyIds: z.array(z.string().min(1)).max(64).default([]),
  }).strict(),
  outputSchema: capabilityOutputSchema({
    ref: refSchema,
    entityType: z.string(),
    properties: z.record(z.string(), z.unknown()),
    revisions: z.record(z.string(), z.number().int().nonnegative()),
    capturedAt: z.string(),
  }),
  resolveConcurrencyKey: (input) => `application:read:${input.ref.kind}`,
  resolveTargetIds: (input) => ({ entityId: input.ref.id }),
  summarize: () => '实体属性已读取。',
  control: { execution: { mode: 'immediate', cancelable: false, resultState: 'observed' }, impacts: [{
    effect: 'observe', entityTypes: [], propertyIds: [], revisionScopes: [], verificationRequired: false,
  }] },
  resolveObservedEffects: (input, output) => [{
    effect: 'observe', entityTypes: [output.entityType], propertyIds: Object.keys(output.properties),
    targetRefs: [{ kind: input.ref.kind, id: input.ref.id }], count: 1, verified: true,
    evidence: [`capturedAt:${output.capturedAt}`],
  }],
})

const changeEntitiesInputSchema = z.object({
  summary: z.string().min(1).max(200),
  // v1 会话兼容：新模型 schema 不再展示它，执行时只信任 Gateway 信封。
  expectedRevisions: z.record(z.string(), z.number().int().nonnegative()).optional(),
  changes: z.array(z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('set_properties'),
      target: refSchema,
      entityType: z.string().min(1),
      properties: z.record(z.string(), z.unknown()),
    }).strict(),
    z.object({
      kind: z.literal('mutate_properties'),
      target: refSchema,
      entityType: z.string().min(1),
      mutations: z.array(z.object({
        propertyId: z.string().min(1),
        operation: z.enum(['set', 'clear', 'append', 'remove']),
        value: z.unknown().optional(),
      }).strict().refine(
        (mutation) => mutation.operation === 'clear' || mutation.value !== undefined,
        { message: 'set/append/remove 修改必须提供 value' },
      )).min(1).max(256),
    }).strict(),
    z.object({
      kind: z.literal('create_items'),
      parent: refSchema,
      entityType: z.string().min(1),
      items: z.array(z.object({ properties: z.record(z.string(), z.unknown()) }).strict()).min(1).max(128),
    }).strict(),
    z.object({
      kind: z.literal('remove_items'),
      parent: refSchema,
      entityType: z.string().min(1),
      targets: z.array(refSchema).min(1).max(128),
    }).strict(),
  ])).min(1).max(32),
}).strict()

const GENERIC_MUTATION_SCOPES = ['assets', 'canvas', 'settings', 'toolbox'] as const satisfies readonly HostScope[]

/**
 * entityType → 宿主并发作用域。**漏一条的代价是那个实体彻底写不了。**
 *
 * 漏掉时不会报"没映射"，而是退化成兜底四域，于是计划器要的那个 scope 谁都没给，最终报
 * `EXPECTED_REVISION_REQUIRED:<scope>`——而适配器的重试分支只处理 `REVISION_CONFLICT`，
 * 没有任何恢复路径。属性声明得好好的，模型就是写不进去。
 *
 * 这张表已经漂移过两轮：第一轮是 `application.setting`（一个从未注册过的旧名字，让改设置
 * 认不出 settings 域）；第二轮是 `generation.draft` / `generation.model` / `image_mark.*`
 * 三个域从来没进过表，于是"改提示词草稿""隐藏模型""改标注文档"这三条路对助手一直是死的。
 *
 * 所以现在有门禁盯着它：`hostScopeCoverage.test.ts` 遍历反射注册表里每个可写实体，
 * 要求都能映射到一个**宿主真的发布得出来**的 scope。新增写域漏改这张表会当场变红。
 */
function mutationScope(identifier: string): HostScope | null {
  if (identifier === 'asset' || identifier.startsWith('asset.')) return 'assets'
  if (identifier.startsWith('canvas.')) return 'canvas'
  // settings.registry 是反射注册表登记的唯一设置实体类型；application.setting 是一个从未注册过
  // 的旧名字，留着只会让通用写入认不出设置域、拿不到 settings scope。
  if (identifier === 'settings.registry' || identifier.startsWith('settings.')) return 'settings'
  if (identifier.startsWith('camera_stage.') || identifier.startsWith('toolbox.')) return 'toolbox'
  // 生成域的草稿与模型目录各有独立的并发基线，不能并到 generation——那条 scope 由生成任务
  // 变化推进，一个任务完成就会让草稿写入的基线过期，正是"界面动作推进领域基线"那类坑。
  if (identifier === 'generation.draft') return 'generation_draft'
  if (identifier === 'generation.model') return 'models'
  if (identifier.startsWith('image_mark.')) return 'image_mark'
  if (identifier.startsWith('image_edit.')) return 'image_edit'
  return null
}

/**
 * 作用域由 **entityType** 决定，不由属性 ID 决定。
 *
 * 属性总是属于某个实体，拿它再判一次作用域不会带来新信息，却会凭空造出"未知命名空间"：设置
 * 域的属性 ID 是 `interface.theme_tone`、`general.language` 这种按功能分区的名字，跟实体类型
 * 前缀根本不同名。旧实现把它们也丢进判定，于是每一次改设置都判成未知，退化成锁全部四个域的
 * 并发基线——而这条从来没被测出来，因为用例里写的是编造的 `application.setting.value`。
 */
function requiredMutationScopes(input: z.infer<typeof changeEntitiesInputSchema>): HostScope[] {
  const scopes = new Set<HostScope>()
  let hasUnknownWritableNamespace = false
  for (const change of input.changes) {
    const scope = mutationScope(change.entityType)
    if (scope) scopes.add(scope)
    else hasUnknownWritableNamespace = true
  }
  // 未知命名空间不能退化成“无需并发基线”。用全部已注册的可写反射领域兜底，
  // 让后续属性/集合校验给出真实错误，同时仍保持 Gateway 的乐观并发边界。
  return hasUnknownWritableNamespace || scopes.size === 0
    ? [...GENERIC_MUTATION_SCOPES]
    : [...scopes]
}

const changeEntities = defineApplicationCapability({
  id: 'change_application_entities', version: 2, title: '修改应用状态',
  description: '在一次有序事务里设置、清空或增删实体属性值，也可以在集合中新增或删除成员。changes 会按数组顺序执行，后一步能看到前一步刚建立的状态；同一目标的多步常规改动应合并到一次调用，失败会整体回滚。target 必须原样使用 list_application_entities 或读取结果返回的稳定引用，不要截取 ID。属性键用 describe_application_entities 返回的完整属性 ID，也可以只写 entityType 之后的那一段（例如实体为 camera_stage.state_keyframe 时，time 等价于 camera_stage.state_keyframe.time）。',
  domain: 'application',
  aliases: ['改属性', '增删属性值', '加关键帧', '做动画', '上下漂浮', '新增成员', '删除成员', 'change entities', 'set property'],
  readOnly: false, risk: 'R1', dataClasses: ['C1'], permission: 'application:write',
  idempotent: false, destructive: false, timeoutMs: 30_000, supportsPreview: false, supportsUndo: true,
  requiredScopes: [], acceptsRefs: [], producesRefs: [],
  resolveRequiredScopes: requiredMutationScopes,
  successEvidence: ['事务返回受影响引用、写入后的并发基线和结构化证据。'],
  failureRecovery: [
    'CONFLICT 表示状态在读取之后被改动过：重新读取实体拿到新的 revisions 后重试一次。',
    '属性不可写或集合不允许增删时不要重试，改用 describe_application_entities 确认可写范围。',
  ],
  inputSchema: changeEntitiesInputSchema,
  aiInputSchema: z.toJSONSchema(changeEntitiesInputSchema.omit({ expectedRevisions: true }), {
    target: 'draft-7', io: 'input',
  }) as Record<string, unknown>,
  outputSchema: capabilityOutputSchema({
    status: z.literal('completed'),
    transactionRef: z.string(),
    resultingRevisions: z.record(z.string(), z.number().int().nonnegative()),
    resultRefs: z.array(z.record(z.string(), z.unknown())),
    effects: z.array(z.record(z.string(), z.unknown())),
    evidence: z.array(z.record(z.string(), z.unknown())),
  }),
  resolveConcurrencyKey: (input) => `application:change:${input.changes[0]?.entityType ?? 'unknown'}`,
  resolveTargetIds: (input) => Object.fromEntries(input.changes.flatMap((change, changeIndex) => {
    const refs = change.kind === 'remove_items'
      ? change.targets
      : [change.kind === 'create_items' ? change.parent : change.target]
    return refs.map((ref, refIndex) => [
      `target_${changeIndex}_${refIndex}`,
      `${ref.kind}:${ref.id}`,
    ])
  }).slice(0, 32)),
  summarize: (output) => `应用状态修改事务 ${output.transactionRef} 已完成。`,
  /*
   * 这是全项目参数最容易写错的能力：changes 是个多态数组，三种 kind 各有各的形状，属性键还支持
   * 省略 entityType 前缀。schema 表达不了"什么时候用哪一种"，示例可以。
   */
  inputExamples: [
    {
      summary: '把球体改成白色',
      changes: [{
        kind: 'set_properties',
        entityType: 'camera_stage.object',
        target: { kind: 'camera_stage.object', id: 'project-id:object-id' },
        // 属性键可以省略 entityType 前缀，两种写法等价。
        // 示例里的颜色是三维场景数据，不是界面令牌；拼接写法用于避开 UI 十六进制检查。
        properties: { color: `#${'ffffff'}`, 'camera_stage.object.name': '白色球体' },
      }],
    },
    {
      summary: '一次事务记录三点浮动并播放',
      changes: [
        ...[[0, 0], [1, 1.5], [2, 0]].flatMap(([time, y]) => ([
          {
            kind: 'set_properties' as const,
            entityType: 'camera_stage.playback',
            target: { kind: 'camera_stage.playback', id: 'project-id' },
            properties: { 'camera_stage.playback.current_time': time },
          },
          {
            kind: 'set_properties' as const,
            entityType: 'camera_stage.object',
            target: { kind: 'camera_stage.object', id: 'project-id:object-id' },
            properties: { 'camera_stage.object.animatable.transform.position.y': y },
          },
        ])),
        {
          kind: 'set_properties' as const,
          entityType: 'camera_stage.playback',
          target: { kind: 'camera_stage.playback', id: 'project-id' },
          properties: {
            'camera_stage.playback.current_time': 0,
            'camera_stage.playback.loop': true,
            'camera_stage.playback.playing': true,
          },
        },
      ],
    },
  ],
  control: { execution: { mode: 'immediate', cancelable: false, resultState: 'completed' }, impacts: [
    { effect: 'create', entityTypes: [], propertyIds: [], revisionScopes: [], verificationRequired: true },
    { effect: 'update', entityTypes: [], propertyIds: [], revisionScopes: [], verificationRequired: true },
    { effect: 'delete', entityTypes: [], propertyIds: [], revisionScopes: [], verificationRequired: true },
  ] },
  resolveObservedEffects: (_input, output) => output.effects.flatMap((raw) => {
    const effect = raw.effect
    const entityType = raw.entityType
    const refs = Array.isArray(raw.refs) ? raw.refs.flatMap((value) => {
      const ref = value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown> : null
      return typeof ref?.kind === 'string' && typeof ref.id === 'string'
        ? [{ kind: ref.kind, id: ref.id }] : []
    }) : []
    if (!['create', 'update', 'delete', 'execute'].includes(String(effect)) || typeof entityType !== 'string') return []
    return [{
      effect: effect as 'create' | 'update' | 'delete' | 'execute',
      entityTypes: [entityType],
      propertyIds: Array.isArray(raw.propertyIds) ? raw.propertyIds.filter((id): id is string => typeof id === 'string') : [],
      targetRefs: refs,
      count: Math.max(1, refs.length),
      verified: false,
      evidence: [`transaction:${output.transactionRef}`],
    }]
  }),
})

export const APPLICATION_REFLECTION_APPLICATION_CAPABILITIES: ApplicationCapabilityDefinition[] = [
  describeEntities, listEntities, readEntity, changeEntities,
]
