import { z } from 'zod'

export const modelCapabilitySmokeRequestSchema = z.object({
  requestId: z.string().min(1),
  providerId: z.string().min(1),
  modelId: z.string().min(1),
  adapter: z.string().optional(),
  baseUrl: z.string().optional(),
  reasoning: z.object({
    enabled: z.boolean(),
    effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']),
  }).optional(),
})

export type ModelCapabilitySmokeRequest = z.infer<typeof modelCapabilitySmokeRequestSchema>

export const capabilitySmokeCheckIdSchema = z.enum(['text', 'toolCall', 'structuredOutput', 'streaming', 'usage', 'cancel'])
export type CapabilitySmokeCheckId = z.infer<typeof capabilitySmokeCheckIdSchema>
export type CapabilitySmokeStatus = 'passed' | 'failed' | 'skipped'

export interface CapabilitySmokeCheck {
  id: CapabilitySmokeCheckId
  status: CapabilitySmokeStatus
  latencyMs: number
  errorCode?: string
}

export interface ModelCapabilitySmokeResult {
  providerId: string
  modelId: string
  adapterVersion: string
  verifiedAt: string
  checks: CapabilitySmokeCheck[]
  totalLatencyMs: number
  usage: {
    inputTokens: number | null
    outputTokens: number | null
    reasoningTokens: number | null
    cacheReadTokens: number | null
    cacheWriteTokens: number | null
    totalTokens: number | null
  }
  cost: { status: 'unknown' } | { status: 'known'; amount: number; currency: string }
}
