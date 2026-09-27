import { defineModel } from '../defineModel'
import type { JsonObject } from '../../types/runtime'
import { speechCharacterPrice, speechString, speechText } from '../audio/tts-common'

const cloning = (params: JsonObject): boolean => params.volcIclMode === 'clone'
const synth = (params: JsonObject): boolean => !cloning(params)
export const VOLC_CLONE_LANGUAGES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 19, 20, 21]

export const volcengineSeedIcl20Model = defineModel({
  meta: {
    id: 'volcengine-seed-icl-2.0', canonicalModelId: 'seed-icl-2.0', provider: 'volcengine-speech', type: 'audio',
    tags: ['text-to-audio', 'voice-clone', 'provider-volcengine'],
    polling: { interval: 3000, maxAttempts: 120 },
  },
  inputLimits: { images: { max: 0 }, videos: { max: 0 } },
  params: [
    { id: 'volcIclMode', type: 'dropdown', order: 1, default: 'speech', options: [{ value: 'speech' }, { value: 'clone' }] },
    { id: 'volcSeedIclSpeaker', type: 'composite', valueType: 'string', required: true, order: 2, default: '', visible: { condition: synth } },
    { id: 'volcIclActivationConsent', type: 'switch', order: 3, default: false, visible: { condition: p => synth(p) && Boolean(p.volcSeedIclSpeaker) && !/^S_/i.test(String(p.volcSeedIclSpeaker)) } },
    { id: 'volcCloneName', type: 'text', order: 4, default: '', maxLength: 80, required: true, visible: { condition: cloning } },
    { id: 'volcCloneAudio', type: 'file-upload', order: 5, default: [], maxCount: 1, maxSize: 10_000_000, accept: ['audio/wav', 'audio/x-wav', 'audio/mpeg', 'audio/ogg', 'audio/mp4', 'audio/x-m4a', 'audio/aac'], required: true, visible: { condition: cloning } },
    { id: 'volcCloneLanguage', type: 'dropdown', order: 6, default: 0, options: VOLC_CLONE_LANGUAGES.map(value => ({ value })), visible: { condition: cloning } },
    { id: 'volcCloneTranscript', type: 'textarea', order: 7, default: '', visible: { condition: cloning } },
    { id: 'volcCloneDenoise', type: 'switch', order: 8, default: false, visible: { condition: cloning } },
    { id: 'volcClonePreserveVolume', type: 'switch', order: 9, default: false, visible: { condition: cloning } },
    { id: 'volcCloneExistingSlot', type: 'text', order: 10, default: '', visible: { condition: cloning } },
    { id: 'volcCloneCustomId', type: 'text', order: 11, default: '', visible: { condition: () => false } },
  ],
  runtimeConstraints: { mediaFields: [{ field: 'clone_audio', kind: 'audio' }] },
  endpoints: { selector: params => cloning(params) ? '/api/v3/tts/voice_clone' : '/api/v3/tts/unidirectional' },
  request: {
    builder: (params): JsonObject => {
      if (cloning(params)) {
        const name = speechString(params.volcCloneName)
        const source = Array.isArray(params.volcCloneAudio) ? params.volcCloneAudio[0] : params.volcCloneAudio
        const audio = typeof source === 'string' ? source : source && typeof source === 'object' && !Array.isArray(source) ? source.path ?? source.url : undefined
        const demo = speechText(params).trim()
        if (!name) throw new Error('请填写音色名称')
        if (typeof audio !== 'string' || !audio) throw new Error('请上传声音样本')
        if (Array.from(demo).length < 4 || Array.from(demo).length > 300) throw new Error('克隆试听文本须为 4–300 字')
        const language = params.volcCloneLanguage ?? 0
        if (!VOLC_CLONE_LANGUAGES.includes(language as number)) throw new Error('请选择有效的录音语言')
        const custom = speechString(params.volcCloneCustomId)
        if (custom && !/^henji[a-zA-Z0-9]{8,64}$/.test(custom)) throw new Error('克隆音色代号无效')
        return {
          clone_audio: audio, voice_name: name, language,
          ...(speechString(params.volcCloneExistingSlot) ? { speaker_id: speechString(params.volcCloneExistingSlot)! } : {}),
          ...(custom ? { custom_speaker_id: custom } : {}),
          ...(speechString(params.volcCloneTranscript) ? { text: speechString(params.volcCloneTranscript)! } : {}),
          extra_params: { demo_text: demo, enable_audio_denoise: params.volcCloneDenoise === true, disable_volume_normalization: params.volcClonePreserveVolume === true },
        }
      }
      const speaker = speechString(params.volcSeedIclSpeaker)
      if (!speaker) throw new Error('Seed-ICL 2.0 需要已创建的复刻音色 ID')
      if (!/^S_/i.test(speaker) && params.volcIclActivationConsent !== true) throw new Error('后付费音色首次正式合成将收取 138 元槽位费并锁定音色，请先确认费用')
      return {
        resource_id: 'seed-icl-2.0',
        req_params: { text: speechText(params), model: 'seed-tts-2.0-standard', speaker, audio_params: { format: 'mp3', sample_rate: 24000 } },
      }
    },
  },
  pricing: { currency: '¥', calculator: params => speechCharacterPrice(params, 0.3), description: '3 元/万字符；后付费音色首次正式合成另收 138 元槽位费，训练试听按字符计费' },
})

export default volcengineSeedIcl20Model
