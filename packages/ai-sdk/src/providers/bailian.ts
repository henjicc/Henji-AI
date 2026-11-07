import { AiRuntimeError } from '../runtime/AiRuntimeError'
import { POLL_QUERY_FAILED, pollUntilResult } from '../protocols/polling'
import type {
  JsonValue,
  ProviderContinuePollingInput,
  ProviderExecutionInput,
  ProviderExecutionResult,
} from '../types/runtime'

import { getPointer, isJsonObject, normalizeEndpoint, pushUniqueUrl, readJsonResponse, stringAt } from './helpers'
import { fetchProvider } from './provider-fetch'
import { hexAudioToDataUri } from './audio-data'

const BAILIAN_BASE_URL = 'https://dashscope.aliyuncs.com'
/** 只支持异步调用的 DashScope 路由：提交必须带 `X-DashScope-Async: enable`，结果按 `/api/v1/tasks/{task_id}` 查询。 */
const ASYNC_ROUTES = new Set(['/api/v1/services/aigc/video-generation/video-synthesis'])

function isAsyncRoute(route: string): boolean {
  return ASYNC_ROUTES.has(route.replace(/\/+$/, ''))
}

async function readBailianJson(response: Response, model: string | undefined): Promise<JsonValue> {
  return await readJsonResponse(response, 'Bailian', (body) => {
    const message = ['/message', '/error/message', '/output/base_resp/status_msg']
      .map((pointer) => stringAt(body, pointer))
      .find((value) => value && /product is not activated|model.*(?:not activated|not authorized)|产品未开通|模型未开通/i.test(value))
    if (message) {
      throw new AiRuntimeError('provider_product_not_activated', `百炼账号未开通该模型（${model ?? '当前模型'}），请到百炼控制台 https://bailian.console.aliyun.com/ 开通后重试；开通前不要重复提交。`, {
        retryable: false, category: 'authentication', status: response.status,
        providerCode: stringAt(body, '/code') ?? stringAt(body, '/error/code') ?? getPointer(body, '/output/base_resp/status_code'),
        providerMessage: message,
      })
    }
  })
}

export async function execute(input: ProviderExecutionInput): Promise<ProviderExecutionResult> {
  const asyncTask = isAsyncRoute(input.route)
  const body = JSON.stringify(input.body)
  const response = await fetchProvider('Bailian', normalizeEndpoint(BAILIAN_BASE_URL, input.route), {
    method: input.method,
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      'Content-Type': 'application/json',
      ...(asyncTask ? { 'X-DashScope-Async': 'enable' } : {}),
      // 本地素材经临时存储上传成 oss:// 后，官方要求带这个头才会解析。
      ...(body.includes('"oss://') ? { 'X-DashScope-OssResourceResolve': 'enable' } : {}),
    },
    body,
    signal: input.signal,
  }, {
    transport: input.runtime.transport,
    retryPreconnectOnce: true,
  })
  const payload = await readBailianJson(response, stringAt(input.body, '/model'))
  const errorCode = stringAt(payload, '/code')
  if (errorCode) {
    throw new AiRuntimeError('provider_task_failed', stringAt(payload, '/message') ?? errorCode)
  }
  if (asyncTask) {
    const taskStatus = stringAt(payload, '/output/task_status')
    if (taskStatus === 'FAILED' || taskStatus === 'CANCELED') throw taskFailure(payload, taskStatus)
    const taskId = stringAt(payload, '/output/task_id')?.trim()
    if (!taskId) throw new AiRuntimeError('invalid_response', 'Bailian async task response has no task_id')
    return { status: 'pending', url: '', taskId, metadata: payload }
  }
  const speechStatus = getPointer(payload, '/output/base_resp/status_code')
  if (typeof speechStatus === 'number' && speechStatus !== 0) {
    throw new AiRuntimeError('provider_task_failed', stringAt(payload, '/output/base_resp/status_msg') ?? `MiniMax status ${speechStatus}`)
  }
  const hexAudio = stringAt(payload, '/output/data/audio')
  if (hexAudio) {
    const audioState = getPointer(payload, '/output/data/status')
    if (audioState !== 2) throw new AiRuntimeError('invalid_response', 'MiniMax audio response is not final')
    const format = stringAt(payload, '/output/extra_info/audio_format') ?? 'mp3'
    const url = /^https?:\/\//i.test(hexAudio) ? hexAudio : hexAudioToDataUri(hexAudio, format)
    const metadata = isJsonObject(payload) && isJsonObject(payload.output) && isJsonObject(payload.output.data)
      ? { ...payload, output: { ...payload.output, data: { ...payload.output.data, audio: '[omitted]' } } }
      : payload
    return { status: 'completed', url, metadata }
  }
  if (input.route.endsWith('/SpeechSynthesizer')) {
    const finishReason = stringAt(payload, '/output/finish_reason')
    if (finishReason !== 'stop') {
      throw new AiRuntimeError('invalid_response', `Bailian speech did not finish: ${finishReason ?? 'missing finish_reason'}`)
    }
    const audioUrl = stringAt(payload, '/output/audio/url')
    if (!audioUrl || !/^https?:\/\//i.test(audioUrl)) {
      throw new AiRuntimeError('empty_result', 'Bailian speech response has no audio URL')
    }
    return { status: 'completed', url: audioUrl, metadata: payload }
  }
  const urls = extractImageUrls(payload)
  if (urls.length === 0) {
    throw new AiRuntimeError('empty_result', 'Bailian response has no media URL')
  }
  return { status: 'completed', url: urls.join('|||'), metadata: payload }
}

