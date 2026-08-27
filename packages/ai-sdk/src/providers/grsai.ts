import { AiRuntimeError } from '../runtime/AiRuntimeError'
import { POLL_QUERY_FAILED, pollUntilResult } from '../protocols/polling'
import type {
  JsonValue,
  ProviderContinuePollingInput,
  ProviderExecutionInput,
  ProviderExecutionResult,
} from '../types/runtime'

import { buildGrsaiEndpoints, markGrsaiEndpointReachable } from './endpoints/grsai'
import { collectDeepUrls, getPointer, isJsonObject, readJsonResponse, stringAt } from './helpers'
import { fetchProvider } from './provider-fetch'

// Grsai 状态是与 failed 平级的独立终态（内容审核不通过），必须单独判断，不能只看 succeeded/failed。
const TERMINAL_FAILURE_STATUSES = new Set(['failed', 'violation'])

export async function execute(input: ProviderExecutionInput): Promise<ProviderExecutionResult> {
  const payload = await sendGenerate(input)
  const status = extractStatus(payload)
  if (TERMINAL_FAILURE_STATUSES.has(status)) {
    throw new AiRuntimeError('provider_task_failed', extractErrorMessage(payload) ?? 'Grsai generate failed')
  }

  const urls = extractUrls(payload)
  if (status === 'succeeded' && urls.length > 0) {
    return { status: 'completed', url: urls.join('|||'), metadata: payload }
  }

  const taskId = extractTaskId(payload)
  if (taskId) {
    return { status: 'pending', url: '', taskId, metadata: payload }
  }
  if (urls.length > 0) {
    return { status: 'completed', url: urls.join('|||'), metadata: payload }
  }
  throw new AiRuntimeError('empty_result', 'Grsai response has neither task ID nor media URL')
}

export async function continuePolling(input: ProviderContinuePollingInput): Promise<ProviderExecutionResult> {
  const payload = await pollTask(input)
  const urls = extractUrls(payload)
  if (urls.length === 0) {
    throw new AiRuntimeError('empty_result', `Grsai response has no media URL (task_id=${input.taskId})`)
  }
  return { status: 'completed', url: urls.join('|||'), taskId: input.taskId, metadata: payload }
}

async function sendGenerate(input: ProviderExecutionInput): Promise<JsonValue> {
  const endpoints = buildGrsaiEndpoints(input.route)
  const response = await fetchProvider('Grsai', endpoints[0], {
    method: input.method,
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      'Content-Type': 'application/json',
    },
    // 项目按轮询模式接入，无论模型 builder 传了什么都在发送边界强制收敛为异步模式，
    // 防止漏写/误写导致改走同步等待或 SSE 流，与本项目的轮询驱动不兼容。
    body: JSON.stringify(isJsonObject(input.body)
      ? { ...input.body, replyType: 'async' }
      : input.body),
    signal: input.signal,
  }, {
    transport: input.runtime.transport,
    // 两条线路的账号/任务数据关系未经官方确认，只在能证明尚未建立连接时切换，不重放已建立连接后的失败。
    retryPreconnectOnce: true,
    fallbackEndpoints: endpoints.slice(1),
    onEndpointReached: markGrsaiEndpointReachable,
  })
  return await readJsonResponse(response, 'Grsai')
}

async function pollTask(input: ProviderContinuePollingInput): Promise<JsonValue> {
  return await pollUntilResult(input, async () => {
    const endpoints = buildGrsaiEndpoints(`/v1/api/result?id=${encodeURIComponent(input.taskId)}`)
    const response = await fetchProvider('Grsai', endpoints[0], {
      headers: { Authorization: `Bearer ${input.apiKey}` },
      signal: input.signal,
    }, {
      transport: input.runtime.transport,
      retryPreconnectOnce: true,
      fallbackEndpoints: endpoints.slice(1),
      onEndpointReached: markGrsaiEndpointReachable,
    })
    const payload = await readJsonResponse(response, 'Grsai')
    const status = extractStatus(payload)

    if (status === 'succeeded') return payload
    if (TERMINAL_FAILURE_STATUSES.has(status)) {
      throw new AiRuntimeError('provider_task_failed', extractErrorMessage(payload) ?? 'Grsai task failed')
    }
    if (status === 'running') return undefined
    // 状态字段缺失或未知取值：查询本身没能给出可信结果，计入连续失败而不是当作"仍在处理中"。
    return POLL_QUERY_FAILED
  })
}

function extractTaskId(payload: JsonValue): string | undefined {
  return stringAt(payload, '/id')
}

function extractStatus(payload: JsonValue): string {
  return (stringAt(payload, '/status') ?? '').trim().toLowerCase()
}

function extractErrorMessage(payload: JsonValue): string | undefined {
  const message = stringAt(payload, '/error')
  return message?.trim() ? message : undefined
}

function extractUrls(payload: JsonValue): string[] {
  const urls: string[] = []
  const results = getPointer(payload, '/results')
  if (results !== undefined) collectDeepUrls(results, urls)
  return urls
}
