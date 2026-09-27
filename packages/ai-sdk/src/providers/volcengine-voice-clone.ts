import { AiRuntimeError } from '../runtime/AiRuntimeError'
import { volcengineRequestId } from '../capabilities/speech-recognition/volcengine/request-id'
import { pollUntilResult } from '../protocols/polling'
import type { JsonObject, JsonValue, ProviderExecutionInput, ProviderContinuePollingInput, ProviderExecutionResult } from '../types/runtime'
import { parseDataUri } from '../upload/media-binary'
import { toBase64 } from '../upload/base64'
import { isJsonObject } from './helpers'
import { fetchProvider } from './provider-fetch'

interface CloneIdentity { speaker: string; name: string; postpaid: boolean }
const TASK_PREFIX = 'volc-voice:'
const MAX_AUDIO_BYTES = 10_000_000

function taskId(identity: CloneIdentity): string { return TASK_PREFIX + encodeURIComponent(JSON.stringify(identity)) }

function decodeTask(value: string): CloneIdentity {
  try {
    if (!value.startsWith(TASK_PREFIX)) throw new Error('prefix')
    const data = JSON.parse(decodeURIComponent(value.slice(TASK_PREFIX.length))) as JsonValue
    if (!isJsonObject(data) || typeof data.speaker !== 'string' || !data.speaker.trim()
      || typeof data.name !== 'string' || !data.name.trim() || typeof data.postpaid !== 'boolean') throw new Error('identity')
    return { speaker: data.speaker, name: data.name, postpaid: data.postpaid }
  } catch { throw new AiRuntimeError('invalid_task_id', '无效的音色训练任务') }
}

function speakerBody(identity: CloneIdentity): JsonObject {
  return identity.postpaid
    ? { speaker_id: 'custom_speaker_id', custom_speaker_id: identity.speaker }
    : { speaker_id: identity.speaker }
}

