import { rerankModule } from '../retrieval/module'
import type { RerankPreset, RetrievalModuleConfig } from '../retrieval/types'

export const bailianRerankPresets = {
  'qwen3.7-text-rerank': { modelId: 'qwen3.7-text-rerank', maxDocuments: 500, instructionField: 'instruct' },
  'qwen3-rerank': { modelId: 'qwen3-rerank', maxDocuments: 500, instructionField: 'instruct' },
  'gte-rerank-v2': { modelId: 'gte-rerank-v2', maxDocuments: 500 },
} as const satisfies Record<string, RerankPreset>

export function createBailianRerankModule(config: RetrievalModuleConfig & { baseUrl: string; model?: keyof typeof bailianRerankPresets }) {
  const model = config.model ?? 'qwen3.7-text-rerank'
  return rerankModule(bailianRerankPresets[model], {
    providerId: 'bailian',
    path: model === 'qwen3-rerank' ? '/compatible-api/v1/reranks' : '/api/v1/services/rerank/text-rerank/text-rerank',
    envelope: model === 'qwen3-rerank' ? undefined : 'bailian',
  }, config)
}
