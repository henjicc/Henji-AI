import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createSiliconflowChatRequest, discoverSiliconflowModels, runSiliconflowChatStream, SILICONFLOW_PROVIDER_PRESET } from '../../src/llm/siliconflow'
import { createModelsFromPreset, createProviderFromPreset, findLlmProviderPreset } from '../../src/llm/providerPresets'
import { discoverModels } from '../../src/llm/discovery'
import { buildOpenAiCompatiblePayload } from '../../src/llm/streaming'
import { applyProviderReasoningRequestBody } from '../../src/llm/providerReasoningRequest'
import type { RuntimeContext } from '../../src/runtime'
import { runModelStep } from '../../src/llm/sdk/runtime'

const fixture = JSON.parse(readFileSync(path.resolve(__dirname, '../fixtures/siliconflow/llm.json'), 'utf8')) as {
  models: { data: Array<{ id: string }> }
  firstChunk: unknown
  continuation: unknown[]
  tools: unknown[]
}
function runtime(fetch: RuntimeContext['transport']['fetch'], key = 'fixture-key'): RuntimeContext {
  return { transport: { fetch }, credentials: { get: vi.fn(() => key) }, media: { read: async () => { throw new Error('unused') } } }
}
function sse(chunks: unknown[]) {
  return new Response([...chunks.map(chunk => `data: ${JSON.stringify(chunk)}`), 'data: [DONE]'].join('\n\n') + '\n\n', {
    headers: { 'Content-Type': 'text/event-stream' },
  })
}

