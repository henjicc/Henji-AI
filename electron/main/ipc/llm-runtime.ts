import type { JsonObject, JsonValue, LlmChatRequestDto, LlmStreamEventDto } from '../services/llm/types'
import { cancelLlmRuntimeTask, llmChatStream } from '../services/llm/runtime'
import { discoverModels } from '../services/llm/discovery'
import type { DiscoveredModelItem } from '../services/llm/discovery'
import { parseRecord, parseStringField, registerIpcHandler } from './registry'

interface ChatStreamPayload {
  streamId: string
  request: LlmChatRequestDto
}

interface ChatStreamEventPayload {
  streamId: string
  event: LlmStreamEventDto
}

export function registerLlmRuntimeIpc(): void {
  registerIpcHandler<ChatStreamPayload, void>('llm:chatStream', parseChatStreamPayload, async (payload, event) => {
    await llmChatStream(payload.request, (streamEvent) => {
      const eventPayload: ChatStreamEventPayload = {
        streamId: payload.streamId,
        event: streamEvent,
      }
      event.sender.send('llm:chatStream:event', eventPayload)
    }, event.sender)
  })

  registerIpcHandler<string, void>('llm:cancelTask', (input) => parseStringField(input, 'taskId'), (taskId) => {
    cancelLlmRuntimeTask(taskId)
  })

  registerIpcHandler<{ providerId: string; baseUrl: string }, DiscoveredModelItem[]>(
    'llm:discoverModels',
    (input) => {
      const record = parseRecord(input)
      return {
        providerId: readString(record, 'providerId'),
        baseUrl: readString(record, 'baseUrl'),
      }
    },
    ({ providerId, baseUrl }) => discoverModels(providerId, baseUrl)
  )
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
    modelId: readString(record, 'modelId'),
    adapter: readOptionalString(record, 'adapter'),
    baseUrl: readOptionalString(record, 'baseUrl'),
    reasoning: readOptionalBoolean(record, 'reasoning'),
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

function readOptionalBoolean(record: Record<string, unknown>, field: string): boolean | undefined {
  const value = record[field]
  if (value === undefined) return undefined
  if (typeof value !== 'boolean') {
    throw new Error(`Expected boolean field "${field}"`)
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
