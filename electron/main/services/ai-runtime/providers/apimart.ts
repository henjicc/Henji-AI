import { AiRuntimeError } from '../errors'
import { buildApiMartEndpoints, markApiMartEndpointReachable } from '../apimart-endpoints'
import { POLL_QUERY_FAILED, pollUntilResult } from '../polling'
import type { JsonValue, ProviderContinuePollingInput, ProviderExecutionInput, ProviderExecutionResult } from '../types'
import { collectDeepUrls, getPointer, isJsonObject, readJsonResponse, stringAt } from './helpers'
import { fetchProvider } from './provider-fetch'

const RESPONSE_VERSION = '2026-07-27'

export async function execute(input: ProviderExecutionInput): Promise<ProviderExecutionResult> {
  const payload = await sendCreateTask(input)
  const taskId = extractTaskId(payload)
  const urls = extractUrls(payload)

  if (urls.length > 0 && !taskId) {
    return { status: 'completed', url: urls.join('|||'), metadata: payload }
  }
  if (!taskId) {
    throw new AiRuntimeError('empty_result', 'APIMart response has neither task ID nor media URL')
  }
  return { status: 'pending', url: '', taskId, metadata: payload }
}

export async function continuePolling(input: ProviderContinuePollingInput): Promise<ProviderExecutionResult> {
  const payload = await pollTask(input)
  const urls = extractUrls(payload)
  if (urls.length === 0) {
    throw new AiRuntimeError('empty_result', `APIMart response has no media URL (task_id=${input.taskId})`)
  }
  return { status: 'completed', url: urls.join('|||'), taskId: input.taskId, metadata: payload }
}

async function sendCreateTask(input: ProviderExecutionInput): Promise<JsonValue> {
  const endpoints = buildApiMartEndpoints(input.route)
  const response = await fetchProvider('APIMart', endpoints[0], {
    method: input.method,
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': input.requestId,
      'X-APIMart-Response-Version': RESPONSE_VERSION,
    },
    // APIMart 全供应商统一关闭平台预审。这里在最终发送边界强制覆盖，
    // 防止当前或未来模型漏写、误写 nsfw_check。
    body: JSON.stringify(isJsonObject(input.body)
      ? { ...input.body, nsfw_check: false }
      : input.body),
    signal: input.signal,
  }, {
    // 仅在能证明尚未建立连接时切换官方大陆备用线路，避免扩大重放范围。
    retryPreconnectOnce: true,
    fallbackEndpoints: endpoints.slice(1),
    onEndpointReached: markApiMartEndpointReachable,
  })
  const payload = await readJsonResponse(response, 'APIMart')
  assertPayloadSucceeded(payload, 'APIMart create task failed')
  return payload
}

async function pollTask(input: ProviderContinuePollingInput): Promise<JsonValue> {
  return await pollUntilResult(input, async () => {
    const endpoints = buildApiMartEndpoints(`/v1/tasks/${encodeURIComponent(input.taskId)}`)
    const response = await fetchProvider('APIMart', endpoints[0], {
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        'X-APIMart-Response-Version': RESPONSE_VERSION,
      },
      signal: input.signal,
    }, {
      retryPreconnectOnce: true,
      fallbackEndpoints: endpoints.slice(1),
      onEndpointReached: markApiMartEndpointReachable,
    })
    const payload = await readJsonResponse(response, 'APIMart')
    const status = extractStatus(payload)

    if (['completed', 'succeeded', 'success'].includes(status)) return payload
    if (['failed', 'error', 'canceled', 'cancelled'].includes(status)) {
      throw new AiRuntimeError('provider_task_failed', extractErrorMessage(payload) ?? 'APIMart task failed')
    }
    if (!status) return POLL_QUERY_FAILED
    return undefined
  })
}

function assertPayloadSucceeded(payload: JsonValue, fallback: string): void {
  const status = extractStatus(payload)
  if (['failed', 'error', 'canceled', 'cancelled'].includes(status)) {
    throw new AiRuntimeError('provider_task_failed', extractErrorMessage(payload) ?? fallback)
  }
}

function extractTaskId(payload: JsonValue): string | undefined {
  for (const pointer of ['/data/id', '/data/task_id', '/data/taskId', '/data/0/task_id', '/task_id', '/taskId', '/id']) {
    const taskId = stringAt(payload, pointer)
    if (taskId?.trim()) return taskId
  }
  return undefined
}

function extractStatus(payload: JsonValue): string {
  for (const pointer of ['/data/status', '/data/state', '/data/0/status', '/status', '/state']) {
    const status = stringAt(payload, pointer)
    if (status) return status.trim().toLowerCase()
  }
  return ''
}

function extractErrorMessage(payload: JsonValue): string | undefined {
  for (const pointer of ['/data/error/message', '/error/message', '/data/error', '/error', '/message']) {
    const message = stringAt(payload, pointer)
    if (message?.trim()) return message
  }
  return undefined
}

function extractUrls(payload: JsonValue): string[] {
  const urls: string[] = []
  for (const pointer of [
    '/data/result/images',
    '/data/result/videos',
    '/result/images',
    '/result/videos',
    '/data/images',
    '/data/videos',
  ]) {
    const value = getPointer(payload, pointer)
    if (value !== undefined) collectDeepUrls(value, urls)
  }
  if (urls.length === 0) collectDeepUrls(payload, urls)
  return urls
}