describe('SiliconFlow LLM and model discovery', () => {
  it('模型步骤通过独立实例保留硅基流动协议与思考字段', async () => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => sse([fixture.firstChunk, ...fixture.continuation]))
    const request = createSiliconflowChatRequest({ providerId: 'my-sf', messages: [] })
    const result = await runModelStep({
      requestId: 'sf-step', runId: 'sf-run', stepId: 'sf-step',
      providerId: request.providerId, providerFamilyId: request.providerFamilyId,
      modelId: request.modelId, adapter: request.adapter, apiProtocol: 'openai-compatible',
      baseUrl: request.baseUrl, capabilities: request.capabilities!, reasoning: request.reasoning,
      messages: [{ role: 'user', content: 'fixture' }], output: { mode: 'text' }, settings: { maxRetries: 0 },
    }, () => undefined, runtime(fetch))
    expect(result.text).toBe('完成')
    const body = JSON.parse(String(fetch.mock.calls[0][1]?.body)) as Record<string, unknown>
    expect(body).toMatchObject({ enable_thinking: true, reasoning_effort: 'high' })
    expect(body).not.toHaveProperty('thinking')
  })
  it('预设支持四个模型、独立实例保留协议族，官方 DeepSeek 默认不变', () => {
    const provider = createProviderFromPreset(SILICONFLOW_PROVIDER_PRESET, { providerId: 'my-siliconflow' })
    expect(provider).toMatchObject({ providerId: 'my-siliconflow', providerFamilyId: 'siliconflow', credentialId: 'my-siliconflow' })
    const models = createModelsFromPreset(SILICONFLOW_PROVIDER_PRESET, provider)
    expect(models.map(m => m.modelId)).toEqual(['deepseek-ai/DeepSeek-V4-Flash', 'zai-org/GLM-5.3', 'moonshotai/Kimi-K2.7-Code', 'Qwen/Qwen3.8-27B'])
    expect(models.every(m => m.apiProtocol === 'openai-compatible' && m.capabilities.toolCall)).toBe(true)
    expect(models[1].capabilities).toMatchObject({ maxOutputTokens: null, sampling: true, image: false })
    expect(models[2].capabilities).toMatchObject({ image: true, video: false, contextWindow: 262_144 })
    expect(findLlmProviderPreset('deepseek')?.modelIds).toEqual(['deepseek-flash'])
  })

  it.each(SILICONFLOW_PROVIDER_PRESET.modelIds)('准确构建 %s 思考开关，不把原厂字段带给网关', modelId => {
    const payload = buildOpenAiCompatiblePayload(createSiliconflowChatRequest({ modelId, messages: [], reasoning: { enabled: true, effort: 'xhigh' } }))
    expect(payload).toMatchObject({ model: modelId, enable_thinking: true, stream: true })
    expect(payload).not.toHaveProperty('thinking')
    if (modelId === 'deepseek-ai/DeepSeek-V4-Flash') expect(payload.reasoning_effort).toBe('max')
    else expect(payload).not.toHaveProperty('reasoning_effort')
    const off = applyProviderReasoningRequestBody('siliconflow', 'openai', { ...payload, thinking: { type: 'enabled' }, reasoning_effort: 'max' }, { enabled: false, effort: 'max' })
    expect(off.enable_thinking).toBe(false)
    expect(off).not.toHaveProperty('reasoning_effort')
    expect(off).not.toHaveProperty('thinking')
  })

  it.each([['chat', 'llm'], ['embedding', 'embedding'], ['reranker', 'rerank']] as const)('通过官方 %s 筛选并读取 %s 凭据', async (modelType, scope) => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(fixture.models)))
    const ctx = runtime(fetch)
    const models = await discoverSiliconflowModels(ctx, { modelType, credentialId: 'separate-key' })
    expect(fetch.mock.calls[0][0]).toBe(`https://api.siliconflow.cn/v1/models?sub_type=${modelType}`)
    expect(ctx.credentials.get).toHaveBeenCalledWith(scope, 'separate-key')
    expect(new Headers(fetch.mock.calls[0][1]?.headers).get('Authorization')).toBe('Bearer fixture-key')
    expect(models[0]).toMatchObject({ modelId: fixture.models.data[0].id, contextWindow: null, maxOutputTokens: null })
  })

  it('通用发现入口也默认只取聊天；新模型不被预设白名单过滤', async () => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ data: [{ id: 'new-vendor/Future-Model' }] })))
    expect((await discoverModels('siliconflow', 'https://api.siliconflow.cn', runtime(fetch)))[0].modelId).toBe('new-vendor/Future-Model')
    expect(fetch.mock.calls[0][0]).toBe('https://api.siliconflow.cn/v1/models?sub_type=chat')
    expect(createSiliconflowChatRequest({ modelId: 'new-vendor/Future-Model', messages: [] }).capabilities).toBeUndefined()
  })

  it.each([null, {}, { data: null }, { data: 'invalid' }, { code: 20012, message: 'synthetic-negative' }])('synthetic-negative: 错误响应不伪装为空列表 %j', async response => {
    await expect(discoverSiliconflowModels(runtime(async () => new Response(JSON.stringify(response))))).rejects.toThrow('data')
  })

  it('合法空列表、无效单项与缺凭据分别处理', async () => {
    expect(await discoverSiliconflowModels(runtime(async () => new Response('{"data":[]}')))).toEqual([])
    expect(await discoverSiliconflowModels(runtime(async () => new Response('{"data":[null,{},42,{"id":"new-model"}]}')))).toHaveLength(1)
    const fetch = vi.fn(async () => new Response('{}'))
    await expect(discoverSiliconflowModels(runtime(fetch, ''))).rejects.toThrow('api_key_missing')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('官方空首帧合法，后续正文、思考、用量均由共享 SSE 内核解析', async () => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => sse([fixture.firstChunk, ...fixture.continuation]))
    const result = await runSiliconflowChatStream({ messages: [{ role: 'user', content: 'fixture' }] }, 'sf-stream', () => undefined, runtime(fetch))
    expect(fetch).toHaveBeenCalledOnce()
    expect(fetch.mock.calls[0][0]).toBe('https://api.siliconflow.cn/v1/chat/completions')
    expect(result).toMatchObject({ output: '完成', reasoningOutput: '分析', finishReason: 'stop', usage: { inputTokens: 15, outputTokens: 4, totalTokens: 19, reasoningTokens: 2 } })
  })

  it('工具参数增量保持原始身份与完整 JSON', async () => {
    const result = await runSiliconflowChatStream({ messages: [] }, 'sf-tools', () => undefined, runtime(async () => sse([fixture.firstChunk, ...fixture.tools])))
    expect(result.finishReason).toBe('tool_calls')
    expect(result.toolCalls).toEqual([expect.objectContaining({ id: 'fixture-tool', function: { name: 'get_current_weather', arguments: '{"location":"Boston, MA"}' } })])
  })

  it.each([401, 429, 503])('HTTP %s 不重试或泄漏密钥', async status => {
    const fetch = vi.fn(async () => new Response('Forbidden', { status }))
    await expect(runSiliconflowChatStream({ messages: [] }, `sf-error-${status}`, () => undefined, runtime(fetch))).rejects.toThrow()
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('发现超时与取消下沉至唯一 transport，结束后移除监听', async () => {
    const fetch = vi.fn(async (_url: string, init?: RequestInit): Promise<Response> => new Promise((_resolve, reject) => {
      if (init?.signal?.aborted) reject(new DOMException('aborted', 'AbortError'))
      else init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
    }))
    await expect(discoverSiliconflowModels(runtime(fetch), { timeoutMs: 5 })).rejects.toThrow('超时')
    const controller = new AbortController()
    const remove = vi.spyOn(controller.signal, 'removeEventListener')
    const pending = discoverSiliconflowModels(runtime(fetch), { signal: controller.signal })
    controller.abort()
    await expect(pending).rejects.toThrow('aborted')
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
  })
})
