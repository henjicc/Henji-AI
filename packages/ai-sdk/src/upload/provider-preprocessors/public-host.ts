import { uploadToPublicHost } from '../public-host-upload'
import { createGenerationPreprocessor } from './factory'

/** 供应商完全不收本地文件（魔搭等）：一律经通用文件上传服务转成公网地址。 */
export const strategy = {
  rewrite: async (input) => await uploadToPublicHost(input, input.providerId === 'modelscope' ? '魔搭' : input.providerId),
} satisfies import('../preprocess-core').ProviderPreprocessStrategy

export const preprocess = createGenerationPreprocessor(strategy)
