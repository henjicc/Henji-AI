import { describe, expect, it, vi } from 'vitest'
import { createCapabilityClient } from '../src/capabilities'
import { createModelCapabilityDiscovery } from '../src/discovery'
import { createBailianEmbeddingModule } from '../src/capabilities/embedding/bailian'
import { createSiliconflowEmbeddingModule } from '../src/capabilities/embedding/siliconflow'
import { createPpioEmbeddingModule } from '../src/capabilities/embedding/ppio'
import { createBigmodelEmbeddingModule } from '../src/capabilities/embedding/bigmodel'
import { createVolcengineEmbeddingModule } from '../src/capabilities/embedding/volcengine'
import { createBailianRerankModule } from '../src/capabilities/rerank/bailian'
import { createSiliconflowRerankModule } from '../src/capabilities/rerank/siliconflow'
import { createPpioRerankModule } from '../src/capabilities/rerank/ppio'
import { createBigmodelRerankModule } from '../src/capabilities/rerank/bigmodel'
import type { EmbeddingInput, EmbeddingModule, RerankModule } from '../src/capabilities/retrieval/types'

// Field-table fixtures, captured 2026-09-11. Small vectors and text are constructed,
// not real paid responses. Each provider's precise source is paired with its case.
const embeddingCases: [EmbeddingModule, string, string][] = [
  [createSiliconflowEmbeddingModule(), 'https://api.siliconflow.cn/v1/embeddings', 'https://api-docs.siliconflow.cn/docs/api/embeddings-post'],
  [createBailianEmbeddingModule({ baseUrl: 'https://workspace.example' }), 'https://workspace.example/compatible-mode/v1/embeddings', 'https://help.aliyun.com/en/model-studio/text-embedding-synchronous-api'],
  [createPpioEmbeddingModule(), 'https://api.ppio.com/openai/v1/embeddings', 'https://ppio.com/docs/models/reference-llm-create-embeddings.md'],
  [createBigmodelEmbeddingModule(), 'https://open.bigmodel.cn/api/paas/v4/embeddings', 'https://docs.bigmodel.cn/api-reference/模型-api/文本嵌入'],
]
// Rerank field-table sources (2026-09-11):
// https://api-docs.siliconflow.cn/docs/api/rerank-post
// https://ppio.com/docs/models/reference-llm-create-rerank
// https://docs.bigmodel.cn/api-reference/模型-api/文本重排序
// https://help.aliyun.com/en/model-studio/text-rerank-api
const rerankCases: [RerankModule, string, boolean][] = [
  [createSiliconflowRerankModule(), 'https://api.siliconflow.cn/v1/rerank', false],
  [createPpioRerankModule(), 'https://api.ppio.com/openai/v1/rerank', false],
  [createBigmodelRerankModule(), 'https://open.bigmodel.cn/api/paas/v4/rerank', false],
  [createBailianRerankModule({ baseUrl: 'https://workspace.example' }), 'https://workspace.example/api/v1/services/rerank/text-rerank/text-rerank', true],
  [createBailianRerankModule({ baseUrl: 'https://workspace.example', model: 'qwen3-rerank' }), 'https://workspace.example/compatible-api/v1/reranks', false],
  [createBailianRerankModule({ baseUrl: 'https://workspace.example', model: 'gte-rerank-v2' }), 'https://workspace.example/api/v1/services/rerank/text-rerank/text-rerank', true],
]

function harness(payload: unknown, status = 200) {
  const fetch = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify(payload), { status }))
  const get = vi.fn(async () => 'test-key')
  const client = createCapabilityClient({ runtime: { transport: { fetch }, credentials: { get }, media: { read: async () => { throw new Error('unused') } } } })
  return { client, fetch, get }
}

