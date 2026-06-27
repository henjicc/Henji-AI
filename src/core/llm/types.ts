export interface LlmCapabilities {
  text: boolean
  image: boolean
  video: boolean
  audio: boolean
  streaming: boolean
  toolCall: boolean
  jsonOutput: boolean
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
  baseUrl?: string
  capabilities: LlmCapabilities
  enabled: boolean
}

export interface PromptOptimizationProfile {
  id: string
  name: string
  providerId: string
  modelId: string
  systemPrompt: string
  userTemplate: string
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
