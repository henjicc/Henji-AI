import { AiRuntimeError } from '../runtime/AiRuntimeError'
import type { ProviderContinuePollingInput, ProviderExecutionInput, ProviderExecutionResult } from '../types/runtime'
import { audioBytesToDataUri } from './audio-data'
import { normalizeEndpoint } from './helpers'
import { isJsonObject } from './helpers'
import { fetchProvider } from './provider-fetch'

const BASE_URL = 'https://api.siliconflow.cn'

export async function execute(input: ProviderExecutionInput): Promise<ProviderExecutionResult> {
  const response = await fetchProvider('SiliconFlow', normalizeEndpoint(BASE_URL, input.route), {
    method: 'POST',
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
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined)
    throw new AiRuntimeError('provider_task_failed', `SiliconFlow speech request failed (HTTP ${response.status})`)
  }
  const bytes = new Uint8Array(await response.arrayBuffer())
  const requestedFormat = isJsonObject(input.body) && typeof input.body.response_format === 'string' ? input.body.response_format : 'mp3'
  const url = audioBytesToDataUri(bytes, requestedFormat)
  return {
    status: 'completed', url,
    metadata: { contentType: response.headers.get('content-type'), byteLength: bytes.byteLength },
  }
}

export async function continuePolling(_input: ProviderContinuePollingInput): Promise<ProviderExecutionResult> {
  throw new AiRuntimeError('unsupported_provider', 'SiliconFlow speech response is synchronous')
}
