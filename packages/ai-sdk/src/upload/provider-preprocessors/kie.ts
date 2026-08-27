import { toDataUri } from '../base64'
import { uploadToKie } from '../kie-upload'
import { createGenerationPreprocessor } from './factory'

export const strategy = {
  async rewrite({ prepared, runtime }) {
    const apiKey = await runtime.credentials.get('generation', 'kie')
    if (apiKey) {
      try {
        return await uploadToKie(apiKey, prepared, runtime.transport)
      } catch {
        // 保持旧行为：KIE 托管上传失败时退回 data URI，由生成端点给出最终协议结论。
      }
    }
    return toDataUri(prepared.bytes, prepared.mimeType)
  },
} satisfies import('../preprocess-core').ProviderPreprocessStrategy

export const preprocess = createGenerationPreprocessor(strategy)
