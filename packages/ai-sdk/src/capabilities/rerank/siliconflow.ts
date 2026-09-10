import { rerankModule } from '../retrieval/module'
import type { RerankPreset, RetrievalModuleConfig } from '../retrieval/types'

export const siliconflowRerankPresets = {
  'Qwen/Qwen3-Reranker-8B': { modelId: 'Qwen/Qwen3-Reranker-8B', instructionField: 'instruction' },
  'Qwen/Qwen3-Reranker-4B': { modelId: 'Qwen/Qwen3-Reranker-4B', instructionField: 'instruction' },
  'Qwen/Qwen3-Reranker-0.6B': { modelId: 'Qwen/Qwen3-Reranker-0.6B', instructionField: 'instruction' },
  'BAAI/bge-reranker-v2-m3': { modelId: 'BAAI/bge-reranker-v2-m3' },
} as const satisfies Record<string, RerankPreset>

export function createSiliconflowRerankModule(config: RetrievalModuleConfig & { model?: keyof typeof siliconflowRerankPresets } = {}) {
  return rerankModule(siliconflowRerankPresets[config.model ?? 'Qwen/Qwen3-Reranker-8B'], { providerId: 'siliconflow', baseUrl: 'https://api.siliconflow.cn', path: '/v1/rerank' }, config)
}
