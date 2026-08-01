import { z } from 'zod'

import {
  modelInputModalitySchema,
  modelStepMessageSchema,
  modelStepToolCallSchema,
  modelStepUsageSchema,
} from '../llm/modelStep'

export const AGENT_TRACE_SCHEMA_VERSION = 'agent-trace/v1' as const

export const agentTraceCaptureModeSchema = z.enum(['summary', 'detailed'])
export type AgentTraceCaptureMode = z.infer<typeof agentTraceCaptureModeSchema>

export const agentTraceStepKindSchema = z.enum(['router', 'primary', 'summarizer', 'fallback', 'observer', 'other'])
export type AgentTraceStepKind = z.infer<typeof agentTraceStepKindSchema>

export const agentTraceStatusSchema = z.enum(['running', 'completed', 'failed', 'cancelled', 'interrupted'])
export type AgentTraceStatus = z.infer<typeof agentTraceStatusSchema>

export const agentTraceLayerReportSchema = z.object({
  id: z.string().min(1).max(100),
  included: z.boolean(),
  estimatedTokens: z.number().int().nonnegative(),
  truncated: z.boolean(),
  reason: z.string().max(500),
}).strict()
export type AgentTraceLayerReport = z.infer<typeof agentTraceLayerReportSchema>

export const agentTraceContextMetadataSchema = z.object({
  kind: agentTraceStepKindSchema.optional(),
  turn: z.number().int().positive().optional(),
  snapshotRevision: z.number().int().nonnegative().optional(),
  contextWindowBudget: z.number().int().positive().optional(),
  maxOutputTokens: z.number().int().positive().optional(),
  estimatedTokens: z.number().int().nonnegative().optional(),
  compacted: z.boolean().optional(),
  beforeCompactionTokens: z.number().int().nonnegative().optional(),
  retainedLayers: z.array(z.string().min(1).max(100)).max(32).optional(),
  droppedLayers: z.array(z.string().min(1).max(100)).max(32).optional(),
  layerReports: z.array(agentTraceLayerReportSchema).max(32).optional(),
  activeToolNames: z.array(z.string().min(1).max(200)).max(64).optional(),
  inputModalities: z.array(modelInputModalitySchema).max(3).optional(),
}).strict()
export type AgentTraceContextMetadata = z.infer<typeof agentTraceContextMetadataSchema>

export const agentTraceHttpRequestSchema = z.object({
  method: z.string().min(1).max(20),
  url: z.string().min(1).max(4_000),
  headers: z.record(z.string(), z.string().max(2_000)),
  body: z.unknown().nullable(),
}).strict()
export type AgentTraceHttpRequest = z.infer<typeof agentTraceHttpRequestSchema>

export const agentTraceHttpResponseSchema = z.object({
  status: z.number().int().nonnegative().optional(),
  statusText: z.string().max(500).optional(),
  headers: z.record(z.string(), z.string().max(2_000)).optional(),
  errorBody: z.unknown().optional(),
}).strict()
export type AgentTraceHttpResponse = z.infer<typeof agentTraceHttpResponseSchema>

export const agentTraceStreamSummarySchema = z.object({
  firstChunkMs: z.number().int().nonnegative().nullable(),
  totalEventCount: z.number().int().nonnegative(),
  textDeltaCount: z.number().int().nonnegative(),
  reasoningDeltaCount: z.number().int().nonnegative(),
  toolCallCount: z.number().int().nonnegative(),
  textCharacters: z.number().int().nonnegative(),
  reasoningCharacters: z.number().int().nonnegative(),
}).strict()
export type AgentTraceStreamSummary = z.infer<typeof agentTraceStreamSummarySchema>

export const agentTraceResponseSchema = z.object({
  text: z.string(),
  reasoningText: z.string(),
  structuredOutput: z.unknown().nullable(),
  toolCalls: z.array(modelStepToolCallSchema),
  responseMessages: z.array(modelStepMessageSchema),
  finishReason: z.string().min(1).optional(),
  usage: modelStepUsageSchema,
  providerMetadataSummary: z.record(z.string(), z.array(z.string())),
  warnings: z.array(z.string()),
}).strict()
export type AgentTraceResponse = z.infer<typeof agentTraceResponseSchema>

export const agentTraceErrorSchema = z.object({
  name: z.string().max(200).optional(),
  message: z.string().max(4_000),
  code: z.string().max(200).optional(),
}).strict()
export type AgentTraceError = z.infer<typeof agentTraceErrorSchema>

