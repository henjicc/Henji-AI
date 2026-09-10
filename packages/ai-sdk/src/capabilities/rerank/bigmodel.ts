import { rerankModule } from '../retrieval/module'
import type { RetrievalModuleConfig } from '../retrieval/types'

export const bigmodelRerankPresets = { rerank: { modelId: 'rerank', maxDocuments: 128, maxTextCharacters: 4096 } } as const

export function createBigmodelRerankModule(config: RetrievalModuleConfig = {}) {
  return rerankModule(bigmodelRerankPresets.rerank, { providerId: 'bigmodel', baseUrl: 'https://open.bigmodel.cn', path: '/api/paas/v4/rerank' }, config)
}
