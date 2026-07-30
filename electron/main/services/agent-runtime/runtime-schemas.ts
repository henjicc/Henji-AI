import { z } from 'zod'

import { agentDataClassSchema } from '../../../../src/core/assistant/toolContracts'

export const artifactPayloadSchema = z.object({
  runId: z.string().min(1),
  artifact: z.object({
    artifactRef: z.string().min(1),
    source: z.string().min(1),
    dataClasses: z.array(agentDataClassSchema).max(4),
    createdAt: z.string().datetime(),
    originalBytes: z.number().int().nonnegative(),
    payload: z.unknown(),
  }).strict(),
}).strict()

export const toolExecutionPayloadSchema = z.object({
  runId: z.string().min(1),
  threadId: z.string().min(1),
  toolCallId: z.string().min(1),
  toolName: z.string().min(1),
  input: z.unknown(),
}).strict()