async function request(input: ProviderExecutionInput | ProviderContinuePollingInput, route: string, body: JsonObject): Promise<JsonObject> {
  input.signal?.throwIfAborted()
  const response = await fetchProvider('Volcengine Speech', `https://openspeech.bytedance.com${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Api-Key': input.apiKey, 'X-Api-Request-Id': volcengineRequestId(input.requestId, undefined) },
    body: JSON.stringify(body), signal: input.signal,
  }, { transport: input.runtime.transport, retryPreconnectOnce: false })
  const payload = await response.json() as JsonValue
  if (!isJsonObject(payload)) throw new AiRuntimeError('invalid_response', '音色训练返回了无效响应')
  if (!response.ok || (payload.code !== undefined && payload.code !== 0)) {
    throw new AiRuntimeError('provider_task_failed', typeof payload.message === 'string' ? payload.message : `音色训练请求失败（HTTP ${response.status}）`)
  }
  return payload
}

function parseResult(payload: JsonObject, identity: CloneIdentity): ProviderExecutionResult {
  if (typeof payload.speaker_id !== 'string' || !payload.speaker_id.trim()
    || ![0, 1, 2, 3, 4].includes(payload.status as number)) {
    throw new AiRuntimeError('invalid_response', '音色训练响应缺少有效音色或状态')
  }
  // 后付费响应可返回固定代号；实际自定义代号来自已提交任务身份。
  if (payload.speaker_id !== identity.speaker && !(identity.postpaid && payload.speaker_id === 'custom_speaker_id')) {
    throw new AiRuntimeError('invalid_response', '音色查询返回了其他音色')
  }
  if (payload.status === 0 || payload.status === 3) {
    throw new AiRuntimeError(payload.status === 0 ? 'voice_not_found' : 'voice_training_failed', typeof payload.message === 'string' ? payload.message : payload.status === 0 ? '音色不存在或尚未训练' : '音色训练失败', { retryable: false })
  }
  const ready = payload.status === 2 || payload.status === 4
  const samples = Array.isArray(payload.speaker_status) ? payload.speaker_status : []
  const sample = samples.find(item => isJsonObject(item) && item.model_type === 5)
  const demo = isJsonObject(sample) && typeof sample.demo_audio === 'string' ? sample.demo_audio : ''
  if (demo && !/^https:\/\//i.test(demo)) throw new AiRuntimeError('invalid_response', '音色试听地址无效')
  return {
    status: ready ? 'completed' : 'pending', url: ready ? demo : '', taskId: taskId(identity),
    metadata: {
      ...payload,
      clonedVoice: { id: identity.speaker, name: identity.name, status: ready ? 'ready' : 'training',
        postpaid: identity.postpaid, activated: payload.status === 4,
        ...(typeof payload.create_time === 'number' ? { createdAt: payload.create_time } : {}) },
    },
  }
}

export async function executeVoiceClone(input: ProviderExecutionInput): Promise<ProviderExecutionResult> {
  if (!isJsonObject(input.body)) throw new AiRuntimeError('invalid_request', '音色克隆参数无效')
  const body = input.body
  if (typeof body.clone_audio !== 'string' || typeof body.voice_name !== 'string' || !body.voice_name.trim()) {
    throw new AiRuntimeError('invalid_request', '请填写音色名称并上传声音样本')
  }
  const existing = typeof body.speaker_id === 'string' ? body.speaker_id.trim() : ''
  const custom = typeof body.custom_speaker_id === 'string' ? body.custom_speaker_id.trim() : ''
  const identity: CloneIdentity = {
    speaker: existing || custom || `henji${volcengineRequestId(input.requestId, undefined).replaceAll('-', '')}`,
    name: body.voice_name.trim(), postpaid: !existing,
  }
  const audio = parseDataUri(body.clone_audio) ?? await input.runtime.media.read(body.clone_audio)
  if (!audio.bytes.length || audio.bytes.length > MAX_AUDIO_BYTES) throw new AiRuntimeError('invalid_media', '声音样本必须非空且不超过 10 MB')
  const formats: Record<string, string> = { 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav', 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac' }
  const format = formats[audio.mimeType]
  if (!format) throw new AiRuntimeError('invalid_media', '请上传 WAV、MP3、OGG、M4A 或 AAC 音频')
  const payload: JsonObject = {
    ...speakerBody(identity), audio: { data: toBase64(audio.bytes), format },
    language: body.language ?? 0, extra_params: body.extra_params ?? {},
    ...(typeof body.text === 'string' && body.text.trim() ? { text: body.text } : {}),
  }
  // Existing slots are never overwritten blindly (activation makes training unavailable).
  if (existing) {
    const current = await request(input, '/api/v3/tts/get_voice', speakerBody(identity))
    if (current.speaker_id !== existing || ![0, 1, 2, 3, 4].includes(current.status as number)) {
      throw new AiRuntimeError('invalid_response', '无法确认已有音色的训练状态')
    }
    if (current.status === 4 || current.status === 1 || current.available_training_times === 0) {
      throw new AiRuntimeError('invalid_request', '该音色已锁定、正在训练或没有剩余训练次数，请选择其他音色')
    }
  }
  try {
    return parseResult(await request(input, '/api/v3/tts/voice_clone', payload), identity)
  } catch (error) {
    // A connection loss after sending is ambiguous. Keep a queryable identity;
    // never send a second training request to guess whether the first succeeded.
    if (error instanceof AiRuntimeError && error.code === 'provider_network_error' && error.details?.submissionState === 'unknown') {
      return { status: 'pending', url: '', taskId: taskId(identity), metadata: {
        submissionUnconfirmed: true,
        clonedVoice: { id: identity.speaker, name: identity.name, status: 'training', postpaid: identity.postpaid, activated: false },
      } }
    }
    throw error
  }
}

export async function pollVoiceClone(input: ProviderContinuePollingInput): Promise<ProviderExecutionResult> {
  const identity = decodeTask(input.taskId)
  return pollUntilResult(input, async () => {
    const result = parseResult(await request(input, '/api/v3/tts/get_voice', speakerBody(identity)), identity)
    return result.status === 'pending' ? undefined : result
  })
}
