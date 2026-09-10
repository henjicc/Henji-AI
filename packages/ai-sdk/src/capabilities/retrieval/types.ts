import type { CapabilityModule } from '../types'

export interface RetrievalUsage {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
}

export interface EmbeddingInput {
  texts: readonly string[]
  dimensions?: number
}

export interface EmbeddingOutput {
  /** Ordered by the original input index, independent of provider response order. */
  embeddings: readonly { index: number; vector: readonly number[] }[]
  usage?: RetrievalUsage
}

export interface RerankInput {
  query: string
  documents: readonly string[]
  topN?: number
  instruction?: string
}

export interface RerankOutput {
  /** Scores are comparable only within this request. */
  results: readonly { index: number; score: number; document: string }[]
  usage?: RetrievalUsage
}

export type EmbeddingModule = CapabilityModule<EmbeddingInput, EmbeddingOutput>
export type RerankModule = CapabilityModule<RerankInput, RerankOutput>

export interface RetrievalModuleConfig {
  /** Exact API root for the selected region/workspace; never changed by the SDK. */
  baseUrl?: string
  /** Separate credentials for accounts or regions, without changing provider identity. */
  credentialId?: string
  moduleId?: string
}

export interface EmbeddingPreset {
  modelId: string
  dimensions?: readonly number[]
  maxBatchSize?: number
  maxTextCharacters?: number
}

export interface RerankPreset {
  modelId: string
  maxDocuments?: number
  maxTextCharacters?: number
  instructionField?: 'instruction' | 'instruct'
}
