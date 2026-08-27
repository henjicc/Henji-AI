import { toDataUri } from '../base64'
import { createGenerationPreprocessor } from './factory'

export const strategy = {
  rewrite: async ({ prepared }) => toDataUri(prepared.bytes, prepared.mimeType),
} satisfies import('../preprocess-core').ProviderPreprocessStrategy

export const preprocess = createGenerationPreprocessor(strategy)
