import { prepareMedia, multipartAudioRequest, sendMediaRequest } from '../../media-request'
import type { CapabilityExecutionContext } from '../../types'
import type { SpeechRecognitionEvent, SpeechRecognitionModule, SpeechRecognitionOutput } from '..'
import { AiRuntimeError, cancelledError } from '../../../runtime/AiRuntimeError'
import { deepSeekToolsEndpoint, readDeepSeekToolJson } from '../../deepseek/http'
import type { DeepSeekAsrPreset } from './presets'
import type { DeepSeekAsrModuleOptions } from './types'

type Context = CapabilityExecutionContext<SpeechRecognitionEvent>

const MAX_FILE_BYTES = 8 * 1024 * 1024
const SUPPORTED_MEDIA_TYPES = new Set(['audio/wav', 'audio/x-wav', 'audio/wave', 'audio/vnd.wave', 'audio/ogg', 'audio/opus'])

/** 一次请求整段识别，返回完整文本；不支持流式与时间戳，宿主需先把音频转成 16 位 PCM WAV 或 Ogg Opus。 */
export function createDeepSeekAsrModule(preset: DeepSeekAsrPreset, options: DeepSeekAsrModuleOptions = {}): SpeechRecognitionModule {
  const url = deepSeekToolsEndpoint(options.apiBaseUrl, 'asr')
  return {
    descriptor: preset.descriptor,
    execute: async (input, context: Context) => {
      if (context.signal.aborted) throw cancelledError(context.requestId)
      if (input.audio.kind === 'remote-url') {
        throw new AiRuntimeError('unsupported_media_source', 'DeepSeek 语音识别需要上传音频内容，不接受远程地址')
      }
      if (input.timestamps) throw new AiRuntimeError('unsupported_parameter', 'DeepSeek 语音识别不返回时间戳')
      const apiKey = (await context.runtime.credentials.get('speech-recognition', 'deepseek'))?.trim()
      if (!apiKey) throw new AiRuntimeError('api_key_missing', 'DeepSeek API 密钥未配置')
      const media = await prepareMedia(input.audio, context.runtime, MAX_FILE_BYTES, context.signal)
      const mediaType = media.description.mimeType.split(';')[0].trim().toLowerCase()
      if (!SUPPORTED_MEDIA_TYPES.has(mediaType)) {
        throw new AiRuntimeError('unsupported_media_type', `DeepSeek 语音识别只接受 16 位 PCM WAV 或 Ogg Opus，当前为 ${mediaType || '未知格式'}`)
      }
      const response = await sendMediaRequest(context.runtime, url, {
        method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, signal: context.signal,
      }, multipartAudioRequest(media, []))
      const payload = await readDeepSeekToolJson(response, '语音识别')
      const text = typeof payload.text === 'string' ? payload.text.trim() : ''
      if (!text) throw new AiRuntimeError('invalid_response', 'DeepSeek 语音识别没有返回文字')
      const durationMs = typeof payload.duration_ms === 'number' && Number.isFinite(payload.duration_ms) ? payload.duration_ms : undefined
      const output: SpeechRecognitionOutput = {
        text,
        ...(durationMs === undefined ? {} : { durationMs }),
        providerMetadata: { requestId: typeof payload.request_id === 'string' ? payload.request_id : undefined },
      }
      await context.emit({ type: 'final', text })
      await context.emit({ type: 'completed', output })
      return output
    },
  }
}
