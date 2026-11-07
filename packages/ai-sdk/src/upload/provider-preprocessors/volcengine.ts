import { toDataUri } from '../base64'
import { uploadToPublicHost } from '../public-host-upload'
import { createGenerationPreprocessor } from './factory'

/** 方舟图片、音频收 Base64；参考视频只收公网 URL，经通用文件上传服务托管。 */
export const strategy = {
  rewrite: async (input) => input.mediaKind === 'video'
    ? await uploadToPublicHost(input, '火山方舟')
    : toDataUri(input.prepared.bytes, input.prepared.mimeType),
} satisfies import('../preprocess-core').ProviderPreprocessStrategy

export const preprocess = createGenerationPreprocessor(strategy)
