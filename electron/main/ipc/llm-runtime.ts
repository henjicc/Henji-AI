import {
  discoverModels,
  modelStepInputSchema,
  parseLlmReasoningConfig,
  type DiscoveredModelItem,
  type JsonObject,
  type JsonValue,
  type LlmChatRequestDto,
  type LlmStreamEventDto,
  type ModelStepEvent,
  type ModelStepInput,
  type ModelStepResult,
} from '@henjicc/ai-sdk'
import {
  modelCapabilitySmokeRequestSchema,
  type ModelCapabilitySmokeRequest,
  type ModelCapabilitySmokeResult,
} from '../../../src/core/llm/capabilitySmoke'
import { sdkRuntimeContext } from '../services/ai-runtime/sdk-runtime'
import { cancelLlmRuntimeTask, llmChatStream, llmModelStep } from '../services/llm/runtime'
import { verifyModelCapabilities } from '../services/llm/sdk/capability-smoke'
import { parseRecord, parseStringField, registerIpcHandler } from './registry'

interface ChatStreamPayload {
  streamId: string
  request: LlmChatRequestDto
}

interface ChatStreamEventPayload {
  streamId: string
  event: LlmStreamEventDto
}

interface ModelStepPayload {
  streamId: string
  input: ModelStepInput
}

interface ModelStepEventPayload {
  streamId: string
  event: ModelStepEvent
}

export function registerLlmRuntimeIpc(): void {
  registerIpcHandler<ChatStreamPayload, void>('llm:chatStream', parseChatStreamPayload, async (payload, event) => {
    await llmChatStream(payload.request, (streamEvent) => {
      const eventPayload: ChatStreamEventPayload = {
        streamId: payload.streamId,
        event: streamEvent,
      }
      event.sender.send('llm:chatStream:event', eventPayload)
    })
  })

  registerIpcHandler<ModelStepPayload, ModelStepResult>('llm:modelStep', parseModelStepPayload, async (payload, event) => {
    return await llmModelStep(payload.input, (stepEvent) => {
      const eventPayload: ModelStepEventPayload = { streamId: payload.streamId, event: stepEvent }
      event.sender.send('llm:modelStep:event', eventPayload)
    })
  })

  registerIpcHandler<ModelCapabilitySmokeRequest, ModelCapabilitySmokeResult>(
    'llm:verifyModelCapabilities',
    input => modelCapabilitySmokeRequestSchema.parse(input),
    verifyModelCapabilities
  )

  registerIpcHandler<string, void>('llm:cancelTask', (input) => parseStringField(input, 'taskId'), (taskId) => {
    cancelLlmRuntimeTask(taskId)
  })

  registerIpcHandler<{
    providerId: string
    providerFamilyId?: string
    endpointProfile?: string
    credentialId?: string
    baseUrl: string
  }, DiscoveredModelItem[]>(
    'llm:discoverModels',
    (input) => {
      const record = parseRecord(input)
      return {
        providerId: readString(record, 'providerId'),
        providerFamilyId: readOptionalString(record, 'providerFamilyId'),
        endpointProfile: readOptionalString(record, 'endpointProfile'),
        credentialId: readOptionalString(record, 'credentialId'),
        baseUrl: readString(record, 'baseUrl'),
      }
    },
    ({ providerId, providerFamilyId, endpointProfile, credentialId, baseUrl }) => discoverModels(
      providerId,
      baseUrl,
      sdkRuntimeContext,
      { providerFamilyId, endpointProfile, credentialId }
    )
  )
}

function parseModelStepPayload(input: unknown): ModelStepPayload {
  const record = parseRecord(input)
  return {
    streamId: readString(record, 'streamId'),
    input: modelStepInputSchema.parse(record.input),
  }
}

function parseChatStreamPayload(input: unknown): ChatStreamPayload {
  const record = parseRecord(input)
  const streamId = readString(record, 'streamId')
  const request = parseLlmChatRequest(record.request)
  return { streamId, request }
}

function parseLlmChatRequest(input: unknown): LlmChatRequestDto {
  const record = parseRecord(input)
  return {
    requestId: readOptionalString(record, 'requestId'),
    providerId: readString(record, 'providerId'),
    providerFamilyId: readOptionalString(record, 'providerFamilyId'),
    endpointProfile: readOptionalString(record, 'endpointProfile'),
    credentialId: readOptionalString(record, 'credentialId'),
    modelId: readString(record, 'modelId'),
    adapter: readOptionalString(record, 'adapter'),
    baseUrl: readOptionalString(record, 'baseUrl'),
    reasoning: parseLlmReasoningConfig(record.reasoning),
    messages: readMessages(record.messages),
    capabilities: readOptionalJsonObject(record, 'capabilities'),
    tools: readOptionalJsonValue(record, 'tools'),
    policy: readOptionalJsonObject(record, 'policy'),
    memory: readOptionalJsonObject(record, 'memory'),
    metadata: readOptionalJsonObject(record, 'metadata'),
  }
}

function readMessages(value: unknown): LlmChatRequestDto['messages'] {
  if (!Array.isArray(value)) {
    throw new Error('Expected messages array')
  }
  return value.map((message) => {
    const record = parseRecord(message)
    const role = record.role
    if (role !== 'system' && role !== 'user' && role !== 'assistant') {
      throw new Error('Expected message role to be system, user, or assistant')
    }
    const content = record.content
    if (content !== undefined && content !== null && typeof content !== 'string' && !Array.isArray(content)) {
      throw new Error('Expected message content to be string, array, null, or undefined')
    }
    return {
      role,
      content: content as LlmChatRequestDto['messages'][number]['content'],
      name: readOptionalString(record, 'name'),
    }
  })
}

function readOptionalJsonObject(record: Record<string, unknown>, field: string): JsonObject | undefined {
  const value = record[field]
  if (value === undefined) return undefined
  if (!isJsonObject(value)) {
    throw new Error(`Expected object field "${field}"`)
  }
  return value
}

function readOptionalJsonValue(record: Record<string, unknown>, field: string): JsonValue | undefined {
  const value = record[field]
  if (value === undefined) return undefined
  if (!isJsonValue(value)) {
    throw new Error(`Expected JSON value field "${field}"`)
  }
  return value
}

function readString(record: Record<string, unknown>, field: string): string {
  const value = record[field]
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Expected non-empty string field "${field}"`)
  }
  return value
}

function readOptionalString(record: Record<string, unknown>, field: string): string | undefined {
  const value = record[field]
  if (value === undefined) return undefined
  if (typeof value !== 'string') {
    throw new Error(`Expected string field "${field}"`)
  }
  return value
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && isJsonValue(value)
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) return true
  const primitive = typeof value
  if (primitive === 'string' || primitive === 'number' || primitive === 'boolean') return true
  if (Array.isArray(value)) return value.every(isJsonValue)
  if (typeof value !== 'object') return false
  return Object.values(value).every(isJsonValue)
}
