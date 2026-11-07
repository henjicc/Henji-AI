import type { ProviderExecutionInput, ProviderExecutionResult } from '../types/runtime'
import { audioBytesToDataUri } from './audio-data'
import { isJsonObject, normalizeEndpoint, readJsonResponse } from './helpers'
import { fetchProvider } from './provider-fetch'

/**
 * OpenAI 兼容 `/audio/speech`：同步返回音频二进制，错误时返回 JSON 错误体。
 * 返回的音频转成 data URI，由宿主按普通媒体结果落盘。
 */
export async function executeOpenAiCompatibleSpeech(
  providerName: string,
  baseUrl: string,
  input: ProviderExecutionInput,
  defaultFormat: string,
): Promise<ProviderExecutionResult> {
  const response = await fetchProvider(providerName, normalizeEndpoint(baseUrl, input.route), {
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
    await readJsonResponse(response, providerName)
  }
  const bytes = new Uint8Array(await response.arrayBuffer())
  const format = isJsonObject(input.body) && typeof input.body.response_format === 'string' ? input.body.response_format : defaultFormat
  return {
    status: 'completed',
    url: audioBytesToDataUri(bytes, format),
    metadata: { contentType: response.headers.get('content-type'), byteLength: bytes.byteLength },
  }
}