export async function continuePolling(input: ProviderContinuePollingInput): Promise<ProviderExecutionResult> {
  if (!isAsyncRoute(input.route)) {
    throw new AiRuntimeError('unsupported_provider', 'Bailian official image models use synchronous generation')
  }
  const payload = await pollUntilResult(input, async () => {
    const response = await fetchProvider('Bailian', `${BAILIAN_BASE_URL}/api/v1/tasks/${encodeURIComponent(input.taskId)}`, {
      headers: { Authorization: `Bearer ${input.apiKey}` },
      signal: input.signal,
    }, {
      transport: input.runtime.transport,
      retryPreconnectOnce: true,
    })
    const result = await readBailianJson(response, undefined)
    const status = stringAt(result, '/output/task_status')
    if (status === 'SUCCEEDED') return result
    if (status === 'PENDING' || status === 'RUNNING') return undefined
    if (status === 'FAILED' || status === 'CANCELED') throw taskFailure(result, status)
    // UNKNOWN 表示任务不存在或已过 24 小时查询期；与缺状态一样计入连续查询失败，不立刻判死。
    return POLL_QUERY_FAILED
  })
  const videoUrl = stringAt(payload, '/output/video_url')
  if (!videoUrl || !/^https?:\/\//i.test(videoUrl)) {
    throw new AiRuntimeError('empty_result', `Bailian task has no video_url (task_id=${input.taskId})`)
  }
  return { status: 'completed', url: videoUrl, taskId: input.taskId, metadata: payload }
}

function taskFailure(payload: JsonValue, status: string): AiRuntimeError {
  const code = stringAt(payload, '/output/code')
  const message = stringAt(payload, '/output/message') ?? (status === 'CANCELED' ? '任务已取消' : 'Bailian task failed')
  return new AiRuntimeError('provider_task_failed', code ? `${code}: ${message}` : message, {
    providerCode: code, providerMessage: message,
  })
}

function extractImageUrls(value: JsonValue): string[] {
  const urls: string[] = []
  const visit = (item: JsonValue): void => {
    if (Array.isArray(item)) {
      item.forEach(visit)
      return
    }
    if (!isJsonObject(item)) return
    for (const [key, child] of Object.entries(item)) {
      if ((key === 'image' || key === 'url') && typeof child === 'string' && /^https?:\/\//.test(child)) {
        pushUniqueUrl(urls, child)
      }
      visit(child)
    }
  }
  visit(value)
  return urls
}
