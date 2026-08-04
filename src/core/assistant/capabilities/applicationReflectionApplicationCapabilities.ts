import { z } from 'zod'

import type { ApplicationCapabilityDefinition } from '../applicationCapabilities'
import { capabilityOutputSchema, defineApplicationCapability } from './defineApplicationCapability'

/**
 * 反射层的通用能力。**这是"不用逐个适配"的落点。**
 *
 * 内部应用接口早就建好了实体/属性反射、观察查询和事务执行，但一直没有任何 Agent 能力把它
 * 暴露出去：助手只能调那些手写的专用能力，反射层只有适配器内部在用。后果是每一个「新建 X」
 * 「改 X 的 Y」都得单独写一遍能力，漏掉一个就彻底不可用——`camera_stage.keyframe` 实体、
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
  }).strict(),
  outputSchema: capabilityOutputSchema({
    entities: z.array(z.record(z.string(), z.unknown())),
    properties: z.array(z.record(z.string(), z.unknown())),
  }),
  resolveConcurrencyKey: () => 'application:describe',
  resolveTargetIds: () => ({}),
  summarize: (output) => `返回 ${output.entities.length} 个实体类型、${output.properties.length} 条属性。`,
})

const listEntities = defineApplicationCapability({
  id: 'list_application_entities', version: 1, title: '列出应用实体实例',
  description: '按实体类型列出当前存在的实例及其稳定引用，可按父实体过滤。',
  domain: 'application',
  aliases: ['列出实例', '有哪些对象', '列出关键帧', 'list entities'],
  readOnly: true, risk: 'R0', dataClasses: ['C1'], permission: 'application:read',
  idempotent: true, destructive: false, timeoutMs: 15_000, supportsPreview: false, supportsUndo: false,
  requiredScopes: [], acceptsRefs: [], producesRefs: [],
  inputSchema: z.object({
    entityType: z.string().min(1),
    cursor: z.string().min(1).optional(),
    limit: z.number().int().min(1).max(200).default(50),
  }).strict(),
  outputSchema: capabilityOutputSchema({
    refs: z.array(refSchema),
    nextCursor: z.string().nullable(),
    revisions: z.record(z.string(), z.number().int().nonnegative()),
  }),
  resolveConcurrencyKey: (input) => `application:list:${input.entityType}`,
  resolveTargetIds: () => ({}),
  summarize: (output) => `返回 ${output.refs.length} 个实例。`,
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
})

const changeEntities = defineApplicationCapability({
  id: 'change_application_entities', version: 1, title: '修改应用状态',
  description: '在一次事务里设置、清空或增删实体属性值，也可以在集合中新增或删除成员。用它做那些没有专用能力的常规改动。失败会整体回滚。',
  domain: 'application',
  aliases: ['改属性', '增删属性值', '加关键帧', '做动画', '上下漂浮', '新增成员', '删除成员', 'change entities', 'set property'],
  readOnly: false, risk: 'R1', dataClasses: ['C1'], permission: 'application:write',
  idempotent: false, destructive: false, timeoutMs: 30_000, supportsPreview: false, supportsUndo: true,
  requiredScopes: [], acceptsRefs: [], producesRefs: [],
  successEvidence: ['事务返回受影响引用、写入后的并发基线和结构化证据。'],
  failureRecovery: [
    'CONFLICT 表示状态在读取之后被改动过：重新读取实体拿到新的 revisions 后重试一次。',
    '属性不可写或集合不允许增删时不要重试，改用 describe_application_entities 确认可写范围。',
  ],
  inputSchema: z.object({
    summary: z.string().min(1).max(200),
    expectedRevisions: z.record(z.string(), z.number().int().nonnegative()).refine(
      (revisions) => Object.keys(revisions).length > 0,
      { message: '至少提供一个从 read_application_entity 获得的 revision' },
    ),
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
  }).strict(),
  outputSchema: capabilityOutputSchema({
    status: z.literal('completed'),
    transactionRef: z.string(),
    resultingRevisions: z.record(z.string(), z.number().int().nonnegative()),
    producedRefs: z.array(z.record(z.string(), z.unknown())),
    evidence: z.array(z.record(z.string(), z.unknown())),
  }),
  resolveConcurrencyKey: (input) => `application:change:${input.changes[0]?.entityType ?? 'unknown'}`,
  resolveTargetIds: () => ({}),
  summarize: (output) => `应用状态修改事务 ${output.transactionRef} 已完成。`,
})

export const APPLICATION_REFLECTION_APPLICATION_CAPABILITIES: ApplicationCapabilityDefinition[] = [
  describeEntities, listEntities, readEntity, changeEntities,
]
