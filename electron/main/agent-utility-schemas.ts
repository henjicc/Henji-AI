import { z } from 'zod'

import { hostContextSnapshotSchema } from '../../src/core/assistant/hostContracts'
import { agentMemoryContextEntrySchema } from '../../src/core/assistant/memory'
import {
  agentBudgetContinuationSchema,
  agentStartRunRequestSchema,
} from '../../src/core/assistant/runtimeContracts'
import { agentWorkingSummarySchema } from '../../src/core/assistant/workingContext'
import { modelStepMessageSchema } from '../../src/core/llm/modelStep'

export const agentUtilityStartPayloadSchema = z.object({
  runId: z.string().min(1),
  request: agentStartRunRequestSchema,
  hostContext: hostContextSnapshotSchema,
  memoryContext: z.array(agentMemoryContextEntrySchema).max(10).default([]),
  conversationHistory: z.array(modelStepMessageSchema).max(1_000).default([]),
  conversationHistorySequences: z.array(z.number().int().positive()).max(1_000).default([]),
  recoveryContext: agentWorkingSummarySchema.optional(),
  budgetContinuation: agentBudgetContinuationSchema.optional(),
}).strict()
