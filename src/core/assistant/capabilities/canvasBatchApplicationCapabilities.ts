import { z } from 'zod'

import type { ApplicationCapabilityDefinition } from '../applicationCapabilities'
import type { AgentObservedEffect } from '../taskGraph'
import {
  capabilityControl,
  capabilityOutputSchema,
  defineApplicationCapability,
} from './defineApplicationCapability'
import { canvasNodePlacementSchema } from './canvasMutationApplicationCapabilities'

export const canvasBatchOperationSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('add_node'),
    nodeType: z.string().min(1),
    placement: canvasNodePlacementSchema,
    data: z.record(z.string(), z.unknown()).optional(),
  }).strict(),
  z.object({
    kind: z.literal('duplicate_node'),
    nodeId: z.string().min(1),
    placement: canvasNodePlacementSchema,
  }).strict(),
  z.object({
    kind: z.literal('update_node'),
    nodeId: z.string().min(1),
    data: z.record(z.string(), z.unknown()),
  }).strict(),
  z.object({
    kind: z.literal('delete_nodes'),
    nodeIds: z.array(z.string().min(1)).min(1).max(50),
  }).strict(),
  z.object({
    kind: z.literal('connect_nodes'),
    sourceNodeId: z.string().min(1),
    targetNodeId: z.string().min(1),
  }).strict(),
  z.object({
    kind: z.literal('disconnect_edge'),
    edgeId: z.string().min(1),
  }).strict(),
  z.object({
    kind: z.literal('group_nodes'),
    nodeIds: z.array(z.string().min(1)).min(2).max(50),
  }).strict(),
  z.object({
    kind: z.literal('select_node'),
    nodeId: z.string().min(1).nullable(),
  }).strict(),
])
export type CanvasBatchOperation = z.infer<typeof canvasBatchOperationSchema>

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function resolveCanvasBatchEffects(output: {
  projectId: string
  appliedOperations: Array<Record<string, unknown>>
  undoRef: string
}): AgentObservedEffect[] {
  const effects: AgentObservedEffect[] = []
  for (const [index, operation] of output.appliedOperations.entries()) {
    const record = asRecord(operation)
    if (!record || typeof record.kind !== 'string') continue
    const evidence = [`canvas_batch:${output.undoRef}:${index}`]
    const nodeRef = typeof record.nodeId === 'string'
      ? [{ kind: 'canvas.node', id: record.nodeId }]
      : typeof record.groupNodeId === 'string'
        ? [{ kind: 'canvas.node', id: record.groupNodeId }]
        : []
    if (record.kind === 'add_node' || record.kind === 'duplicate_node' || record.kind === 'group_nodes') {
      effects.push({
        effect: 'create' as const,
        entityTypes: ['canvas.node'], propertyIds: [], targetRefs: nodeRef,
        count: 1, verified: false, evidence,
      })
      continue
    }
    if (record.kind === 'update_node') {
      effects.push({
        effect: 'update' as const,
        entityTypes: ['canvas.node'],
        propertyIds: stringArray(record.updatedKeys).map((key) => `canvas.node.${key}`),
        targetRefs: nodeRef, count: 1, verified: false, evidence,
      })
      continue
    }
    if (record.kind === 'delete_nodes') {
      const nodeIds = stringArray(record.deletedNodeIds)
      effects.push({
        effect: 'delete' as const,
        entityTypes: ['canvas.node'], propertyIds: [],
        targetRefs: nodeIds.map((id) => ({ kind: 'canvas.node', id })),
        count: Math.max(1, nodeIds.length), verified: false, evidence,
      })
      continue
    }
    if (record.kind === 'connect_nodes' && typeof record.edgeId === 'string') {
      effects.push({
        effect: 'create' as const,
        entityTypes: ['canvas.edge'], propertyIds: [],
        targetRefs: [{ kind: 'canvas.edge', id: record.edgeId }],
        count: 1, verified: false, evidence,
      })
      continue
    }
    if (record.kind === 'disconnect_edge' && typeof record.edgeId === 'string') {
      effects.push({
        effect: 'delete' as const,
        entityTypes: ['canvas.edge'], propertyIds: [],
        targetRefs: [{ kind: 'canvas.edge', id: record.edgeId }],
        count: 1, verified: false, evidence,
      })
      continue
    }
    if (record.kind === 'select_node') {
      effects.push({
        effect: 'update' as const,
        entityTypes: ['canvas.project'], propertyIds: ['canvas.project.selected_node'],
        targetRefs: [{ kind: 'canvas.project', id: output.projectId }],
        count: 1, verified: false, evidence,
      })
    }
  }
  return effects
}

