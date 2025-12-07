import { GenerateAudioParams } from '@/adapters/base/BaseAdapter'

/**
 * Minimax Speech 2.6 模型路由
 */
export const minimaxSpeech26Route = {
  // 模型ID识别
  matches: (modelId: string) =>
    modelId === 'minimax-speech-2.6' ||
    modelId === 'minimax-speech-2.6-hd' ||
    modelId === 'minimax-speech-2.6-turbo',

  // 构建音频生成请求
  buildAudioRequest: (params: GenerateAudioParams) => {
    let endpoint = ''

    if (params.model === 'minimax-speech-2.6') {
      const spec = (params.minimaxAudioSpec === 'turbo') ? 'turbo' : 'hd'
      endpoint = spec === 'turbo' ? '/minimax-speech-2.6-turbo' : '/minimax-speech-2.6-hd'
    } else if (params.model === 'minimax-speech-2.6-hd') {
      endpoint = '/minimax-speech-2.6-hd'
    } else if (params.model === 'minimax-speech-2.6-turbo') {
      endpoint = '/minimax-speech-2.6-turbo'
    } else {
      throw new Error(`Unsupported audio model: ${params.model}`)
    }

    const requestData: any = {
      text: params.text,
      output_format: params.output_format || 'url'
    }

    if (params.stream !== undefined) {
      requestData.stream = params.stream
    }
    if (params.stream_options) {
      requestData.stream_options = params.stream_options
    }

    // 构建 voice_setting
    const voice_setting: any = {}
    if (params.minimaxVoiceId) voice_setting.voice_id = params.minimaxVoiceId
    if (params.minimaxAudioSpeed !== undefined) voice_setting.speed = params.minimaxAudioSpeed
    if (params.minimaxAudioVol !== undefined) voice_setting.vol = params.minimaxAudioVol
    if (params.minimaxAudioPitch !== undefined) voice_setting.pitch = params.minimaxAudioPitch
    if (params.minimaxAudioEmotion) voice_setting.emotion = params.minimaxAudioEmotion
    if (params.minimaxLatexRead !== undefined) voice_setting.latex_read = params.minimaxLatexRead
    if (params.minimaxTextNormalization !== undefined) voice_setting.text_normalization = params.minimaxTextNormalization
    if (Object.keys(voice_setting).length > 0) {
      requestData.voice_setting = voice_setting
    }

    // 构建 audio_setting
    const audio_setting: any = {}
    if (params.minimaxAudioSampleRate !== undefined) audio_setting.sample_rate = params.minimaxAudioSampleRate
    if (params.minimaxAudioBitrate !== undefined) audio_setting.bitrate = params.minimaxAudioBitrate
    if (params.minimaxAudioFormat) audio_setting.format = params.minimaxAudioFormat
    if (params.minimaxAudioChannel !== undefined) audio_setting.channel = params.minimaxAudioChannel
    if (Object.keys(audio_setting).length > 0) {
      requestData.audio_setting = audio_setting
    }

    // 其他参数
    if (params.pronunciation_dict) {
      requestData.pronunciation_dict = params.pronunciation_dict
    }
    if (params.timbre_weights) {
      requestData.timbre_weights = params.timbre_weights
    }
    if (params.minimaxLanguageBoost) {
      requestData.language_boost = params.minimaxLanguageBoost
    }
    if (params.voice_modify) {
      requestData.voice_modify = params.voice_modify
    }

    return { endpoint, requestData }
  }
}
