import { z } from 'zod'

import type { ApplicationCapabilityDefinition } from '../applicationCapabilities'
import {
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
})

const previewCanvasBatch = defineApplicationCapability({
  id: 'preview_canvas_batch',
  version: 1,
  title: '预览画布批量操作',
  description: '读取画布批量计划的步骤、目标和可撤销性，不修改画布。',
  domain: 'canvas',
  aliases: ['查看画布批量计划', 'preview canvas batch'],
  readOnly: true,
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
  inputSchema: z.object({ planRef: z.string().min(1) }).strict(),
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
  resolveTargetIds: (input) => ({ planRef: input.planRef }),
  preview: (input) => ({
    title: '提交画布批量操作',
    summary: `提交画布批量计划 ${input.planRef}，成功后提供单次撤销。`,
    targetIds: { planRef: input.planRef },
    reversible: true,
    dataClasses: ['C1'],
  }),
  summarize: (output) => `画布批量计划已提交，${output.operationCount} 个步骤完成。`,
  createUndo: (output) => ({ kind: 'canvas_history', token: output.undoRef }),
})

export const CANVAS_BATCH_APPLICATION_CAPABILITIES: ApplicationCapabilityDefinition[] = [
  planCanvasBatch,
  previewCanvasBatch,
  commitCanvasBatch,
]
