import { AiRuntimeError } from '../runtime/errors'
import type {
  JsonValue,
  ProviderContinuePollingInput,
  ProviderExecutionInput,
  ProviderExecutionResult,
} from '../types/runtime'

import { isJsonObject, normalizeEndpoint, pushUniqueUrl, readJsonResponse, stringAt } from './helpers'
import { fetchProvider } from './provider-fetch'

const BAILIAN_BASE_URL = 'https://dashscope.aliyuncs.com'

export async function execute(input: ProviderExecutionInput): Promise<ProviderExecutionResult> {
  const response = await fetchProvider('Bailian', normalizeEndpoint(BAILIAN_BASE_URL, input.route), {
    method: input.method,
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input.body),
    signal: input.signal,
  }, {
    transport: input.runtime.transport,
    retryPreconnectOnce: true,
  })
  const payload = await readJsonResponse(response, 'Bailian')
  const errorCode = stringAt(payload, '/code')
  if (errorCode) {
    throw new AiRuntimeError('provider_task_failed', stringAt(payload, '/message') ?? errorCode)
  }
  const urls = extractImageUrls(payload)
  if (urls.length === 0) {
    throw new AiRuntimeError('empty_result', 'Bailian response has no image URL')
  }
  return { status: 'completed', url: urls.join('|||'), metadata: payload }
}

export async function continuePolling(_input: ProviderContinuePollingInput): Promise<ProviderExecutionResult> {
  throw new AiRuntimeError('unsupported_provider', 'Bailian official image models use synchronous generation')
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
