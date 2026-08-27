import { AiRuntimeError } from '../../runtime/AiRuntimeError'
import { uploadToApiMart } from '../apimart-upload'
import { createGenerationPreprocessor } from './factory'

export const strategy = {
  async rewrite({ mediaKind, prepared, runtime, route, requestId }) {
    if (mediaKind !== 'image') {
      throw new AiRuntimeError(
        'public_media_url_required',
        `APIMart 没有通用的${mediaKind === 'video' ? '视频' : (mediaKind === 'audio' ? '音频' : '文件')}上传端点。`
      )
    }
    const apiKey = await runtime.credentials.get('generation', 'apimart')
    if (!apiKey) {
      throw new AiRuntimeError(
        'missing_api_key',
        'APIMart 本地图片必须先上传，请先在设置中配置 APIMart API Key。'
      )
    }
    const context = { route, mimeType: prepared.mimeType, bytes: prepared.bytes.byteLength }
    runtime.logger.info('开始上传 APIMart 本地图片', {
      event: 'ai_runtime.upload.apimart_started',
      requestId,
      providerId: 'apimart',
      context,
    })
    try {
      const url = await uploadToApiMart(apiKey, prepared, runtime.transport)
      runtime.logger.info('APIMart 本地图片上传完成', {
        event: 'ai_runtime.upload.apimart_completed',
        requestId,
        providerId: 'apimart',
        context,
      })
      return url
    } catch (error) {
      runtime.logger.error('APIMart 本地图片上传失败', {
        event: 'ai_runtime.upload.apimart_failed',
        requestId,
        providerId: 'apimart',
        context,
        error,
      })
      throw error
    }
  },
} satisfies import('../preprocess-core').ProviderPreprocessStrategy

export const preprocess = createGenerationPreprocessor(strategy)
