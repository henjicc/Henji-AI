import type { PromptDocumentV1 } from '@/core/inputs/promptDocument'
import type { ModelCapabilitySmokeResult } from './capabilitySmoke'
import type { LlmApiProtocol } from './providerProtocol'

export type { CapabilitySmokeCheck, CapabilitySmokeStatus } from './capabilitySmoke'

export interface LlmCapabilities {
  text: boolean
  image: boolean
  video: boolean
  audio: boolean
  streaming: boolean
  toolCall: boolean
  parallelTools: boolean
  jsonOutput: boolean
  structuredOutputMode: 'none' | 'json' | 'schema'
  reasoning: boolean
  sampling: boolean
  contextWindow: number | null
  maxOutputTokens: number | null
  usage: boolean
}

export type LlmReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export interface LlmReasoningConfig {
  enabled: boolean
  effort: LlmReasoningEffort
}

export interface LlmProviderConfig {
  providerId: string
  displayName: string
  adapter: string
  apiProtocol?: LlmApiProtocol
  baseUrl?: string
  reasoning?: LlmReasoningConfig
  reasoningConfigurable?: boolean
  enabled: boolean
}

export interface LlmModelConfig {
  providerId: string
  modelId: string
  displayName: string
  adapter: string
  apiProtocol?: LlmApiProtocol
  baseUrl?: string
  capabilities: LlmCapabilities
  pricing?: {
    currency: 'USD'
    inputPerMillionTokens: number
    outputPerMillionTokens: number
    cacheReadPerMillionTokens?: number
    cacheWritePerMillionTokens?: number
  }
  enabled: boolean
}

export type AgentModelRole = 'primary' | 'router' | 'summarizer' | 'fallback' | 'observer'

export interface AgentModelReference {
  providerId: string
  modelId: string
}

export type AgentModelCapabilityVerification = ModelCapabilitySmokeResult

export interface AgentModelProfile {
  id: string
  name: string
  primary: AgentModelReference
  router?: AgentModelReference
  summarizer?: AgentModelReference
  fallback?: AgentModelReference
  observer?: AgentModelReference
  settings: {
    timeoutMs: number
    maxRetries: number
    maxOutputTokens: number
    contextWindowBudget: number
    temperature?: number
  }
  verifications: AgentModelCapabilityVerification[]
  createdAt: string
  updatedAt: string
}

export interface PromptOptimizationProfile {
  id: string
  name: string
  providerId: string
  modelId: string
  systemPrompt: string
  systemPromptDocument?: PromptDocumentV1
  userTemplate: string
  userTemplateDocument?: PromptDocumentV1
  capabilities: Pick<LlmCapabilities, 'text' | 'image' | 'video'>
  isDefault: boolean
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export interface LlmToolSchema {
  name: string
  description?: string
  inputSchema?: DynamicValue
  outputSchema?: DynamicValue
}

export interface LlmPolicy {
  allowedTools: string[]
  requireHumanConfirmation: boolean
  maxTokens?: number
}

export interface LlmMemoryScope {
  sessionId?: string
  conversationId?: string
  longTermNamespace?: string
}

export interface LlmConfigState {
  providers: LlmProviderConfig[]
  models: LlmModelConfig[]
  promptProfiles: PromptOptimizationProfile[]
  selectedPromptProfileId?: string
  agentProfiles: AgentModelProfile[]
  selectedAgentProfileId?: string
  tools: LlmToolSchema[]
  policy: LlmPolicy
  memory: LlmMemoryScope
}

export interface LlmTrace {
  providerId: string
  modelId: string
  startedAtMs: number
  elapsedMs: number
  inputChars: number
  outputChars: number
}

export type LlmStreamEvent =
  | { type: 'Token'; data: string }
  | { type: 'ReasoningToken'; data: string }
  | { type: 'Done'; data: LlmTrace }
  | { type: 'Error'; data: string }

export interface LlmImageUrlPart {
  type: 'image_url'
  imageUrl: {
    url: string
  }
}

export interface LlmVideoUrlPart {
  type: 'video_url'
  videoUrl: {
    url: string
  }
}

export interface LlmInputAudioPart {
  type: 'input_audio'
  inputAudio: {
    data: string
    format: string
  }
}

export interface LlmTextPart {
  type: 'text'
  text: string
}

export type LlmMessageContentPart =
  | LlmTextPart
  | LlmImageUrlPart
  | LlmVideoUrlPart
  | LlmInputAudioPart

export interface LlmChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string | LlmMessageContentPart[] | null
  name?: string | null
}

export interface LlmChatRequest {
  requestId?: string
  providerId: string
  modelId: string
  adapter?: string
  baseUrl?: string
  reasoning?: LlmReasoningConfig
  messages: LlmChatMessage[]
  capabilities?: Partial<LlmCapabilities>
  tools?: LlmToolSchema[]
  policy?: Partial<LlmPolicy>
  memory?: LlmMemoryScope
  metadata?: DynamicValueMap
}