const planCanvasBatch = defineApplicationCapability({
  id: 'plan_canvas_batch',
  version: 1,
  title: '规划画布批量操作',
  description: '校验多个画布操作并生成稳定计划引用，不修改画布。',
  domain: 'canvas',
  aliases: ['批量修改画布', 'plan canvas batch'],
  readOnly: true,
  risk: 'R1',
  dataClasses: ['C1'],
  permission: 'canvas:plan',
  idempotent: false,
  destructive: false,
  timeoutMs: 8_000,
  supportsPreview: false,
  supportsUndo: false,
  requiredScopes: ['canvas'],
  acceptsRefs: ['canvas.project', 'canvas.node', 'canvas.edge'],
  producesRefs: ['canvas.batch_plan'],
  inputSchema: z.object({
    projectId: z.string().min(1),
    operations: z.array(canvasBatchOperationSchema).min(1).max(20),
  }).strict(),
  outputSchema: capabilityOutputSchema({
    planRef: z.string(),
    projectId: z.string(),
    operationCount: z.number(),
    operations: z.array(z.record(z.string(), z.unknown())),
    reversible: z.boolean(),
  }),
  concurrencyKey: 'canvas_plan',
  resolveConcurrencyKey: (input) => `canvas_plan:${input.projectId}`,
  resolveTargetIds: (input) => ({ projectId: input.projectId }),
  summarize: (output) => `已生成包含 ${output.operationCount} 个步骤的画布批量计划。`,
  control: { execution: { mode: 'immediate', cancelable: false, resultState: 'observed' }, impacts: [{
    effect: 'observe', entityTypes: ['canvas.project', 'canvas.node', 'canvas.edge'], propertyIds: [],
    revisionScopes: ['canvas'], verificationRequired: false,
  }] },
})

const previewCanvasBatch = defineApplicationCapability({
  id: 'preview_canvas_batch',
  version: 1,
  title: '预览画布批量操作',
  description: '读取画布批量计划的步骤、目标和可撤销性，不修改画布。',
  domain: 'canvas',
  aliases: ['查看画布批量计划', 'preview canvas batch'],
  readOnly: true,
  control: capabilityControl('observe', ['canvas.batch_plan']),
  risk: 'R0',
  dataClasses: ['C0'],
  permission: 'canvas:preview',
  idempotent: true,
  destructive: false,
  timeoutMs: 5_000,
  supportsPreview: false,
  supportsUndo: false,
  requiredScopes: ['canvas'],
  acceptsRefs: ['canvas.batch_plan'],
  producesRefs: ['canvas.batch_plan'],
  inputSchema: z.object({ planRef: z.string().min(1) }).strict(),
  outputSchema: capabilityOutputSchema({
    planRef: z.string(),
    projectId: z.string(),
    operations: z.array(z.record(z.string(), z.unknown())),
    summary: z.string(),
    reversible: z.boolean(),
  }),
  concurrencyKey: 'canvas_plan',
  resolveConcurrencyKey: (input) => `canvas_plan:${input.planRef}`,
  resolveTargetIds: (input) => ({ planRef: input.planRef }),
  summarize: (output) => output.summary,
})

