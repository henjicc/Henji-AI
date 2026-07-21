import { AiRuntimeError } from '../errors'
import { pollUntilResult } from '../polling'
import type { JsonObject, JsonValue, ProviderContinuePollingInput, ProviderExecutionInput, ProviderExecutionResult } from '../types'
import { collectDeepUrls, normalizeEndpoint, readJsonResponse } from './helpers'

const FAL_SYNC_BASE_URL = 'https://fal.run'
const FAL_QUEUE_BASE_URL = 'https://queue.fal.run'

export async function execute(input: ProviderExecutionInput): Promise<ProviderExecutionResult> {
  const syncMode = isJsonObject(input.body) && input.body.sync_mode === true
  const cleanInput = stripSyncMode(input.body)
  const payload = syncMode
    ? await submit(input, normalizeEndpoint(FAL_SYNC_BASE_URL, input.route), cleanInput)
    : await submit(input, normalizeEndpoint(FAL_QUEUE_BASE_URL, input.route), cleanInput)

  if (!syncMode) {
    const taskId = readString(payload, 'request_id') ?? readString(payload, 'status_url') ?? input.requestId
    return { status: 'pending', url: '', taskId, metadata: payload }
  }

  const urls = extractUrls(payload)
  if (urls.length === 0) {
    throw new AiRuntimeError('empty_result', `Fal response has no media URL (request_id=${readString(payload, 'request_id') ?? input.requestId})`)
  }
  return { status: 'completed', url: urls.join('|||'), taskId: readString(payload, 'request_id'), metadata: payload }
}

export async function continuePolling(input: ProviderContinuePollingInput): Promise<ProviderExecutionResult> {
  const statusUrl = input.taskId.startsWith('http://') || input.taskId.startsWith('https://')
    ? input.taskId
    : `${FAL_QUEUE_BASE_URL}/${input.route.replace(/^\/+/, '')}/requests/${input.taskId}/status`
  const finalPayload = await pollByStatusUrl(input, statusUrl)
  const urls = extractUrls(finalPayload)
  if (urls.length === 0) {
    throw new AiRuntimeError('empty_result', `Fal response has no media URL (request_id=${input.taskId})`)
  }
  return { status: 'completed', url: urls.join('|||'), taskId: input.taskId, metadata: finalPayload }
}

async function submit(input: ProviderExecutionInput, endpoint: string, cleanInput: JsonValue): Promise<JsonValue> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Key ${input.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ input: cleanInput }),
    signal: input.signal,
  })
  return await readJsonResponse(response, 'Fal')
}

async function pollByStatusUrl(input: ProviderContinuePollingInput, statusUrl: string): Promise<JsonValue> {
  return await pollUntilResult(input, async () => {
    const response = await fetch(statusUrl, {
      headers: { Authorization: `Key ${input.apiKey}` },
      signal: input.signal,
    })
    const payload = await readJsonResponse(response, 'Fal')
    const state = (readString(payload, 'status') ?? '').toUpperCase()
    if (state === 'COMPLETED' || state === 'OK') {
      const responseUrl = readString(payload, 'response_url')
      if (!responseUrl) return enrichRequestId(payload, input.taskId)
      const finalResponse = await fetch(responseUrl, {
        headers: { Authorization: `Key ${input.apiKey}` },
        signal: input.signal,
      })
      return enrichRequestId(await readJsonResponse(finalResponse, 'Fal'), input.taskId)
    }
    if (state === 'FAILED' || state === 'ERROR') {
      throw new AiRuntimeError('provider_task_failed', 'Fal task failed')
    }
    return undefined
  })
}

function stripSyncMode(value: JsonValue): JsonValue {
  if (!isJsonObject(value)) return value
  const next: JsonObject = { ...value }
  delete next.sync_mode
  return next
}

function extractUrls(payload: JsonValue): string[] {
  const urls: string[] = []
  collectDeepUrls(payload, urls)
  return urls
}

function enrichRequestId(value: JsonValue, requestId: string): JsonValue {
  return isJsonObject(value) ? { request_id: requestId, ...value } : value
}

function readString(value: JsonValue, key: string): string | undefined {
  return isJsonObject(value) && typeof value[key] === 'string' ? value[key] : undefined
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
