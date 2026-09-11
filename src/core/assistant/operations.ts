import { z } from 'zod'
import { agentEffectTargetSchema, agentObservedEffectSchema } from './observedEffect'
import { agentToolObservationSchema } from './toolContracts'
import { applicationTransactionFailureFactsSchema } from './applicationTransactionFailureFacts'
import { henjiScriptCheckpointSchema } from './externalWait'
import { applicationPersistenceReceiptSchema } from '../application-control/persistenceCorrelation'
import { applicationExecutionPreparationSchema } from '../application-control/transactions'

const id = z.string().min(1).max(500)
const digest = z.string().regex(/^[a-f0-9]{64}$/)

/** 执行事实，不是任务图；业务数据仍由领域服务持有。 */
export const operationIntentSchema = z.object({
  runId: id, threadId: id, key: id, toolCallId: id, toolName: id,
  toolVersion: z.number().int().positive(), parentToolCallId: id.optional(),
  inputDigest: digest, authorizationDigest: digest,
  policyVersion: z.number().int().positive().optional(),
  readOnly: z.boolean(), container: z.boolean(),
  businessMutation: z.boolean().optional(),
  requiresMainClaim: z.boolean().optional(),
  recoveryOfOperationId: id.optional(),
  targets: z.array(agentEffectTargetSchema).max(256),
  verificationTargets: z.array(agentEffectTargetSchema).max(256).optional(),
  targetBindings: z.record(z.string(), z.string()),
  expectedRevisions: z.record(z.string(), z.number().int().nonnegative()),
}).strict()
export type OperationIntent = z.infer<typeof operationIntentSchema>

export const operationVerificationSchema = z.object({
  operationId: id, conditionId: id,
  targets: z.array(agentEffectTargetSchema).max(65_536),
  checkedTargets: z.array(agentEffectTargetSchema).max(65_536).optional(),
  status: z.enum(['pending', 'passed', 'failed', 'needs_check']),
  evidence: z.array(z.string().min(1).max(1000)).max(128),
  verifiedAt: z.string().datetime(),
  resolvesOperationId: id.optional(),
}).strict()
export type OperationVerification = z.infer<typeof operationVerificationSchema>

export const operationExternalCallSchema = z.object({
  key: id, source: z.enum(['generation', 'camera_stage_render']), inputDigest: digest,
  modelId: id.optional(), serverTaskId: id.optional(),
  target: agentEffectTargetSchema,
  state: z.enum(['dispatched', 'submitted', 'completed', 'unknown']),
  dispatchedAt: z.string().datetime(), updatedAt: z.string().datetime(),
  response: z.unknown().optional(), error: z.string().max(2000).optional(),
}).strict()
export type OperationExternalCall = z.infer<typeof operationExternalCallSchema>

export const operationRecordSchema = operationIntentSchema.extend({
  schemaVersion: z.literal('operation-record/v1'),
  operationId: id, logicalTaskId: id, attempt: z.number().int().positive(),
  state: z.enum(['prepared', 'dispatched', 'completed', 'not_executed', 'partial', 'unknown']),
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
  output: z.unknown().optional(), observation: agentToolObservationSchema.optional(),
  effects: z.array(agentObservedEffectSchema).max(512),
  error: z.string().max(2000).optional(),
  transaction: applicationTransactionFailureFactsSchema.optional(),
  checkpoint: henjiScriptCheckpointSchema.optional(),
  executionClaim: z.object({ attempt: z.number().int().positive(), runId: id, claimedAt: z.string().datetime() }).strict().optional(),
  attempts: z.array(z.object({ attempt: z.number().int().positive(), runId: id,
    authorizationDigest: digest, policyVersion: z.number().int().positive().optional(),
    dispatchedAt: z.string().datetime() }).strict()).default([]),
  persistenceReceipts: z.array(applicationPersistenceReceiptSchema).default([]),
  persistenceIntents: z.array(applicationPersistenceReceiptSchema.omit({ persistedAt: true }).extend({
    preparedAt: z.string().datetime(),
  }).strict()).default([]),
  verifications: z.array(operationVerificationSchema),
  externalCalls: z.array(operationExternalCallSchema).default([]),
  verificationPlans: z.array(applicationExecutionPreparationSchema).default([]),
}).strict()
export type OperationRecord = z.infer<typeof operationRecordSchema>

/** 模型与诊断读取的执行事实投影，排除原始输出、外部响应和授权摘要。 */
export const operationSnapshotSchema = operationRecordSchema.pick({
  operationId: true, runId: true, toolName: true, state: true, attempt: true,
  targets: true, effects: true, verifications: true, verificationPlans: true, error: true, updatedAt: true,
}).extend({
  persistedTargets: z.array(agentEffectTargetSchema),
  externalTasks: z.array(operationExternalCallSchema.pick({ source: true, target: true, state: true, updatedAt: true })),
}).strict()
export type OperationSnapshot = z.infer<typeof operationSnapshotSchema>

export function projectOperationSnapshots(records: readonly OperationRecord[]): OperationSnapshot[] {
  return records.filter((record) => !record.readOnly && !record.container && record.businessMutation !== false).map((record) => ({
    operationId: record.operationId, runId: record.runId, toolName: record.toolName, state: record.state,
    attempt: record.attempt, targets: record.targets, effects: record.effects, verifications: record.verifications,
    verificationPlans: record.verificationPlans, ...(record.error ? { error: record.error } : {}), updatedAt: record.updatedAt,
    persistedTargets: [...new Map(record.persistenceReceipts.flatMap((receipt) => receipt.targets)
      .map(({ kind, id }) => [`${kind}\0${id}`, { kind, id }])).values()],
    externalTasks: record.externalCalls.map(({ source, target, state, updatedAt }) => ({ source, target, state, updatedAt })),
  }))
}

/** 仅由主进程从正式记录构造，公共启动请求不接收用户提供的 IR。 */
export const operationRecoverySchema = z.object({
  sourceOperationId: id,
  checkpoint: henjiScriptCheckpointSchema,
}).strict()
export type OperationRecovery = z.infer<typeof operationRecoverySchema>

export const operationCommandSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('lookup'), runId: id, key: id }).strict(),
  z.object({ action: z.literal('prepare'), intent: operationIntentSchema }).strict(),
  z.object({ action: z.literal('dispatch'), runId: id, operationId: id,
    authorizationDigest: digest.optional(), policyVersion: z.number().int().positive().optional() }).strict(),
  z.object({ action: z.literal('complete'), runId: id, operationId: id, observation: agentToolObservationSchema }).strict(),
  z.object({ action: z.literal('fail'), runId: id, operationId: id,
    state: z.enum(['not_executed', 'partial', 'unknown']), error: z.string().max(2000),
    transaction: applicationTransactionFailureFactsSchema.optional(),
    effects: z.array(agentObservedEffectSchema).max(512) }).strict(),
  z.object({ action: z.literal('verify'), runId: id, verification: operationVerificationSchema }).strict(),
  z.object({ action: z.literal('checkpoint'), runId: id, operationId: id, checkpoint: henjiScriptCheckpointSchema }).strict(),
  z.object({ action: z.literal('list'), runId: id }).strict(),
])
export type OperationCommand = z.infer<typeof operationCommandSchema>
export interface OperationPersistence { execute(command: OperationCommand): Promise<OperationRecord | OperationRecord[] | null> }

export const operationTransportBindingSchema = z.object({
  operationId: id, callId: id, runId: id, toolCallId: id, idempotencyKey: id,
  webContentsId: z.number().int(), rendererSessionId: id,
}).strict()
export type OperationTransportBinding = z.infer<typeof operationTransportBindingSchema>