describe('retrieval capability provider contracts', () => {
  it.each(embeddingCases)('preserves independent vectors and exact endpoint: %s', async (module, endpoint) => {
    const h = harness({ data: [{ index: 1, embedding: [0, 1] }, { index: 0, embedding: [1, 0] }], usage: { prompt_tokens: 4, total_tokens: 4 } })
    const result = await h.client.register(module).execute({ texts: ['first', 'second'] })
    expect(result).toEqual({ embeddings: [{ index: 0, vector: [1, 0] }, { index: 1, vector: [0, 1] }], usage: { inputTokens: 4, totalTokens: 4 } })
    expect(h.fetch.mock.calls[0][0]).toBe(endpoint)
    expect(JSON.parse(String(h.fetch.mock.calls[0][1]?.body))).toEqual({ model: module.descriptor.modelId, input: ['first', 'second'], ...(module.descriptor.providerIds?.[0] === 'bigmodel' ? {} : { encoding_format: 'float' }) })
    expect(h.get).toHaveBeenCalledWith('embedding', module.descriptor.providerIds?.[0])
    await h.client.dispose()
  })

  // Official literal response: https://help.aliyun.com/en/model-studio/text-rerank-api
  // captured 2026-09-11; no substitutions. This is an HTTP terminal response.
  const officialBailian = { output: { results: [{ index: 0, relevance_score: 0.9334521178273196 }, { index: 2, relevance_score: 0.34100082626411193 }] }, usage: { prompt_tokens: 79, total_tokens: 79 }, request_id: '85ba5752-1900-47d2-8896-23f99b13f6e1' }
  it('parses the unmodified Bailian official response', async () => {
    const h = harness(officialBailian)
    const output = await h.client.register(rerankCases[3][0]).execute({ query: 'query', documents: ['a', 'b', 'c'], topN: 2, instruction: 'rank' })
    expect(output.results.map(item => item.document)).toEqual(['a', 'c'])
    expect(JSON.parse(String(h.fetch.mock.calls[0][1]?.body))).toEqual({ model: 'qwen3.7-text-rerank', input: { query: 'query', documents: ['a', 'b', 'c'] }, parameters: { top_n: 2, instruct: 'rank' } })
    await h.client.dispose()
  })

  it.each(rerankCases)('normalizes rerank results without trusting echoed text: %s', async (module, endpoint, envelope) => {
    const results = [{ index: 1, relevance_score: 0.2, document: 'wrong' }, { index: 0, relevance_score: 0.9 }]
    const h = harness(envelope ? { output: { results } } : { results })
    const output = await h.client.register(module).execute({ query: 'q', documents: ['a', 'b'], topN: 99 })
    expect(output.results).toEqual([{ index: 0, score: 0.9, document: 'a' }, { index: 1, score: 0.2, document: 'b' }])
    expect(h.fetch.mock.calls[0][0]).toBe(endpoint)
    const body = JSON.parse(String(h.fetch.mock.calls[0][1]?.body))
    expect(envelope ? body.parameters : body).toMatchObject({ top_n: 2 })
    expect(JSON.stringify(body)).not.toContain('return_documents')
    await h.client.dispose()
  })

  it('Ark single-text request cannot accidentally fuse a batch', async () => {
    // Fields: https://www.volcengine.com/docs/82379/1523520 (2026-09-11).
    const h = harness({ data: { embedding: [1, 0], object: 'embedding' }, usage: { prompt_tokens: 2, total_tokens: 2 } })
    const handle = h.client.register(createVolcengineEmbeddingModule())
    expect((await handle.execute({ texts: ['hello'] })).embeddings).toEqual([{ index: 0, vector: [1, 0] }])
    expect(h.fetch.mock.calls[0][0]).toBe('https://ark.cn-beijing.volces.com/api/v3/embeddings/multimodal')
    expect(JSON.parse(String(h.fetch.mock.calls[0][1]?.body)).input).toEqual([{ type: 'text', text: 'hello' }])
    await expect(handle.execute({ texts: ['a', 'b'] })).rejects.toMatchObject({ code: 'invalid_parameter' })
    expect(h.fetch).toHaveBeenCalledTimes(1)
    await h.client.dispose()
  })

  it.each([null, {}, { texts: [] }, { texts: [''] }, { texts: ['a'], dimensions: null }, { texts: ['a'], dimensions: 3 }, { texts: ['a'], extra: true }])('synthetic-negative: rejects invalid input before HTTP %j', async input => {
    const h = harness({})
    await expect(h.client.register(createSiliconflowEmbeddingModule()).execute(input as EmbeddingInput)).rejects.toMatchObject({ code: 'invalid_parameter' })
    expect(h.fetch).not.toHaveBeenCalled()
    await h.client.dispose()
  })

  it.each([
    { data: [] }, { data: [{ embedding: [1] }] }, { data: [{ index: 2, embedding: [1] }] },
    { data: [{ index: 0, embedding: [] }] }, { data: [{ index: 0, embedding: ['1'] }] },
    { data: [{ index: 0, embedding: [1] }], usage: { total_tokens: -1 } },
  ])('synthetic-negative: rejects malformed vectors %j', async payload => {
    const h = harness(payload)
    await expect(h.client.register(createPpioEmbeddingModule()).execute({ texts: ['a'] })).rejects.toMatchObject({ code: 'invalid_response' })
    await h.client.dispose()
  })

  it.each([
    [{ index: 0, embedding: [1] }, { index: 0, embedding: [2] }],
    [{ index: 0, embedding: [1] }, { index: 1, embedding: [2, 3] }],
  ].map(data => ({ data })))('synthetic-negative: rejects duplicate indices or mixed dimensions', async ({ data }) => {
    const h = harness({ data })
    await expect(h.client.register(createPpioEmbeddingModule()).execute({ texts: ['a', 'b'] })).rejects.toMatchObject({ code: 'invalid_response' })
    await h.client.dispose()
  })

  it.each([[], [{ index: 3, relevance_score: 0.9 }], [{ index: 0 }], [{ index: 0, relevance_score: '0.1' }], [{ index: 0, relevance_score: 1 }, { index: 0, relevance_score: 0 }]].map(results => ({ results })))('synthetic-negative: rejects malformed rankings %j', async ({ results }) => {
    const h = harness({ results })
    await expect(h.client.register(createPpioRerankModule()).execute({ query: 'q', documents: ['a', 'b'] })).rejects.toMatchObject({ code: 'invalid_response' })
    await h.client.dispose()
  })

  it.each([401, 429, 500])('does not retry HTTP %i or expose provider echoes', async status => {
    const h = harness({ message: 'secret source content' }, status)
    await expect(h.client.register(createPpioEmbeddingModule()).execute({ texts: ['a'] })).rejects.toThrow(`HTTP ${status}`)
    expect(h.fetch).toHaveBeenCalledTimes(1)
    await h.client.dispose()
  })

  it('handles cancellation, missing credentials and discovery through the public client', async () => {
    const h = harness({})
    const module = createPpioEmbeddingModule({ credentialId: 'account-two' })
    const handle = h.client.register(module)
    const controller = new AbortController()
    controller.abort()
    await expect(handle.execute({ texts: ['a'] }, { signal: controller.signal })).rejects.toBeDefined()
    expect(h.fetch).not.toHaveBeenCalled()
    h.get.mockResolvedValue('')
    await expect(handle.execute({ texts: ['a'] })).rejects.toMatchObject({ code: 'api_key_missing' })
    expect(h.get).toHaveBeenCalledWith('embedding', 'account-two')
    expect(createModelCapabilityDiscovery({ extensions: [module.descriptor] }).search({ operations: 'embedding' })).toHaveLength(1)
    await h.client.dispose()
  })

  it('aborts an active transport on timeout and permits the next request', async () => {
    const h = harness({ data: [{ index: 0, embedding: [1] }] })
    let signal: AbortSignal | null | undefined
    h.fetch.mockImplementationOnce(async (_url, init) => {
      signal = init?.signal
      return new Promise<Response>((_resolve, reject) => signal?.addEventListener('abort', () => reject(signal?.reason), { once: true }))
    })
    const handle = h.client.register(createPpioEmbeddingModule())
    await expect(handle.execute({ texts: ['a'] }, { timeoutMs: 10 })).rejects.toBeDefined()
    expect(signal?.aborted).toBe(true)
    await expect(handle.execute({ texts: ['b'] })).resolves.toMatchObject({ embeddings: [{ index: 0, vector: [1] }] })
    await h.client.dispose()
  })

  it.each([{ error: { message: 'private text' } }, { code: 'InvalidApiKey', message: 'private text' }])('rejects provider error envelopes without leaking text', async payload => {
    const h = harness(payload)
    await expect(h.client.register(createPpioEmbeddingModule()).execute({ texts: ['a'] })).rejects.toMatchObject({ code: 'provider_error' })
    await h.client.dispose()
  })

  it('rejects invalid JSON and requested-dimension mismatch', async () => {
    const h = harness({ data: [{ index: 0, embedding: [1] }] })
    const handle = h.client.register(createSiliconflowEmbeddingModule())
    await expect(handle.execute({ texts: ['a'], dimensions: 64 })).rejects.toMatchObject({ code: 'invalid_response' })
    h.fetch.mockResolvedValueOnce(new Response('not JSON'))
    await expect(handle.execute({ texts: ['a'] })).rejects.toMatchObject({ code: 'invalid_response' })
    await h.client.dispose()
  })

  it('rejects unsupported instructions and vendor batch limits before HTTP', async () => {
    const h = harness({})
    await expect(h.client.register(createBigmodelRerankModule()).execute({ query: 'q', documents: ['a'], instruction: 'x' })).rejects.toMatchObject({ code: 'invalid_parameter' })
    await expect(h.client.register(createBigmodelEmbeddingModule()).execute({ texts: Array(65).fill('a') })).rejects.toMatchObject({ code: 'invalid_parameter' })
    expect(h.fetch).not.toHaveBeenCalled()
    await h.client.dispose()
  })
})
