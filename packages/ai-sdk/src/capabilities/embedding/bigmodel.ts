import { embeddingModule } from '../retrieval/module'
import type { RetrievalModuleConfig } from '../retrieval/types'

export const bigmodelEmbeddingPresets = { 'embedding-3': { modelId: 'embedding-3', maxBatchSize: 64, dimensions: [256, 512, 1024, 2048] } } as const

export function createBigmodelEmbeddingModule(config: RetrievalModuleConfig = {}) {
  return embeddingModule(bigmodelEmbeddingPresets['embedding-3'], { providerId: 'bigmodel', baseUrl: 'https://open.bigmodel.cn', path: '/api/paas/v4/embeddings', floatEncoding: false }, config)
}
