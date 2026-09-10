import { embeddingModule } from '../retrieval/module'
import type { RetrievalModuleConfig } from '../retrieval/types'

export const ppioEmbeddingPresets = { 'baai/bge-m3': { modelId: 'baai/bge-m3' } } as const

export function createPpioEmbeddingModule(config: RetrievalModuleConfig = {}) {
  return embeddingModule(ppioEmbeddingPresets['baai/bge-m3'], { providerId: 'ppio', baseUrl: 'https://api.ppio.com', path: '/openai/v1/embeddings' }, config)
}