const compiledApprovalContextSchema = z.object({
  actionGroupDigest: z.string().min(1).max(200),
  operationCount: z.number().int().min(1).max(20),
  targetIds: z.record(z.string().min(1).max(100), z.string().max(500))
    .refine((targets) => Object.keys(targets).length <= 32, '批次审批目标最多 32 项'),
  permissions: z.array(z.string().min(1).max(200)).min(1).max(20),
}).strict()

const commitCanvasBatchInputSchema = z.object({
  planRef: z.string().min(1),
  /** 仅由宿主编译器注入；模型可见 schema 不暴露此信封。 */
  compiledApprovalContext: compiledApprovalContextSchema.optional(),
}).strict()

const commitCanvasBatch = defineApplicationCapability({
  id: 'commit_canvas_batch',
  version: 1,
  title: '提交画布批量操作',
  description: '提交已预览的画布批量计划，成功后只生成一个撤销引用。',
  domain: 'canvas',
  aliases: ['执行画布批量计划', 'commit canvas batch'],
  readOnly: false,
  risk: 'R2',
  dataClasses: ['C1'],
  permission: 'canvas:batch_write',
  idempotent: false,
  destructive: true,
  timeoutMs: 30_000,
  supportsPreview: true,
  supportsUndo: true,
  requiredScopes: ['canvas'],
  acceptsRefs: ['canvas.batch_plan'],
  producesRefs: ['canvas.project', 'canvas.undo'],
  inputSchema: commitCanvasBatchInputSchema,
  aiInputSchema: {
    type: 'object',
    properties: { planRef: { type: 'string', minLength: 1 } },
    required: ['planRef'],
    additionalProperties: false,
  },
  outputSchema: capabilityOutputSchema({
    planRef: z.string(),
    projectId: z.string(),
    appliedOperations: z.array(z.record(z.string(), z.unknown())),
    operationCount: z.number(),
    undoRef: z.string(),
    status: z.literal('committed'),
  }),
  concurrencyKey: 'canvas_batch',
  resolveConcurrencyKey: (input) => `canvas_batch:${input.planRef}`,
  resolveTargetIds: (input) => ({
    planRef: input.planRef,
    ...(input.compiledApprovalContext?.targetIds ?? {}),
  }),
  preview: (input) => ({
    title: '提交画布批量操作',
    summary: input.compiledApprovalContext
      ? `提交 ${input.compiledApprovalContext.operationCount} 项画布操作；涉及权限 ${input.compiledApprovalContext.permissions.join('、')}，成功后提供单次撤销。`
      : `提交画布批量计划 ${input.planRef}，成功后提供单次撤销。`,
    targetIds: {
      planRef: input.planRef,
      ...(input.compiledApprovalContext?.targetIds ?? {}),
    },
    reversible: true,
    dataClasses: ['C1'],
  }),
  summarize: (output) => `画布批量计划已提交，${output.operationCount} 个步骤完成。`,
  createUndo: (output) => ({ kind: 'canvas_history', token: output.undoRef }),
  resolveObservedEffects: (_input, output) => resolveCanvasBatchEffects(output),
  control: { execution: { mode: 'confirmation_required', cancelable: false, resultState: 'completed' }, impacts: [
    { effect: 'create', entityTypes: ['canvas.node', 'canvas.edge'], propertyIds: [], revisionScopes: ['canvas'], verificationRequired: true },
    { effect: 'update', entityTypes: ['canvas.node', 'canvas.project'], propertyIds: [], revisionScopes: ['canvas'], verificationRequired: true },
    { effect: 'delete', entityTypes: ['canvas.node', 'canvas.edge'], propertyIds: [], revisionScopes: ['canvas'], verificationRequired: true },
  ] },
})

export const CANVAS_BATCH_APPLICATION_CAPABILITIES: ApplicationCapabilityDefinition[] = [
  planCanvasBatch,
  previewCanvasBatch,
  commitCanvasBatch,
]
