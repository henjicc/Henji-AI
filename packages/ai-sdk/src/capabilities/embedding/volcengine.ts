import { embeddingModule } from '../retrieval/module'
import type { RetrievalModuleConfig } from '../retrieval/types'

/** Text-only entry: one text per call, so Ark never fuses independent documents. */
export const volcengineEmbeddingPresets = { 'doubao-embedding-vision-251215': { modelId: 'doubao-embedding-vision-251215', maxBatchSize: 1, dimensions: [1024, 2048] } } as const

export function createVolcengineEmbeddingModule(config: RetrievalModuleConfig = {}) {
  return embeddingModule(volcengineEmbeddingPresets['doubao-embedding-vision-251215'], { providerId: 'volcengine', baseUrl: 'https://ark.cn-beijing.volces.com', path: '/api/v3/embeddings/multimodal', envelope: 'ark-single' }, config)
}
