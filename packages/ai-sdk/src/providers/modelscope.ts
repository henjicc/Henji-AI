import { AiRuntimeError } from '../runtime/AiRuntimeError'
import { pollUntilResult } from '../protocols/polling'
import type {
  JsonValue,
  ProviderContinuePollingInput,
  ProviderExecutionInput,
  ProviderExecutionResult,
} from '../types/runtime'

import { getPointer, normalizeEndpoint, pushUniqueUrl, readJsonResponse, stringAt } from './helpers'

const MODELSCOPE_BASE_URL = 'https://api-inference.modelscope.cn'

export async function execute(input: ProviderExecutionInput): Promise<ProviderExecutionResult> {
  const response = await submitTask(input, normalizeEndpoint(MODELSCOPE_BASE_URL, input.route))
  const taskId = stringAt(response, '/task_id')
  if (!taskId) {
    throw new AiRuntimeError('invalid_response', 'ModelScope response missing task_id')
  }
  return { status: 'pending', url: '', taskId, metadata: response }
}

export async function continuePolling(input: ProviderContinuePollingInput): Promise<ProviderExecutionResult> {
  const finalPayload = await pollTask(input)
  const urls = extractUrls(finalPayload)
  if (urls.length === 0) {
    throw new AiRuntimeError('empty_result', `ModelScope response has no output_images (task_id=${input.taskId})`)
  }
  return { status: 'completed', url: urls.join('|||'), taskId: input.taskId, metadata: finalPayload }
}

async function submitTask(input: ProviderExecutionInput, endpoint: string): Promise<JsonValue> {
  const response = await input.runtime.transport.fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      'Content-Type': 'application/json',
      'X-ModelScope-Async-Mode': 'true',
    },
    body: JSON.stringify(input.body),
    signal: input.signal,
  })
  return await readJsonResponse(response, 'ModelScope')
}

async function pollTask(input: ProviderContinuePollingInput): Promise<JsonValue> {
  return await pollUntilResult(input, async () => {
    const response = await input.runtime.transport.fetch(`${MODELSCOPE_BASE_URL}/v1/tasks/${encodeURIComponent(input.taskId)}`, {
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        'Content-Type': 'application/json',
        'X-ModelScope-Task-Type': 'image_generation',
      },
      signal: input.signal,
    })
    const payload = await readJsonResponse(response, 'ModelScope')
    const state = stringAt(payload, '/task_status') ?? ''
    if (state === 'SUCCEED') return payload
    if (state === 'FAILED') throw new AiRuntimeError('provider_task_failed', 'ModelScope task failed')
    return undefined
  })
}

function extractUrls(payload: JsonValue): string[] {
  const urls: string[] = []
  const items = getPointer(payload, '/output_images')
  if (!Array.isArray(items)) {
    return urls
  }
  for (const item of items) {
    if (typeof item === 'string') {
      pushUniqueUrl(urls, item)
    }
  }
  return urls
}
