import { z } from 'zod'
import { llmApiProtocolSchema } from '@henjicc/ai-sdk'
import { llmModelConfigSchema, llmProfileSchema } from '../llm/configSchema'
import { persistedPromptDocumentSchema } from './businessSchemas'

const reasoning = llmModelConfigSchema.shape.reasoning
const provider = z.looseObject({
  providerId: z.string(), providerFamilyId: z.string().optional(), endpointProfile: z.string().optional(), credentialId: z.string().optional(),
  displayName: z.string(), adapter: z.string(), apiProtocol: llmApiProtocolSchema.optional(), baseUrl: z.string().optional(),
  reasoning, reasoningConfigurable: z.boolean().optional(), enabled: z.boolean(),
  setup: z.discriminatedUnion('kind', [
    z.looseObject({ kind: z.literal('preset'), presetId: z.string(), lifecycle: z.enum(['builtin', 'user']),
      connectionOverrides: z.looseObject({ baseUrl: z.string().optional(), apiProtocol: llmApiProtocolSchema.optional() }).optional() }),
    z.looseObject({ kind: z.literal('custom'), apiKeyManagementUrl: z.string().optional() }),
  ]).optional(),
})
const promptProfile = z.looseObject({
  id: z.string(), name: z.string(), providerId: z.string(), modelId: z.string(), systemPrompt: z.string(),
  systemPromptDocument: persistedPromptDocumentSchema.optional(), userTemplate: z.string(), userTemplateDocument: persistedPromptDocumentSchema.optional(),
  capabilities: z.looseObject({ text: z.boolean(), image: z.boolean(), video: z.boolean() }),
  isDefault: z.boolean(), enabled: z.boolean(), createdAt: z.string(), updatedAt: z.string(),
})
/** Host-owned persisted shape; SDK model/provider extensions are preserved. */
export const llmStoredConfigSchema = z.looseObject({
  providers: z.array(provider.partial().required({ providerId: true })), models: z.array(llmModelConfigSchema.extend({
    capabilities: llmModelConfigSchema.shape.capabilities.loose().extend({ structuredOutputWithReasoning: z.boolean().nullable().optional() }),
  }).loose()), promptProfiles: z.array(promptProfile),
  selectedPromptProfileId: z.string().optional(),
  textProcessingPromptTemplates: z.array(z.looseObject({ id: z.string(), name: z.string(), systemPrompt: z.string(), createdAt: z.string(), updatedAt: z.string() })),
  agentProfiles: z.array(llmProfileSchema.loose()), selectedAgentProfileId: z.string().optional(),
  tools: z.array(z.looseObject({ name: z.string(), description: z.string().optional(), inputSchema: z.json().optional(), outputSchema: z.json().optional() })),
  policy: z.looseObject({ allowedTools: z.array(z.string()).optional(), requireHumanConfirmation: z.boolean().optional(), maxTokens: z.number().optional() }),
  memory: z.looseObject({ sessionId: z.string().optional(), conversationId: z.string().optional(), longTermNamespace: z.string().optional() }),
})
