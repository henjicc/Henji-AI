import { AiRuntimeError } from '../runtime/AiRuntimeError'
import { POLL_QUERY_FAILED, pollUntilResult } from '../protocols/polling'
import type {
  JsonValue,
  ProviderContinuePollingInput,
  ProviderExecutionInput,
  ProviderExecutionResult,
} from '../types/runtime'

import { collectDeepUrls, getPointer, isJsonObject, normalizeEndpoint, pushUniqueUrl, readJsonResponse, stringAt } from './helpers'
import { fetchProvider } from './provider-fetch'

const VOLCENGINE_BASE_URL = 'https://ark.cn-beijing.volces.com'
/** 方舟视频生成是异步任务：提交返回任务 ID，再按 `GET {route}/{id}` 查询；图片生成走同步端点。 */
const VIDEO_TASK_ROUTE = '/api/v3/contents/generations/tasks'

function isVideoTaskRoute(route: string): boolean {
  return route.replace(/\/+$/, '') === VIDEO_TASK_ROUTE
}

function authHeaders(apiKey: string): Record<string, string> {
  return { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
}

export async function execute(input: ProviderExecutionInput): Promise<ProviderExecutionResult> {
  const response = await fetchProvider('Volcengine Ark', normalizeEndpoint(VOLCENGINE_BASE_URL, input.route), {
    method: input.method,
    headers: authHeaders(input.apiKey),
    body: JSON.stringify(isVideoTaskRoute(input.route) ? normalizeAudioDataUris(input.body) : input.body),
    signal: input.signal,
  }, {
    transport: input.runtime.transport,
    retryPreconnectOnce: true,
  })
  const payload = await readJsonResponse(response, 'Volcengine Ark')
  assertNoArkError(payload, 'Volcengine Ark generation failed')
  if (isVideoTaskRoute(input.route)) {
    const taskId = stringAt(payload, '/id')?.trim()
    if (!taskId) throw new AiRuntimeError('invalid_response', 'Volcengine Ark video task response has no id')
    return { status: 'pending', url: '', taskId, metadata: payload }
  }
  const urls: string[] = []
  collectDeepUrls(payload, urls)
  if (urls.length === 0) {
    throw new AiRuntimeError('empty_result', 'Volcengine Ark response has no image URL')
  }
  return { status: 'completed', url: urls.join('|||'), metadata: payload }
}

export async function continuePolling(input: ProviderContinuePollingInput): Promise<ProviderExecutionResult> {
  if (!isVideoTaskRoute(input.route)) {
    throw new AiRuntimeError('unsupported_provider', 'Volcengine Ark image models use synchronous generation')
  }
  const payload = await pollUntilResult(input, async () => {
    const endpoint = `${VOLCENGINE_BASE_URL}${VIDEO_TASK_ROUTE}/${encodeURIComponent(input.taskId)}`
    const response = await fetchProvider('Volcengine Ark', endpoint, {
      headers: authHeaders(input.apiKey),
      signal: input.signal,
    }, {
      transport: input.runtime.transport,
      retryPreconnectOnce: true,
    })
    const result = await readJsonResponse(response, 'Volcengine Ark')
    const status = (stringAt(result, '/status') ?? '').trim().toLowerCase()
    if (status === 'succeeded') return result
    if (status === 'queued' || status === 'running') return undefined
    if (status === 'failed' || status === 'cancelled' || status === 'expired') {
      const code = stringAt(result, '/error/code')
      const message = stringAt(result, '/error/message')
        ?? (status === 'expired' ? '任务超过方舟任务超时阈值未完成' : status === 'cancelled' ? '任务已被取消' : 'Volcengine Ark video task failed')
      throw new AiRuntimeError('provider_task_failed', code ? `${code}: ${message}` : message, {
        providerCode: code, providerMessage: message,
      })
    }
    return POLL_QUERY_FAILED
  })
  const urls: string[] = []
  // 视频在前、尾帧在后：消费方按顺序把第一项当作主产物。
  for (const pointer of ['/content/video_url', '/content/last_frame_url']) {
    const url = stringAt(payload, pointer)
    if (url && /^https?:\/\//i.test(url)) pushUniqueUrl(urls, url)
  }
  const videoUrl = stringAt(payload, '/content/video_url')
  if (!videoUrl || !/^https?:\/\//i.test(videoUrl)) {
    throw new AiRuntimeError('empty_result', `Volcengine Ark video task has no video_url (task_id=${input.taskId})`)
  }
  return { status: 'completed', url: urls.join('|||'), taskId: input.taskId, metadata: payload }
}

function assertNoArkError(payload: JsonValue, fallback: string): void {
  const errorMessage = stringAt(payload, '/error/message') ?? stringAt(payload, '/message')
  if (stringAt(payload, '/error/code') || stringAt(payload, '/code')) {
    throw new AiRuntimeError('provider_task_failed', errorMessage ?? fallback)
  }
}

/**
 * 方舟音频 Base64 要求 `data:audio/<格式>;base64,`，格式写 wav/mp3；本地文件读出的
 * 标准 MIME 是 audio/mpeg、audio/x-wav 等，发送前换成官方格式名。
 */
function normalizeAudioDataUris(body: JsonValue): JsonValue {
  if (!isJsonObject(body) || !Array.isArray(body.content)) return body
  const content = body.content.map((item) => {
    const url = getPointer(item, '/audio_url/url')
    if (!isJsonObject(item) || !isJsonObject(item.audio_url) || typeof url !== 'string') return item
    const match = /^data:audio\/([^;,]+);base64,/i.exec(url)
    if (!match) return item
    const subtype = match[1].toLowerCase()
    const format = subtype === 'mpeg' || subtype === 'mp3' ? 'mp3'
      : ['wav', 'x-wav', 'wave', 'vnd.wave'].includes(subtype) ? 'wav' : null
    // 方舟只收 wav / mp3；其他格式提交前就拦下，不让用户只看到供应商报错。
    if (!format) throw new AiRuntimeError('invalid_media', `火山方舟参考音频只支持 MP3 或 WAV，当前是 ${subtype}，请先转换格式`)
    return { ...item, audio_url: { ...item.audio_url, url: `data:audio/${format};base64,${url.slice(match[0].length)}` } }
  })
  return { ...body, content }
}
