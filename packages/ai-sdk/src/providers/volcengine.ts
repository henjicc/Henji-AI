import { AiRuntimeError } from '../runtime/errors'
import type {
  ProviderContinuePollingInput,
  ProviderExecutionInput,
  ProviderExecutionResult,
} from '../types/runtime'

import { collectDeepUrls, normalizeEndpoint, readJsonResponse, stringAt } from './helpers'
import { fetchProvider } from './provider-fetch'

const VOLCENGINE_BASE_URL = 'https://ark.cn-beijing.volces.com'

export async function execute(input: ProviderExecutionInput): Promise<ProviderExecutionResult> {
  const response = await fetchProvider('Volcengine Ark', normalizeEndpoint(VOLCENGINE_BASE_URL, input.route), {
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
  const payload = await readJsonResponse(response, 'Volcengine Ark')
  const errorMessage = stringAt(payload, '/error/message') ?? stringAt(payload, '/message')
  if (stringAt(payload, '/error/code') || stringAt(payload, '/code')) {
    throw new AiRuntimeError('provider_task_failed', errorMessage ?? 'Volcengine Ark generation failed')
  }
  const urls: string[] = []
  collectDeepUrls(payload, urls)
  if (urls.length === 0) {
    throw new AiRuntimeError('empty_result', 'Volcengine Ark response has no image URL')
  }
  return { status: 'completed', url: urls.join('|||'), metadata: payload }
}

export async function continuePolling(_input: ProviderContinuePollingInput): Promise<ProviderExecutionResult> {
  throw new AiRuntimeError('unsupported_provider', 'Volcengine Ark image models use synchronous generation')
}
