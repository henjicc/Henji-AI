import { AiRuntimeError } from '../runtime/AiRuntimeError'
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
