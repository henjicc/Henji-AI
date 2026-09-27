import type { RuntimeContext } from '../runtime/RuntimeContext'
import { fetchProvider } from './provider-fetch'

export interface TtsVoice {
  id: string
  name: string
  description?: string
  source?: 'system' | 'clone'
}

type VoiceModelId =
  | 'bailian-minimax-speech-2.8'
  | 'bailian-cosyvoice-v3.5'
  | 'bailian-qwen-audio-3.1-tts-flash'
  | 'siliconflow-cosyvoice2-tts'

const VOICE_PROVIDERS: Record<VoiceModelId, string> = {
  'bailian-minimax-speech-2.8': 'bailian',
  'bailian-cosyvoice-v3.5': 'bailian',
  'bailian-qwen-audio-3.1-tts-flash': 'bailian',
  'siliconflow-cosyvoice2-tts': 'siliconflow',
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function string(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function voiceDescription(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined
  if (Array.isArray(value)) {
    const joined = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).join(' · ')
    return joined || undefined
  }
  return undefined
}

function uniqueVoices(voices: TtsVoice[]): TtsVoice[] {
  return [...new Map(voices.map((voice) => [voice.id, voice])).values()]
}

async function requestJson(
  providerId: string,
  url: string,
  apiKey: string,
  runtime: RuntimeContext,
  body?: Record<string, unknown>,
): Promise<unknown> {
  const response = await fetchProvider(providerId, url, {
    method: body ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }, { transport: runtime.transport, retryPreconnectOnce: false })
  if (!response.ok) {
    throw new Error(`${providerId} 音色列表请求失败（HTTP ${response.status}）`)
  }
  try {
    return await response.json()
  } catch {
    throw new Error(`${providerId} 音色列表响应格式错误`)
  }
}

async function listBailianMinimax(apiKey: string, runtime: RuntimeContext): Promise<TtsVoice[]> {
  const payload = object(await requestJson(
    'bailian',
    'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
    apiKey,
    runtime,
    { model: 'MiniMax/speech-2.8-turbo', input: { action: 'get_voice', voice_type: 'all' } },
  ))
  const output = object(payload?.output)
  const baseResp = object(output?.base_resp)
  if (!output || baseResp?.status_code !== 0 || (!Array.isArray(output.system_voice) && !Array.isArray(output.voice_cloning))) {
    throw new Error('百炼 MiniMax 音色列表返回错误')
  }
  const voices: TtsVoice[] = []
  for (const source of ['system_voice', 'voice_cloning'] as const) {
    const entries = output[source]
    if (!Array.isArray(entries)) continue
    for (const item of entries) {
      const entry = object(item)
      const id = string(entry?.voice_id)
      if (!id) continue
      voices.push({
        id,
        name: string(entry?.voice_name) || id,
        description: voiceDescription(entry?.description),
        source: source === 'system_voice' ? 'system' : 'clone',
      })
    }
  }
  return uniqueVoices(voices)
}

async function listBailianEnrollment(modelId: VoiceModelId, apiKey: string, runtime: RuntimeContext): Promise<TtsVoice[]> {
  const prefix = modelId === 'bailian-cosyvoice-v3.5' ? 'cosyvoice-v3.5-' : 'qwen-audio-3.1-tts-flash-'
  const voices: TtsVoice[] = []
  const pageSize = 50
  for (let pageIndex = 0; pageIndex < 20; pageIndex += 1) {
    const payload = object(await requestJson(
      'bailian',
      'https://dashscope.aliyuncs.com/api/v1/services/audio/tts/customization',
      apiKey,
      runtime,
      { model: 'voice-enrollment', input: { action: 'list_voice', page_index: pageIndex, page_size: pageSize } },
    ))
    const output = object(payload?.output)
    const entries = output?.voice_list
    if (!Array.isArray(entries)) throw new Error('百炼复刻音色列表响应格式错误')
    for (const item of entries) {
      const entry = object(item)
      const id = string(entry?.voice_id)
      if (!id.startsWith(prefix) || entry?.status !== 'OK') continue
      voices.push({ id, name: id, source: 'clone' })
    }
    if (entries.length < pageSize) return uniqueVoices(voices)
  }
  throw new Error('百炼复刻音色超过查询页数限制')
}

async function listSiliconflow(apiKey: string, runtime: RuntimeContext): Promise<TtsVoice[]> {
  const payload = await requestJson('siliconflow', 'https://api.siliconflow.cn/v1/audio/voice/list', apiKey, runtime)
  const root = object(payload)
  const data = object(root?.data)
  const entries = Array.isArray(payload) ? payload
    : Array.isArray(root?.data) ? root.data
      : Array.isArray(data?.voices) ? data.voices
        : Array.isArray(root?.voices) ? root.voices
          : null
  if (!entries) throw new Error('硅基流动音色列表响应格式错误')
  const voices: TtsVoice[] = []
  for (const item of entries) {
    const entry = object(item)
    const id = string(entry?.uri)
    if (!id) continue
    voices.push({ id, name: string(entry?.customName) || string(entry?.name) || id, source: 'clone' })
  }
  return uniqueVoices(voices)
}

/** 查询供应商账号中的可用音色；静态系统音色由宿主的展示目录提供。 */
export async function listTtsVoices(modelId: string, runtime: RuntimeContext): Promise<TtsVoice[]> {
  if (!Object.prototype.hasOwnProperty.call(VOICE_PROVIDERS, modelId)) throw new Error(`不支持查询 ${modelId} 的音色`)
  const providerId = VOICE_PROVIDERS[modelId as VoiceModelId]
  const apiKey = await runtime.credentials.get('generation', providerId)
  if (!apiKey) throw new Error(`请先设置${providerId} API Key`)
  runtime.logger?.info('tts_voice.list.start', { providerId, modelId })
  try {
    const voices = modelId === 'bailian-minimax-speech-2.8'
      ? await listBailianMinimax(apiKey, runtime)
      : modelId === 'siliconflow-cosyvoice2-tts'
        ? await listSiliconflow(apiKey, runtime)
        : await listBailianEnrollment(modelId as VoiceModelId, apiKey, runtime)
    runtime.logger?.info('tts_voice.list.completed', { providerId, modelId, context: { count: voices.length } })
    return voices
  } catch (error) {
    runtime.logger?.warn('tts_voice.list.failed', { providerId, modelId, error })
    throw error
  }
}
