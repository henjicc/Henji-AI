import { z } from 'zod'
import { llmApiProtocolSchema } from './providerProtocol'

export const modelCapabilitySmokeRequestSchema = z.object({
  requestId: z.string().min(1),
  providerId: z.string().min(1),
  modelId: z.string().min(1),
  adapter: z.string().optional(),
  apiProtocol: llmApiProtocolSchema.optional(),
  baseUrl: z.string().optional(),
  structuredOutputMode: z.enum(['json', 'schema']),
  reasoning: z.object({
    enabled: z.boolean(),
    effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']),
  }).optional(),
  declaredInputModalities: z.object({
    image: z.boolean(),
    video: z.boolean(),
    audio: z.boolean(),
  }).strict().optional(),
})

export type ModelCapabilitySmokeRequest = z.infer<typeof modelCapabilitySmokeRequestSchema>

export const capabilitySmokeCheckIdSchema = z.enum(['text', 'toolCall', 'structuredOutput', 'streaming', 'usage', 'cancel', 'image', 'video', 'audio'])
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
