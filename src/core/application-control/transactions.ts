import { z } from 'zod'

import {
  applicationEntityTypeIdSchema,
  applicationOpaqueRefSchema,
  applicationPropertyIdSchema,
  applicationRefSchema,
  applicationRevisionSetSchema,
  applicationScopeIdSchema,
  jsonValueSchema,
} from './identifiers'

export const applicationOperationImpactSchema = z.object({
  effect: z.enum(['observe', 'create', 'update', 'delete', 'navigate', 'execute']),
  entityTypes: z.array(applicationEntityTypeIdSchema).max(32),
  propertyIds: z.array(applicationPropertyIdSchema).max(128),
  revisionScopes: z.array(applicationScopeIdSchema).max(16),
  verificationRequired: z.boolean(),
}).strict()
export type ApplicationOperationImpact = z.infer<typeof applicationOperationImpactSchema>

export const applicationOperationExecutionSchema = z.object({
  mode: z.enum(['immediate', 'long_running', 'confirmation_required', 'user_interaction']),
  cancelable: z.boolean(),
  resultState: z.enum(['completed', 'submitted', 'observed']),
}).strict()
export type ApplicationOperationExecution = z.infer<typeof applicationOperationExecutionSchema>

export const applicationOperationStateSchema = z.enum([
  'planned',
  'running',
  'waiting_approval',
  'waiting_user',
  'waiting_external',
  'completed',
  'failed',
  'cancelled',
])
export type ApplicationOperationState = z.infer<typeof applicationOperationStateSchema>

export const applicationOperationProgressSchema = z.object({
  transactionRef: applicationOpaqueRefSchema.optional(),
  state: applicationOperationStateSchema,
  progress: z.number().min(0).max(1).optional(),
  message: z.string().min(1).max(1_000),
  cancelable: z.boolean(),
  updatedAt: z.string().datetime(),
}).strict()
export type ApplicationOperationProgress = z.infer<typeof applicationOperationProgressSchema>

export const applicationPropertyMutationSchema = z.object({
  propertyId: applicationPropertyIdSchema,
  operation: z.enum(['set', 'clear', 'append', 'remove']),
  value: jsonValueSchema.optional(),
}).strict().refine(
  (mutation) => mutation.operation === 'clear' || mutation.value !== undefined,
  { message: 'set/append/remove 修改必须提供值' }
)
export type ApplicationPropertyMutation = z.infer<typeof applicationPropertyMutationSchema>

export const applicationMutationPlanSchema = z.object({
  kind: z.literal('mutation'),
  target: applicationRefSchema,
  entityType: applicationEntityTypeIdSchema,
  expectedRevisions: applicationRevisionSetSchema,
  mutations: z.array(applicationPropertyMutationSchema).min(1).max(256),
}).strict()

export const applicationSemanticOperationPlanSchema = z.object({
  kind: z.literal('operation'),
  capabilityId: z.string().regex(/^[a-z][a-z0-9_]{1,63}$/),
  capabilityVersion: z.number().int().positive(),
  input: jsonValueSchema,
  expectedRevisions: applicationRevisionSetSchema,
}).strict()

/**
 * 集合写入：在父实体下**新建或删除子实体**。
 *
 * 这是反射层缺的第三个动词。此前只有"读任意属性"和"改任意已有实体的属性"是通用的，
 * 创建一律要手写专门能力——于是每一个「新建 X」都得单独适配一遍，漏掉一个就彻底不可用。
 * 实测后果：`camera_stage.keyframe` 实体、属性、provider 全都注册齐了，助手能读能改，
 * 却因为没有创建路径而做不了任何动画。
 *
 * 与 mutation 共用同一套事务语义：expectedRevisions 乐观并发、失败补偿、撤销、结构化验证。
 */
export const applicationCollectionPlanSchema = z.object({
  kind: z.literal('collection'),
  /** 子实体挂在哪个父实体下 */
  parent: applicationRefSchema,
  /** 要新建或删除的子实体类型 */
  entityType: applicationEntityTypeIdSchema,
  expectedRevisions: applicationRevisionSetSchema,
  operation: z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('create'),
      items: z.array(z.object({
        properties: z.record(applicationPropertyIdSchema, jsonValueSchema),
      }).strict()).min(1).max(256),
    }).strict(),
    z.object({
      kind: z.literal('remove'),
      targets: z.array(applicationRefSchema).min(1).max(256),
    }).strict(),
  ]),
}).strict()

export const applicationPlannedStepSchema = z.discriminatedUnion('kind', [
  applicationMutationPlanSchema,
  applicationSemanticOperationPlanSchema,
  applicationCollectionPlanSchema,
])
export type ApplicationPlannedStep = z.infer<typeof applicationPlannedStepSchema>

