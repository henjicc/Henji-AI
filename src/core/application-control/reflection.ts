import { z } from 'zod'

import {
  applicationDataClassSchema,
  applicationEntityTypeIdSchema,
  applicationExposureSchema,
  applicationPropertyIdSchema,
  applicationRefSchema,
  applicationRevisionSetSchema,
  applicationSchemaRefSchema,
  applicationScopeIdSchema,
  jsonValueSchema,
} from './identifiers'

export const applicationNumberRangeSchema = z.object({
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().positive().optional(),
}).strict().refine(
  (range) => range.min === undefined || range.max === undefined || range.min <= range.max,
  { message: '数值范围的最小值不能大于最大值' }
)

export const applicationPropertyValueSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('boolean') }).strict(),
  z.object({ kind: z.literal('string'), minLength: z.number().int().nonnegative().optional(), maxLength: z.number().int().positive().optional() }).strict(),
  z.object({ kind: z.literal('number'), hardRange: applicationNumberRangeSchema.optional(), softRange: applicationNumberRangeSchema.optional() }).strict(),
  z.object({ kind: z.literal('integer'), hardRange: applicationNumberRangeSchema.optional(), softRange: applicationNumberRangeSchema.optional() }).strict(),
  z.object({ kind: z.literal('enum'), values: z.array(z.object({ value: z.string().min(1), label: z.string().min(1).max(120) }).strict()).min(1).max(256) }).strict(),
  z.object({ kind: z.literal('color'), format: z.enum(['hex', 'rgba']) }).strict(),
  z.object({ kind: z.literal('vector2'), unit: z.string().min(1).max(40).optional(), componentRange: applicationNumberRangeSchema.optional() }).strict(),
  z.object({ kind: z.literal('vector3'), unit: z.string().min(1).max(40).optional(), componentRange: applicationNumberRangeSchema.optional() }).strict(),
  z.object({ kind: z.literal('ref'), refKinds: z.array(applicationEntityTypeIdSchema).min(1).max(32) }).strict(),
  z.object({ kind: z.literal('ref_list'), refKinds: z.array(applicationEntityTypeIdSchema).min(1).max(32), maxItems: z.number().int().positive().optional() }).strict(),
  z.object({ kind: z.literal('json'), schemaRef: applicationSchemaRefSchema }).strict(),
])
export type ApplicationPropertyValue = z.infer<typeof applicationPropertyValueSchema>

export const applicationEntityTypeDescriptorSchema = z.object({
  id: applicationEntityTypeIdSchema,
  domain: applicationEntityTypeIdSchema,
  version: z.number().int().positive(),
  title: z.string().min(1).max(120),
  description: z.string().min(1).max(1_000),
  refKind: applicationEntityTypeIdSchema,
  dataClass: applicationDataClassSchema,
  exposures: z.array(applicationExposureSchema).min(1).max(3),
  parentTypes: z.array(applicationEntityTypeIdSchema).max(16),
  revisionScopes: z.array(applicationScopeIdSchema).min(1).max(16),
  queryCapabilityIds: z.array(z.string().regex(/^[a-z][a-z0-9_]{1,63}$/)).min(1).max(16),
  schemaRef: applicationSchemaRefSchema,
  /**
   * 这个实体类型能否在父实体下被新建/删除，以及新建时至少要给哪些属性。
   *
   * 不声明就等于"只能改不能建"。声明之后，助手不需要任何专门能力就能创建实例——这正是
   * 关键帧那个洞的修法：实体和属性早就注册齐了，缺的只是这一句。
   */
  collectionWrite: z.object({
    creatable: z.boolean(),
    removable: z.boolean(),
    requiredPropertyIds: z.array(applicationPropertyIdSchema).max(32).default([]),
    /** 一次事务里最多创建多少个，防止模型一口气写爆场景 */
    maxItemsPerChange: z.number().int().positive().max(256).default(64),
  }).strict().optional(),
  /**
   * 这个实体类型**有意**不开放写入，以及由谁维护它的状态。
   *
   * 它存在的唯一理由是让门禁能区分「有意只读」和「忘了实现」。没有这个字段时，
   * `toolbox.tool` 缺执行器和某个领域漏了实现在机器看来完全一样，只能靠人记住——
   * 而这正是本项目已经吃过多次亏的模式。
   *
   * 理由必须说明该状态由哪个模块或链路维护，不接受「暂时不需要」这类无法验证的表述。
   */
  writeExclusion: z.object({
    reason: z.string().min(1).max(500),
  }).strict().optional(),
}).strict()
export type ApplicationEntityTypeDescriptor = z.infer<typeof applicationEntityTypeDescriptorSchema>

