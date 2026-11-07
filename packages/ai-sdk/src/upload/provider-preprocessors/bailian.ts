import { AiRuntimeError } from '../../runtime/AiRuntimeError'
import { getPointer } from '../../providers/helpers'
import { toDataUri } from '../base64'
import { uploadBytesToBailianOss } from '../bailian-oss-upload'
import { createGenerationPreprocessor } from './factory'

/**
 * 百炼图片收 Data URI；视频、音频只收公网 URL 或 oss://，本地文件传到百炼免费临时存储。
 * 上传凭证按模型签发，所以从请求体的 model 申请；带 oss:// 的请求由供应商层加上解析头。
 */
export const strategy = {
  async rewrite(input) {
    if (input.mediaKind === 'image') return toDataUri(input.prepared.bytes, input.prepared.mimeType)
    const apiKey = await input.runtime.credentials.get('generation', 'bailian')
    if (!apiKey) throw new AiRuntimeError('missing_api_key', '百炼本地视频、音频需要先上传，请先在设置中配置百炼 API Key。')
    const modelId = getPointer(input.requestBody, '/model')
    if (typeof modelId !== 'string' || !modelId) throw new AiRuntimeError('invalid_request', '百炼请求缺少 model，无法申请上传凭证')
    const context = { route: input.route, modelId, mediaKind: input.mediaKind, bytes: input.prepared.bytes.byteLength }
    input.runtime.logger.info('百炼临时存储上传开始', {
      event: 'ai_runtime.upload.bailian_oss_started', requestId: input.requestId, providerId: 'bailian', context,
    })
    try {
      const url = await uploadBytesToBailianOss({
        transport: input.runtime.transport, apiKey, modelId,
        objectName: `${input.requestId ?? 'henji'}-${Date.now()}-${input.prepared.filename}`,
        bytes: input.prepared.bytes, mimeType: input.prepared.mimeType, filename: input.prepared.filename, signal: input.signal,
      })
      input.runtime.logger.info('百炼临时存储上传完成', {
        event: 'ai_runtime.upload.bailian_oss_completed', requestId: input.requestId, providerId: 'bailian', context,
      })
      return url
    } catch (error) {
      if (input.signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw new AiRuntimeError('cancelled', '百炼上传已取消')
      input.runtime.logger.error('百炼临时存储上传失败', {
        event: 'ai_runtime.upload.bailian_oss_failed', requestId: input.requestId, providerId: 'bailian', context, error,
      })
      throw error
    }
  },
} satisfies import('../preprocess-core').ProviderPreprocessStrategy

export const preprocess = createGenerationPreprocessor(strategy)