export const applicationVerificationConditionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('entity_exists'),
    target: applicationRefSchema,
  }).strict(),
  z.object({
    kind: z.literal('property_equals'),
    target: applicationRefSchema,
    propertyId: applicationPropertyIdSchema,
    expected: jsonValueSchema,
  }).strict(),
  z.object({
    kind: z.literal('evidence_fact'),
    fact: z.string().min(1).max(1_000),
  }).strict(),
  z.object({
    kind: z.literal('custom'),
    verifierId: z.string().regex(/^[a-z][a-z0-9_.-]{1,127}$/),
    input: jsonValueSchema,
  }).strict(),
])
export type ApplicationVerificationCondition = z.infer<typeof applicationVerificationConditionSchema>

export const applicationTransactionModeSchema = z.enum([
  'atomic',
  'compensatable',
  'non_reversible',
])
export type ApplicationTransactionMode = z.infer<typeof applicationTransactionModeSchema>

export const applicationChangePlanSchema = z.object({
  contractVersion: z.literal('application-control/v1'),
  planRef: applicationOpaqueRefSchema,
  summary: z.string().min(1).max(2_000),
  risk: z.enum(['R0', 'R1', 'R2', 'R3', 'R4']),
  requiresApproval: z.boolean(),
  atomic: z.boolean(),
  transactionMode: applicationTransactionModeSchema,
  steps: z.array(applicationPlannedStepSchema).min(1).max(256),
  verificationConditions: z.array(applicationVerificationConditionSchema).max(256),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
}).strict().refine(
  (plan) => plan.atomic === (plan.transactionMode === 'atomic'),
  { message: 'atomic 字段必须与 transactionMode 一致' }
)
export type ApplicationChangePlan = z.infer<typeof applicationChangePlanSchema>

export const applicationCommitRequestSchema = z.object({
  planRef: applicationOpaqueRefSchema,
  expectedRevisions: applicationRevisionSetSchema,
  idempotencyKey: z.string().min(16).max(256),
  approvedRisk: z.enum(['R0', 'R1', 'R2', 'R3']).optional(),
}).strict()
export type ApplicationCommitRequest = z.infer<typeof applicationCommitRequestSchema>

export const applicationEvidenceSchema = z.object({
  kind: z.enum(['entity_state', 'property_value', 'operation_result', 'task_state', 'observation']),
  target: applicationRefSchema.optional(),
  fact: z.string().min(1).max(1_000),
  data: jsonValueSchema.optional(),
  capturedAt: z.string().datetime(),
}).strict()
export type ApplicationEvidence = z.infer<typeof applicationEvidenceSchema>

export const applicationVerificationResultSchema = z.object({
  verified: z.boolean(),
  evidence: z.array(applicationEvidenceSchema).max(256),
  unmetConditions: z.array(z.string().min(1).max(1_000)).max(64),
  checkedAt: z.string().datetime(),
}).strict()
export type ApplicationVerificationResult = z.infer<typeof applicationVerificationResultSchema>

export const applicationTransactionResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('completed'),
    transactionRef: applicationOpaqueRefSchema,
    resultingRevisions: applicationRevisionSetSchema,
    producedRefs: z.array(applicationRefSchema).max(256),
    evidence: z.array(applicationEvidenceSchema).min(1).max(256),
    verification: applicationVerificationResultSchema,
    undoRef: applicationOpaqueRefSchema.optional(),
    completedAt: z.string().datetime(),
  }).strict(),
  z.object({
    status: z.literal('submitted'),
    transactionRef: applicationOpaqueRefSchema,
    taskRef: applicationRefSchema,
    resultingRevisions: applicationRevisionSetSchema,
    submittedAt: z.string().datetime(),
  }).strict(),
  z.object({
    status: z.literal('waiting_user'),
    transactionRef: applicationOpaqueRefSchema,
    reason: z.string().min(1).max(1_000),
    resumeRef: applicationOpaqueRefSchema,
  }).strict(),
  z.object({
    status: z.literal('failed'),
    transactionRef: applicationOpaqueRefSchema.optional(),
    code: z.enum(['INVALID_PLAN', 'CONFLICT', 'NOT_FOUND', 'NOT_AVAILABLE', 'PERMISSION_DENIED', 'CANCELLED', 'EXECUTION_FAILED', 'VERIFICATION_FAILED']),
    message: z.string().min(1).max(2_000),
    recoverable: z.boolean(),
    currentRevisions: applicationRevisionSetSchema.optional(),
    undoRef: applicationOpaqueRefSchema.optional(),
    partial: z.object({
      completedStepIndexes: z.array(z.number().int().nonnegative()).max(256),
      compensatedStepIndexes: z.array(z.number().int().nonnegative()).max(256),
      uncompensatedStepIndexes: z.array(z.number().int().nonnegative()).max(256),
    }).strict().optional(),
    verification: applicationVerificationResultSchema.optional(),
  }).strict(),
])
export type ApplicationTransactionResult = z.infer<typeof applicationTransactionResultSchema>

export const applicationUndoRequestSchema = z.object({
  undoRef: applicationOpaqueRefSchema,
  expectedRevisions: applicationRevisionSetSchema,
  idempotencyKey: z.string().min(16).max(256),
}).strict()
export type ApplicationUndoRequest = z.infer<typeof applicationUndoRequestSchema>
