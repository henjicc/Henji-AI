import { AiRuntimeError } from '../errors'
import { POLL_QUERY_FAILED, pollUntilResult } from '../polling'
import type { JsonValue, ProviderContinuePollingInput, ProviderExecutionInput, ProviderExecutionResult } from '../types'
import { getPointer, normalizeEndpoint, pushUniqueUrl, readJsonResponse, stringAt } from './helpers'

const KIE_BASE_URL = 'https://api.kie.ai'
const KIE_STATUS_ENDPOINT = '/api/v1/jobs/recordInfo'

export async function execute(input: ProviderExecutionInput): Promise<ProviderExecutionResult> {
  const response = await sendCreateTask(input, normalizeEndpoint(KIE_BASE_URL, input.route))
  const taskId = extractTaskId(response)
  if (taskId) {
    return { status: 'pending', url: '', taskId, metadata: response }
  }

  const urls = extractUrls(response)
  if (urls.length === 0) {
    throw new AiRuntimeError('empty_result', `KIE response has no media URL (task_id=${taskId ?? 'unknown'})`)
  }
  return { status: 'completed', url: urls.join('|||'), taskId, metadata: response }
}

export async function continuePolling(input: ProviderContinuePollingInput): Promise<ProviderExecutionResult> {
  const finalPayload = await pollTask(input)
  const urls = extractUrls(finalPayload)
  if (urls.length === 0) {
    throw new AiRuntimeError('empty_result', `KIE response has no media URL (task_id=${input.taskId})`)
  }
  return { status: 'completed', url: urls.join('|||'), taskId: input.taskId, metadata: finalPayload }
}

async function sendCreateTask(input: ProviderExecutionInput, endpoint: string): Promise<JsonValue> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input.body),
    signal: input.signal,
  })
  const payload = await readJsonResponse(response, 'KIE')
  const code = getPointer(payload, '/code')
  if (typeof code === 'number' && code !== 200) {
    throw new AiRuntimeError('provider_task_failed', stringAt(payload, '/msg') ?? 'KIE create task failed')
  }
  return payload
}

async function pollTask(input: ProviderContinuePollingInput): Promise<JsonValue> {
  return await pollUntilResult(input, async () => {
    const endpoint = `${KIE_BASE_URL}${KIE_STATUS_ENDPOINT}?taskId=${encodeURIComponent(input.taskId)}`
    const response = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${input.apiKey}` },
      signal: input.signal,
    })
    const payload = await readJsonResponse(response, 'KIE')
    const code = getPointer(payload, '/code')
    if (typeof code === 'number' && code !== 200) {
      // 查询本身没成功（含 taskId 已被清理的情况），不是"任务还在跑"
      return POLL_QUERY_FAILED
    }
    const state = stringAt(payload, '/data/state') ?? ''
    if (state === 'success') return payload
    if (state === 'fail') {
      throw new AiRuntimeError('provider_task_failed', stringAt(payload, '/data/failMsg') ?? 'KIE task failed')
    }
    return undefined
  })
}

function extractTaskId(payload: JsonValue): string | undefined {
  return stringAt(payload, '/data/taskId')
}

function extractUrls(payload: JsonValue): string[] {
  const resultJson = stringAt(payload, '/data/resultJson')
  if (resultJson) {
    try {
      const parsed = JSON.parse(resultJson) as JsonValue
      const urls: string[] = []
      extractFromArray(getPointer(parsed, '/resultUrls'), urls)
      extractFromArray(getPointer(parsed, '/images'), urls)
      extractFromArray(getPointer(parsed, '/videos'), urls)
      if (urls.length > 0) return urls
    } catch {
      // Fall through to direct payload extraction.
    }
  }
  const urls: string[] = []
  extractFromArray(getPointer(payload, '/resultUrls'), urls)
  extractFromArray(getPointer(payload, '/images'), urls)
  extractFromArray(getPointer(payload, '/videos'), urls)
  return urls
}

function extractFromArray(value: JsonValue | undefined, target: string[]): void {
  if (!Array.isArray(value)) return
  for (const item of value) {
    if (typeof item === 'string') pushUniqueUrl(target, item)
    else {
      const url = getPointer(item, '/url')
      if (typeof url === 'string') pushUniqueUrl(target, url)
    }
  }
}
