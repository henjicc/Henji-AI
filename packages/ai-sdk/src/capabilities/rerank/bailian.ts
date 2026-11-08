import { tokenUsagePrice } from '../../pricing/capabilityPricing'
import { rerankModule } from '../retrieval/module'
import type { RerankPreset, RetrievalModuleConfig } from '../retrieval/types'

/** 价格为华北2（北京）原价，按输入 token 计费。 */
export const bailianRerankPresets = {
  'qwen3.7-text-rerank': { modelId: 'qwen3.7-text-rerank', maxDocuments: 500, instructionField: 'instruct', pricing: tokenUsagePrice('CNY', 0.5, 0) },
  'qwen3-rerank': { modelId: 'qwen3-rerank', maxDocuments: 500, instructionField: 'instruct', pricing: tokenUsagePrice('CNY', 0.5, 0) },
  'gte-rerank-v2': { modelId: 'gte-rerank-v2', maxDocuments: 500, pricing: tokenUsagePrice('CNY', 0.8, 0) },
} as const satisfies Record<string, RerankPreset>

export function createBailianRerankModule(config: RetrievalModuleConfig & { baseUrl: string; model?: keyof typeof bailianRerankPresets }) {
  const model = config.model ?? 'qwen3.7-text-rerank'
  return rerankModule(bailianRerankPresets[model], {
    providerId: 'bailian',
    path: model === 'qwen3-rerank' ? '/compatible-api/v1/reranks' : '/api/v1/services/rerank/text-rerank/text-rerank',
    envelope: model === 'qwen3-rerank' ? undefined : 'bailian',
  }, config)
}
