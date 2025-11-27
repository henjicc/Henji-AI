import { AudioResult } from '@/adapters/base/BaseAdapter'

/**
 * 解析派欧云音频响应
 */
export const parseAudioResponse = async (
  responseData: any
): Promise<AudioResult> => {
  // MiniMax Speech 2.6 返回格式: { audio: "url", extra_info: {...} }
  if (responseData.audio) {
    return {
      url: responseData.audio
    }
  }

  // 其他音频模型可能的格式: { audios: [{audio_url: "url"}] }
  if (responseData.audios && responseData.audios.length > 0) {
    return {
      url: responseData.audios[0].audio_url
    }
  }

  throw new Error('No audio returned from API')
}