export const agentTraceDetailSchema = z.object({
  schemaVersion: z.literal(AGENT_TRACE_SCHEMA_VERSION),
  logicalRequest: z.object({
    system: z.string().optional(),
    messages: z.array(modelStepMessageSchema),
    tools: z.unknown().optional(),
    output: z.unknown(),
    capabilities: z.unknown(),
    reasoning: z.unknown().optional(),
    settings: z.unknown().optional(),
    providerOptions: z.unknown().optional(),
    context: agentTraceContextMetadataSchema.optional(),
  }).strict(),
  httpRequest: agentTraceHttpRequestSchema.optional(),
  httpResponse: agentTraceHttpResponseSchema.optional(),
  response: agentTraceResponseSchema.optional(),
  stream: agentTraceStreamSummarySchema.optional(),
  error: agentTraceErrorSchema.optional(),
  capture: z.object({
    truncated: z.boolean(),
    originalBytes: z.number().int().nonnegative(),
    storedBytes: z.number().int().nonnegative(),
    sections: z.array(z.string().min(1).max(100)).max(32),
  }).strict(),
}).strict()
export type AgentTraceDetail = z.infer<typeof agentTraceDetailSchema>

export const agentTraceStepSummarySchema = z.object({
  traceId: z.string().min(1),
  runId: z.string().min(1),
  requestId: z.string().min(1),
  stepId: z.string().min(1),
  kind: agentTraceStepKindSchema,
  turn: z.number().int().positive().optional(),
  providerId: z.string().min(1),
  modelId: z.string().min(1),
  status: agentTraceStatusSchema,
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().optional(),
  elapsedMs: z.number().int().nonnegative().optional(),
  finishReason: z.string().max(200).optional(),
  usage: modelStepUsageSchema,
  hasDetail: z.boolean(),
  detailBytes: z.number().int().nonnegative(),
  originalDetailBytes: z.number().int().nonnegative(),
  detailTruncated: z.boolean(),
  errorMessage: z.string().max(4_000).optional(),
}).strict()
export type AgentTraceStepSummary = z.infer<typeof agentTraceStepSummarySchema>

export const agentTraceRunSummarySchema = z.object({
  runId: z.string().min(1),
  threadId: z.string().min(1).optional(),
  goal: z.string().max(32 * 1024).optional(),
  status: agentTraceStatusSchema,
  startedAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  requestCount: z.number().int().nonnegative(),
  completedCount: z.number().int().nonnegative(),
  failedCount: z.number().int().nonnegative(),
  totalElapsedMs: z.number().int().nonnegative(),
  usage: modelStepUsageSchema,
  steps: z.array(agentTraceStepSummarySchema),
}).strict()
export type AgentTraceRunSummary = z.infer<typeof agentTraceRunSummarySchema>

export const agentTraceQuerySchema = z.object({
  runId: z.string().max(200).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  keyword: z.string().max(500).optional(),
  providerId: z.string().max(200).optional(),
  modelId: z.string().max(300).optional(),
  status: agentTraceStatusSchema.optional(),
  beforeTimestamp: z.string().datetime().optional(),
  limit: z.number().int().min(1).max(200).default(50),
}).strict()
export type AgentTraceQuery = z.infer<typeof agentTraceQuerySchema>

export const agentTraceQueryResultSchema = z.object({
  runs: z.array(agentTraceRunSummarySchema),
  hasMore: z.boolean(),
  nextBeforeTimestamp: z.string().datetime().optional(),
}).strict()
export type AgentTraceQueryResult = z.infer<typeof agentTraceQueryResultSchema>

export const agentTraceDetailResultSchema = z.object({
  summary: agentTraceStepSummarySchema,
  detail: agentTraceDetailSchema.nullable(),
}).strict()
export type AgentTraceDetailResult = z.infer<typeof agentTraceDetailResultSchema>

export const agentTraceStartInputSchema = z.object({
  traceId: z.string().min(1),
  runId: z.string().min(1),
  requestId: z.string().min(1),
  stepId: z.string().min(1),
  kind: agentTraceStepKindSchema,
  turn: z.number().int().positive().optional(),
  providerId: z.string().min(1),
  modelId: z.string().min(1),
  startedAt: z.string().datetime(),
  captureMode: agentTraceCaptureModeSchema,
}).strict()
export type AgentTraceStartInput = z.infer<typeof agentTraceStartInputSchema>

export const agentTraceCompleteInputSchema = z.object({
  traceId: z.string().min(1),
  completedAt: z.string().datetime(),
  elapsedMs: z.number().int().nonnegative(),
  finishReason: z.string().max(200).optional(),
  usage: modelStepUsageSchema,
  detail: agentTraceDetailSchema.optional(),
}).strict()
export type AgentTraceCompleteInput = z.infer<typeof agentTraceCompleteInputSchema>

export const agentTraceFailInputSchema = z.object({
  traceId: z.string().min(1),
  completedAt: z.string().datetime(),
  elapsedMs: z.number().int().nonnegative(),
  status: z.enum(['failed', 'cancelled']),
  usage: modelStepUsageSchema,
  error: agentTraceErrorSchema,
  detail: agentTraceDetailSchema.optional(),
}).strict()
export type AgentTraceFailInput = z.infer<typeof agentTraceFailInputSchema>
