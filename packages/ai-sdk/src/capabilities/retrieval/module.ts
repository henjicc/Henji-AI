import type { CapabilityDescriptor, CapabilityExecutionContext } from '../types'
import { apiRoot, requestJson } from './http'
import { inputRecord, invalidInput, invalidResponse, positiveInteger, record, responseIndex, text, texts, usage } from './validation'
import type { EmbeddingModule, EmbeddingOutput, EmbeddingPreset, RerankModule, RerankOutput, RerankPreset, RetrievalModuleConfig } from './types'

interface ProviderContract {
  providerId: string
  baseUrl?: string
  path: string
  envelope?: 'bailian' | 'ark-single'
  floatEncoding?: boolean
}

function descriptor(kind: 'embedding' | 'rerank', modelId: string, providerId: string, moduleId?: string): CapabilityDescriptor {
  return {
    id: moduleId ?? `${providerId}.${kind}.${modelId}`,
    kind,
    source: { kind: 'builtin', namespace: '@henjicc/ai-sdk' },
    version: '1', providerIds: [providerId], modelId,
    contract: { input: [{ kind: 'text', required: true, multiple: true }], output: [{ kind: 'structured-data', required: true }] },
    operations: [kind], executionModes: ['request-response'],
  }
}

async function traced<T>(context: CapabilityExecutionContext, providerId: string, modelId: string, kind: string, run: () => Promise<T>): Promise<T> {
  const fields = { requestId: context.requestId, providerId, modelId }
  const span = context.runtime.tracer.startSpan(`${kind}.request`, fields)
  context.runtime.logger.info(`${kind} request started`, { ...fields, event: `${kind}.request.start` })
  try {
    const output = await run()
    context.signal.throwIfAborted()
    context.runtime.logger.info(`${kind} request completed`, { ...fields, event: `${kind}.request.completed` })
    span.end()
    return output
  } catch (error) {
    // Error details may contain provider echoes of input or credentials; log only the stage.
    context.runtime.logger.error(`${kind} request failed`, { ...fields, event: `${kind}.request.failed` })
    span.end()
    throw error
  }
}

export function embeddingModule(preset: EmbeddingPreset, provider: ProviderContract, config: RetrievalModuleConfig = {}): EmbeddingModule {
  if (!preset) invalidInput('Unknown embedding model')
  const endpoint = apiRoot(config.baseUrl ?? provider.baseUrl) + provider.path
  return {
    descriptor: descriptor('embedding', preset.modelId, provider.providerId, config.moduleId),
    execute: (input, context) => traced(context, provider.providerId, preset.modelId, 'embedding', async () => {
      const rawInput = inputRecord(input, ['texts', 'dimensions'])
      const source = texts(rawInput.texts, 'texts', preset.maxBatchSize, preset.maxTextCharacters)
      const body: Record<string, unknown> = { model: preset.modelId, input: source }
      if (provider.envelope === 'ark-single') body.input = [{ type: 'text', text: source[0] }]
      if (provider.floatEncoding !== false) body.encoding_format = 'float'
      if (rawInput.dimensions !== undefined) {
        const dimensions = positiveInteger(rawInput.dimensions, 'dimensions')
        if (!preset.dimensions?.includes(dimensions)) invalidInput('Unsupported embedding dimensions for this model')
        body.dimensions = dimensions
      }
      const raw = await requestJson(context, provider.providerId, config.credentialId ?? provider.providerId, 'embedding', endpoint, body)
      const data = provider.envelope === 'ark-single' ? [{ ...record(raw.data, 'data'), index: 0 }] : raw.data
      if (!Array.isArray(data) || data.length !== source.length) invalidResponse('Embedding result count must match the input count')
      const seen = new Set<number>()
      let dimensionCount: number | undefined
      const embeddings = data.map(value => {
        const item = record(value, 'embedding')
        const index = responseIndex(item.index, source.length, seen)
        if (!Array.isArray(item.embedding) || item.embedding.length === 0 || !item.embedding.every(n => typeof n === 'number' && Number.isFinite(n))) {
          invalidResponse('Embedding must contain a non-empty finite numeric vector')
        }
        const vector = item.embedding as number[]
        dimensionCount ??= vector.length
        if (vector.length !== dimensionCount || (rawInput.dimensions !== undefined && vector.length !== rawInput.dimensions)) invalidResponse('Embedding vector dimensions do not match')
        return { index, vector }
      }).sort((a, b) => a.index - b.index)
      return { embeddings, usage: usage(raw.usage) } satisfies EmbeddingOutput
    }),
  }
}

export function rerankModule(preset: RerankPreset, provider: ProviderContract, config: RetrievalModuleConfig = {}): RerankModule {
  if (!preset) invalidInput('Unknown rerank model')
  const endpoint = apiRoot(config.baseUrl ?? provider.baseUrl) + provider.path
  return {
    descriptor: descriptor('rerank', preset.modelId, provider.providerId, config.moduleId),
    execute: (input, context) => traced(context, provider.providerId, preset.modelId, 'rerank', async () => {
      const rawInput = inputRecord(input, ['query', 'documents', 'topN', 'instruction'])
      const query = text(rawInput.query, 'query', preset.maxTextCharacters)
      const documents = texts(rawInput.documents, 'documents', preset.maxDocuments, preset.maxTextCharacters)
      const params: Record<string, unknown> = {}
      if (rawInput.topN !== undefined) params.top_n = Math.min(positiveInteger(rawInput.topN, 'topN'), documents.length)
      if (rawInput.instruction !== undefined) {
        if (!preset.instructionField) invalidInput('Instructions are not supported by this rerank model')
        params[preset.instructionField] = text(rawInput.instruction, 'instruction')
      }
      const body = provider.envelope === 'bailian'
        ? { model: preset.modelId, input: { query, documents }, parameters: params }
        : { model: preset.modelId, query, documents, ...params }
      const raw = await requestJson(context, provider.providerId, config.credentialId ?? provider.providerId, 'rerank', endpoint, body)
      const payload = provider.envelope === 'bailian' ? record(raw.output, 'output') : raw
      if (!Array.isArray(payload.results) || payload.results.length === 0 || payload.results.length > (params.top_n as number ?? documents.length)) invalidResponse('Invalid rerank result count')
      const seen = new Set<number>()
      const results = payload.results.map(value => {
        const item = record(value, 'rerank result')
        const index = responseIndex(item.index, documents.length, seen)
        if (typeof item.relevance_score !== 'number' || !Number.isFinite(item.relevance_score)) invalidResponse('Invalid rerank score')
        return { index, score: item.relevance_score, document: documents[index] }
      }).sort((a, b) => b.score - a.score)
      const meta = raw.meta === undefined ? undefined : record(raw.meta, 'meta')
      return { results, usage: usage(raw.usage ?? meta?.tokens) } satisfies RerankOutput
    }),
  }
}
