import { AiRuntimeError } from '../../runtime/AiRuntimeError'
import { uploadToKie } from '../kie-upload'
import { createGenerationPreprocessor } from './factory'

export const strategy = {
  async rewrite({ prepared, runtime, route, requestId, providerId, signal }) {
    const apiKey = await runtime.credentials.get('generation', 'kie')
    if (!apiKey) {
      throw new AiRuntimeError('missing_api_key', 'KIE 本地文件必须先上传，请先在设置中配置 KIE API Key。')
    }
    const context = { route, mimeType: prepared.mimeType, bytes: prepared.bytes.byteLength }
    runtime.logger.info('开始上传 KIE 本地文件', {
      event: 'ai_runtime.upload.kie_started', requestId, providerId, context,
    })
    try {
      const url = await uploadToKie(apiKey, prepared, runtime.transport, signal)
      runtime.logger.info('KIE 本地文件上传完成', {
        event: 'ai_runtime.upload.kie_completed', requestId, providerId, context,
      })
      return url
    } catch (error) {
      if (signal?.aborted || (error instanceof AiRuntimeError && error.code === 'cancelled') || (error instanceof Error && error.name === 'AbortError')) {
        runtime.logger.info('KIE 本地文件上传已取消', {
          event: 'ai_runtime.upload.kie_cancelled', requestId, providerId, context,
        })
        throw new AiRuntimeError('cancelled', 'KIE upload cancelled')
      }
      runtime.logger.error('KIE 本地文件上传失败', {
        event: 'ai_runtime.upload.kie_failed', requestId, providerId, context, error,
      })
      throw error
    }
  },
} satisfies import('../preprocess-core').ProviderPreprocessStrategy

export const preprocess = createGenerationPreprocessor(strategy)
