import { rerankModule } from '../retrieval/module'
import type { RetrievalModuleConfig } from '../retrieval/types'

export const ppioRerankPresets = { 'baai/bge-reranker-v2-m3': { modelId: 'baai/bge-reranker-v2-m3' } } as const

export function createPpioRerankModule(config: RetrievalModuleConfig = {}) {
  return rerankModule(ppioRerankPresets['baai/bge-reranker-v2-m3'], { providerId: 'ppio', baseUrl: 'https://api.ppio.com', path: '/openai/v1/rerank' }, config)
}
