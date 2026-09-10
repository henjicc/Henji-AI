import { embeddingModule } from '../retrieval/module'
import type { EmbeddingPreset, RetrievalModuleConfig } from '../retrieval/types'

export const bailianEmbeddingPresets = {
  'qwen3.7-text-embedding': { modelId: 'qwen3.7-text-embedding', maxBatchSize: 20, dimensions: [256, 512, 768, 1024, 1536, 2048, 2560] },
  'qwen3.7-text-embedding-flash': { modelId: 'qwen3.7-text-embedding-flash', maxBatchSize: 20, dimensions: [256, 512, 768, 1024] },
  'text-embedding-v4': { modelId: 'text-embedding-v4', maxBatchSize: 10, dimensions: [64, 128, 256, 512, 768, 1024, 1536, 2048] },
} as const satisfies Record<string, EmbeddingPreset>

/** baseUrl is the actual workspace/region API root, without the endpoint path. */
export function createBailianEmbeddingModule(config: RetrievalModuleConfig & { baseUrl: string; model?: keyof typeof bailianEmbeddingPresets }) {
  return embeddingModule(bailianEmbeddingPresets[config.model ?? 'qwen3.7-text-embedding'], { providerId: 'bailian', path: '/compatible-mode/v1/embeddings' }, config)
}