export const applicationPropertyDescriptorSchema = z.object({
  id: applicationPropertyIdSchema,
  entityType: applicationEntityTypeIdSchema,
  version: z.number().int().positive(),
  title: z.string().min(1).max(120),
  description: z.string().min(1).max(1_000),
  value: applicationPropertyValueSchema,
  unit: z.string().min(1).max(40).optional(),
  nullable: z.boolean(),
  defaultValue: jsonValueSchema.optional(),
  dataClass: applicationDataClassSchema,
  exposures: z.array(applicationExposureSchema).min(1).max(3),
  requiredPermissions: z.object({
    read: z.array(z.string().min(1).max(120)).max(12),
    write: z.array(z.string().min(1).max(120)).max(12),
  }).strict(),
  revisionScopes: z.array(applicationScopeIdSchema).min(1).max(16),
  schemaRef: applicationSchemaRefSchema,
  readOnlyReason: z.string().min(1).max(500).optional(),
  /** 会话控制会在提交后继续变化；这类属性以执行器证据验收，不做最终状态等值断言。 */
  verificationStrategy: z.enum(['state', 'execution']).optional(),
  relation: z.object({
    targetEntityTypes: z.array(applicationEntityTypeIdSchema).min(1).max(32),
    cardinality: z.enum(['one', 'optional', 'many']),
  }).strict().optional(),
}).strict()
export type ApplicationPropertyDescriptor = z.infer<typeof applicationPropertyDescriptorSchema>

export const applicationAvailabilityRecoverySchema = z.object({
  summary: z.string().min(1).max(500),
  capabilityIds: z.array(z.string().regex(/^[a-z][a-z0-9_]{1,63}$/)).max(12),
  entityTypes: z.array(applicationEntityTypeIdSchema).max(16),
  propertyIds: z.array(applicationPropertyIdSchema).max(32),
}).strict()
export type ApplicationAvailabilityRecovery = z.infer<typeof applicationAvailabilityRecoverySchema>

export const applicationAvailabilityBlockSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('structural') }).strict(),
  z.object({ kind: z.literal('permission') }).strict(),
  z.object({
    kind: z.literal('state'),
    requirementId: z.string().regex(/^[a-z][a-z0-9_.-]{1,127}$/),
    affectedEntityTypes: z.array(applicationEntityTypeIdSchema).max(32),
    revisionScopes: z.array(applicationScopeIdSchema).max(16),
  }).strict(),
])
export type ApplicationAvailabilityBlock = z.infer<typeof applicationAvailabilityBlockSchema>

export const applicationPropertyAvailabilitySchema = z.object({
  propertyId: applicationPropertyIdSchema,
  readable: z.boolean(),
  writable: z.boolean(),
  reasons: z.array(z.string().min(1).max(500)).max(12),
  blocks: z.array(applicationAvailabilityBlockSchema).max(12).optional(),
  recoveries: z.array(applicationAvailabilityRecoverySchema).max(8).optional(),
  requiredPermissions: z.array(z.string().min(1).max(120)).max(12),
  revisions: applicationRevisionSetSchema,
}).strict()
export type ApplicationPropertyAvailability = z.infer<typeof applicationPropertyAvailabilitySchema>

export const applicationCollectionOperationAvailabilitySchema = z.object({
  available: z.boolean(),
  reasons: z.array(z.string().min(1).max(500)).max(12),
  blocks: z.array(applicationAvailabilityBlockSchema).max(12).optional(),
  requiredPermissions: z.array(z.string().min(1).max(120)).max(12),
  recoveries: z.array(applicationAvailabilityRecoverySchema).max(8),
}).strict()
export type ApplicationCollectionOperationAvailability = z.infer<
  typeof applicationCollectionOperationAvailabilitySchema
>

/**
 * 某个父实体当前能否增删指定子实体。静态 collectionWrite 表示结构能力，这里表示此刻状态。
 */
export const applicationCollectionAvailabilitySchema = z.object({
  entityType: applicationEntityTypeIdSchema,
  parent: applicationRefSchema,
  create: applicationCollectionOperationAvailabilitySchema,
  remove: applicationCollectionOperationAvailabilitySchema,
  revisions: applicationRevisionSetSchema,
}).strict()
export type ApplicationCollectionAvailability = z.infer<typeof applicationCollectionAvailabilitySchema>

/** 普通领域没有额外状态限制时使用；静态 collectionWrite 仍由 Registry 负责裁决。 */
export function unrestrictedCollectionAvailability(
  entityType: string,
  parent: z.infer<typeof applicationRefSchema>,
  revisions: Record<string, number>,
  requiredPermissions: string[] = [],
): ApplicationCollectionAvailability {
  const operation = {
    available: true,
    reasons: [],
    blocks: [],
    requiredPermissions,
    recoveries: [],
  }
  return applicationCollectionAvailabilitySchema.parse({
    entityType,
    parent,
    create: operation,
    remove: operation,
    revisions,
  })
}

export const applicationEntitySnapshotSchema = z.object({
  ref: applicationRefSchema,
  entityType: applicationEntityTypeIdSchema,
  revisions: applicationRevisionSetSchema,
  properties: z.record(applicationPropertyIdSchema, jsonValueSchema),
  capturedAt: z.string().datetime(),
}).strict()
export type ApplicationEntitySnapshot = z.infer<typeof applicationEntitySnapshotSchema>

export const applicationSchemaQuerySchema = z.object({
  entityTypes: z.array(applicationEntityTypeIdSchema).max(64),
  propertyIds: z.array(applicationPropertyIdSchema).max(256),
  includeUnavailable: z.boolean().default(false),
  catalogVersion: z.string().regex(/^application-capabilities\/v[1-9][0-9]*$/),
}).strict()
export type ApplicationSchemaQuery = z.infer<typeof applicationSchemaQuerySchema>
