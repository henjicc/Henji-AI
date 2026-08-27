import { AiRuntimeError } from '../../runtime/AiRuntimeError'
import { uploadToFalWithTransport } from '../fal-transport'
import { createGenerationPreprocessor } from './factory'

export const strategy = {
  async rewrite({ prepared, runtime, route, requestId, signal }) {
    const apiKey = await runtime.credentials.get('generation', 'fal')
    if (!apiKey) {
      throw new AiRuntimeError(
        'missing_api_key',
        'Fal 本地文件必须先上传，请先在设置中配置 Fal API Key。'
      )
    }
    const context = { route, mimeType: prepared.mimeType, bytes: prepared.bytes.byteLength }
    runtime.logger.info('开始上传 Fal 本地文件', {
      event: 'ai_runtime.upload.fal_started',
      requestId,
      providerId: 'fal',
      context,
    })
    try {
      const url = await uploadToFalWithTransport(apiKey, prepared, runtime.transport, signal)
      runtime.logger.info('Fal 本地文件上传完成', {
        event: 'ai_runtime.upload.fal_completed',
        requestId,
        providerId: 'fal',
        context,
      })
      return url
    } catch (error) {
      runtime.logger.error('Fal 本地文件上传失败', {
        event: 'ai_runtime.upload.fal_failed',
        requestId,
        providerId: 'fal',
        context,
        error,
      })
      throw error
    }
  },
} satisfies import('../preprocess-core').ProviderPreprocessStrategy

export const preprocess = createGenerationPreprocessor(strategy)
