import { z } from 'zod'

export const AGENT_UTILITY_PROTOCOL_VERSION = 'agent-utility/v1' as const

export const agentUtilityReadyMessageSchema = z.object({
  type: z.literal('utility.ready'),
  protocolVersion: z.literal(AGENT_UTILITY_PROTOCOL_VERSION),
  pid: z.number().int().positive(),
}).strict()

export const agentUtilityHeartbeatMessageSchema = z.object({
  type: z.literal('utility.heartbeat'),
  protocolVersion: z.literal(AGENT_UTILITY_PROTOCOL_VERSION),
  sentAt: z.number().int().positive(),
}).strict()

export const agentUtilityCommandMessageSchema = z.object({
  type: z.literal('command.request'),
  protocolVersion: z.literal(AGENT_UTILITY_PROTOCOL_VERSION),
  requestId: z.string().min(1),
  action: z.enum([
    'run.start',
    'run.pause',
    'run.resume',
    'run.cancel',
    'run.approval',
    'process.shutdown',
  ]),
  payload: z.unknown(),
}).strict()

export const agentUtilityCommandResultMessageSchema = z.object({
  type: z.literal('command.result'),
  protocolVersion: z.literal(AGENT_UTILITY_PROTOCOL_VERSION),
  requestId: z.string().min(1),
  ok: z.boolean(),
  data: z.unknown().optional(),
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1).max(2_000),
  }).strict().optional(),
}).strict()

export const agentUtilityRpcRequestMessageSchema = z.object({
  type: z.literal('rpc.request'),
  protocolVersion: z.literal(AGENT_UTILITY_PROTOCOL_VERSION),
  rpcId: z.string().min(1),
  operation: z.enum([
    'model.api_key',
    'tool.execute',
    'artifact.save',
    'memory.retrieve',
    'agent_trace.get_config',
    'agent_trace.start',
    'agent_trace.complete',
    'agent_trace.fail',
  ]),
  payload: z.unknown(),
}).strict()

export const agentUtilityRpcResultMessageSchema = z.object({
  type: z.literal('rpc.result'),
  protocolVersion: z.literal(AGENT_UTILITY_PROTOCOL_VERSION),
  rpcId: z.string().min(1),
  ok: z.boolean(),
  data: z.unknown().optional(),
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1).max(2_000),
  }).strict().optional(),
}).strict()

export const agentUtilityRpcCancelMessageSchema = z.object({
  type: z.literal('rpc.cancel'),
  protocolVersion: z.literal(AGENT_UTILITY_PROTOCOL_VERSION),
  rpcId: z.string().min(1),
  reason: z.string().min(1).max(500),
}).strict()

export const agentUtilityRunEventMessageSchema = z.object({
  type: z.literal('run.event'),
  protocolVersion: z.literal(AGENT_UTILITY_PROTOCOL_VERSION),
  runId: z.string().min(1),
  event: z.unknown(),
}).strict()

export const agentUtilityCheckpointMessageSchema = z.object({
  type: z.enum(['run.checkpoint', 'run.terminal']),
  protocolVersion: z.literal(AGENT_UTILITY_PROTOCOL_VERSION),
  runId: z.string().min(1),
  state: z.unknown(),
}).strict()

export const agentUtilityLogMessageSchema = z.object({
  type: z.literal('utility.log'),
  protocolVersion: z.literal(AGENT_UTILITY_PROTOCOL_VERSION),
  event: z.object({
    timestamp: z.string().datetime(),
    level: z.enum(['trace', 'debug', 'info', 'warn', 'error']),
    domain: z.string().min(1).max(100),
    event: z.string().min(1).max(100),
    message: z.string().max(2_000),
    requestId: z.string().max(200).optional(),
    taskId: z.string().max(200).optional(),
    modelId: z.string().max(300).optional(),
    providerId: z.string().max(200).optional(),
    context: z.unknown().optional(),
    error: z.unknown().optional(),
    source: z.literal('backend'),
  }).strict(),
}).strict()

export type AgentUtilityCommandAction = z.infer<
  typeof agentUtilityCommandMessageSchema
>['action']

export type AgentUtilityRpcOperation = z.infer<
  typeof agentUtilityRpcRequestMessageSchema
>['operation']
