import { AiRuntimeError } from '../errors'
import { pollUntilResult } from '../polling'
import type { JsonValue, ProviderContinuePollingInput, ProviderExecutionInput, ProviderExecutionResult } from '../types'
import { getPointer, normalizeEndpoint, pushUniqueUrl, readJsonResponse, stringAt } from './helpers'

// 官网与全部文档示例现已统一使用 api.ppio.com；旧域名 api.ppinfra.com 目前仍可用
// （两者对同一路由返回一致），但官方已无任何引用，按现行域名接入。
const PPIO_BASE_URL = 'https://api.ppio.com/v3'

export async function execute(input: ProviderExecutionInput): Promise<ProviderExecutionResult> {
  const endpoint = normalizeEndpoint(PPIO_BASE_URL, input.route)
  const response = await sendJson(input, endpoint)
  const taskId = extractTaskId(response)
  if (taskId) {
    return { status: 'pending', url: '', taskId, metadata: response }
  }

  const urls = extractUrls(response)
  if (urls.length === 0) {
    throw new AiRuntimeError('empty_result', `PPIO response has no media URL (task_id=${taskId ?? 'unknown'})`)
  }
  return { status: 'completed', url: urls.join('|||'), taskId, metadata: response }
}

export async function continuePolling(input: ProviderContinuePollingInput): Promise<ProviderExecutionResult> {
  const finalPayload = await pollTask(input)
  const urls = extractUrls(finalPayload)
  if (urls.length === 0) {
    throw new AiRuntimeError('empty_result', `PPIO response has no media URL (task_id=${input.taskId})`)
  }
  return { status: 'completed', url: urls.join('|||'), taskId: input.taskId, metadata: finalPayload }
}

async function sendJson(input: ProviderExecutionInput, endpoint: string): Promise<JsonValue> {
  const response = await fetch(endpoint, {
    method: input.method.toUpperCase() === 'GET' ? 'GET' : 'POST',
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: input.method.toUpperCase() === 'GET' ? undefined : JSON.stringify(input.body),
    signal: input.signal,
  })
  return await readJsonResponse(response, 'PPIO')
}

async function pollTask(input: ProviderContinuePollingInput): Promise<JsonValue> {
  return await pollUntilResult(input, async () => {
    const response = await fetch(`${PPIO_BASE_URL}/async/task-result?task_id=${encodeURIComponent(input.taskId)}`, {
      headers: { Authorization: `Bearer ${input.apiKey}` },
      signal: input.signal,
    })
    const payload = await readJsonResponse(response, 'PPIO')
    const state = stringAt(payload, '/task/status') ?? ''
    if (state === 'TASK_STATUS_SUCCEED') return payload
    if (state === 'TASK_STATUS_FAILED') {
      throw new AiRuntimeError('provider_task_failed', extractTaskFailureReason(payload))
    }
    return undefined
  })
}

function extractTaskId(payload: JsonValue): string | undefined {
  return stringAt(payload, '/task_id') ?? stringAt(payload, '/task/task_id') ?? stringAt(payload, '/data/task_id')
}

function extractUrls(payload: JsonValue): string[] {
  const urls: string[] = []
  for (const pointer of ['/images', '/image_urls', '/videos', '/audios', '/task/output/images', '/task/output/image_urls', '/task/output/videos', '/task/output/audios', '/data/images', '/data/image_urls', '/data/videos', '/data/audios']) {
    extractStringArray(getPointer(payload, pointer), urls)
  }
  if (urls.length > 0) return urls
  for (const pointer of ['/url', '/image_url', '/video_url', '/audio_url', '/demo_audio_url', '/audio', '/output', '/task/output/url', '/task/output/image_url', '/task/output/video_url', '/task/output/audio_url', '/task/output/demo_audio_url', '/task/output/audio', '/data/url', '/data/image_url', '/data/video_url', '/data/audio_url', '/data/demo_audio_url', '/data/audio']) {
    const url = stringAt(payload, pointer)
    if (url) pushUniqueUrl(urls, url)
  }
  return urls
}

function extractStringArray(value: JsonValue | undefined, target: string[]): void {
  if (!Array.isArray(value)) return
  for (const item of value) {
    if (typeof item === 'string') {
      pushUniqueUrl(target, item)
    } else {
      for (const key of ['url', 'image_url', 'video_url', 'audio_url', 'demo_audio_url']) {
        const url = getPointer(item, `/${key}`)
        if (typeof url === 'string') {
          pushUniqueUrl(target, url)
          break
        }
      }
    }
  }
}

function extractTaskFailureReason(payload: JsonValue): string {
  for (const pointer of ['/task/reason', '/task/message', '/task/error', '/message', '/error', '/reason', '/task/output/message', '/task/output/error', '/task/extra/debug_info/message', '/task/extra/debug_info/error']) {
    const value = getPointer(payload, pointer)
    if (typeof value === 'string' && value.trim()) return value
  }
  return 'task failed'
}
