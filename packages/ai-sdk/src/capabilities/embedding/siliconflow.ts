import { tokenUsagePrice } from '../../pricing/capabilityPricing'
import { embeddingModule } from '../retrieval/module'
import type { EmbeddingPreset, RetrievalModuleConfig } from '../retrieval/types'

export const siliconflowEmbeddingPresets = {
  'Qwen/Qwen3-Embedding-8B': { modelId: 'Qwen/Qwen3-Embedding-8B', dimensions: [64, 128, 256, 512, 768, 1024, 1536, 2048, 2560, 4096], pricing: tokenUsagePrice('CNY', 0.28, 0) },
  'Qwen/Qwen3-Embedding-4B': { modelId: 'Qwen/Qwen3-Embedding-4B', dimensions: [64, 128, 256, 512, 768, 1024, 1536, 2048, 2560], pricing: tokenUsagePrice('CNY', 0.14, 0) },
  'Qwen/Qwen3-Embedding-0.6B': { modelId: 'Qwen/Qwen3-Embedding-0.6B', dimensions: [64, 128, 256, 512, 768, 1024], pricing: tokenUsagePrice('CNY', 0.07, 0) },
  'BAAI/bge-m3': { modelId: 'BAAI/bge-m3', pricing: tokenUsagePrice('CNY', 0, 0) },
} as const satisfies Record<string, EmbeddingPreset>

export function createSiliconflowEmbeddingModule(config: RetrievalModuleConfig & { model?: keyof typeof siliconflowEmbeddingPresets } = {}) {
  return embeddingModule(siliconflowEmbeddingPresets[config.model ?? 'Qwen/Qwen3-Embedding-8B'], { providerId: 'siliconflow', baseUrl: 'https://api.siliconflow.cn', path: '/v1/embeddings' }, config)
}
