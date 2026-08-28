import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import {
  BIGMODEL_CN_CREDENTIAL_ID,
  BIGMODEL_ENDPOINT_PROFILE_FAMILY,
  BIGMODEL_GLOBAL_CREDENTIAL_ID,
  BIGMODEL_GLM_5_3_FLASH_PRICING,
  createBigmodelModels,
  createBigmodelProvider,
  resolveBigmodelIdentity,
} from '../../src/llm/bigmodel/index'
import { createLlmCapabilitiesForModel } from '../../src/llm/defaults'
import { buildOpenAiCompatiblePayload, serializeMessage } from '../../src/llm/streaming'
import { runLlmChatStream } from '../../src/llm/chat'
import { discoverModels } from '../../src/llm/discovery'
import type { LlmChatRequestDto, LlmContentPart } from '../../src/llm/chatTypes'
import type { RuntimeContext } from '../../src/runtime'

interface Fixture {
  contentParts: Record<'text' | 'image' | 'video' | 'file', LlmContentPart>
  sse: string[]
}

const fixture = JSON.parse(readFileSync(
  path.resolve(__dirname, '../fixtures/bigmodel/glm-5.3-flash.json'),
  'utf8'
)) as Fixture

function sseResponse(): Response {
  return new Response(`${fixture.sse.join('\n\n')}\n\n`, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  })
}

describe('BigModel endpoint profiles', () => {
  it('保留国内默认并把 Global 分成独立配置实例、端点和凭据槽', () => {
    const cn = createBigmodelProvider()
    const global = createBigmodelProvider({ endpointProfile: 'global' })
    expect(cn).toMatchObject({
      providerId: 'bigmodel',
      providerFamilyId: 'bigmodel',
      endpointProfile: 'cn',
      credentialId: BIGMODEL_CN_CREDENTIAL_ID,
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    })
    expect(global).toMatchObject({
      providerId: 'bigmodel-global',
      providerFamilyId: 'bigmodel',
      endpointProfile: 'global',
      credentialId: BIGMODEL_GLOBAL_CREDENTIAL_ID,
      baseUrl: 'https://api.z.ai/api/paas/v4',
    })
    expect(new Set(BIGMODEL_ENDPOINT_PROFILE_FAMILY.profiles.map(item => item.defaultCredentialId)).size).toBe(2)
  })

  it('拒绝未知 profile、跨区 baseUrl 和跨区 credential', () => {
    expect(() => resolveBigmodelIdentity({
      ...createBigmodelProvider(), endpointProfile: 'global',
    })).toThrow('[llm_credential_scope_mismatch]')
    expect(() => resolveBigmodelIdentity({
      ...createBigmodelProvider(), baseUrl: 'https://api.z.ai/api/paas/v4',
    })).toThrow('[llm_endpoint_profile_mismatch]')
    expect(() => createBigmodelProvider({ endpointProfile: 'unknown' as 'cn' })).toThrow('[llm_endpoint_profile_unknown]')
    expect(resolveBigmodelIdentity({
      providerId: 'bigmodel-global', displayName: 'legacy-host-row', adapter: 'openai', enabled: true,
    })).toMatchObject({
      providerFamilyId: 'bigmodel', endpointProfile: 'global', credentialId: 'bigmodel-global',
      baseUrl: 'https://api.z.ai/api/paas/v4',
    })
  })

  it('两区都可发现 Flash，只有国内保留旧模型，价格币种与促销时限分区', () => {
    const cnModels = createBigmodelModels(createBigmodelProvider()).map(model => model.modelId)
    const globalModels = createBigmodelModels(createBigmodelProvider({ endpointProfile: 'global' })).map(model => model.modelId)
    expect(cnModels).toEqual(['glm-5.3', 'glm-5v-turbo', 'glm-5.3-flash'])
    expect(globalModels).toEqual(['glm-5.3-flash'])
    expect(BIGMODEL_GLM_5_3_FLASH_PRICING.cn.currency).toBe('CNY')
    expect(BIGMODEL_GLM_5_3_FLASH_PRICING.cn.promotion?.endsAt).toBeUndefined()
    expect(BIGMODEL_GLM_5_3_FLASH_PRICING.global).toMatchObject({ currency: 'USD' })
    expect(BIGMODEL_GLM_5_3_FLASH_PRICING.global.promotion?.endsAt).toBe('2026-09-09T16:00:00.000Z')
  })
})

describe('GLM-5.3-Flash contract', () => {
  it('只声明已确认能力，不声明 audio、并行工具或结构化输出', () => {
    expect(createLlmCapabilitiesForModel('glm-5.3-flash')).toMatchObject({
      text: true,
      image: true,
      video: true,
      audio: false,
      file: true,
      streaming: true,
      toolCall: true,
      parallelTools: false,
      structuredOutputMode: 'none',
      jsonOutput: false,
      reasoning: true,
      contextWindow: 1_000_000,
      maxOutputTokens: 131_072,
    })
  })

  it('映射宿主媒体/文件引用并拒绝 SDK 未实现的 file_id 上传边界', () => {
    expect(Object.values(fixture.contentParts).map(part => (
      serializeMessage({ role: 'user', content: [part] }).content
    ))).toEqual([
      [{ type: 'text', text: 'fixture' }],
      [{ type: 'image_url', image_url: { url: 'https://media.invalid/image.png' } }],
      [{ type: 'video_url', video_url: { url: 'https://media.invalid/video.mp4' } }],
      [{ type: 'file', file: { file_url: 'https://media.invalid/document.pdf', filename: 'document.pdf' } }],
    ])
    expect(() => serializeMessage({ role: 'user', content: [
      { type: 'file', file: { file_id: 'uploaded-elsewhere' } },
    ] })).toThrow('[unsupported_file_reference]')
    expect(() => serializeMessage({ role: 'user', content: [
      { type: 'file', file: { fileUrl: 'https://media.invalid/a.pdf', fileData: 'data:application/pdf;base64,AA==' } },
    ] })).toThrow('[invalid_file_reference]')
  })

  it('请求只发送普通工具、思考与标准 SSE 字段，不偷偷启用冲突能力', () => {
    const provider = createBigmodelProvider({ endpointProfile: 'global' })
    const payload = buildOpenAiCompatiblePayload({
      ...provider,
      modelId: 'glm-5.3-flash',
      messages: [{ role: 'user', content: [fixture.contentParts.text] }],
      capabilities: { reasoning: true },
      reasoning: { enabled: true, effort: 'max' },
      tools: [{ type: 'function', function: { name: 'lookup', parameters: { type: 'object' } } }],
    })
    expect(payload).toMatchObject({
      model: 'glm-5.3-flash',
      stream: true,
      thinking: { type: 'enabled' },
      reasoning_effort: 'max',
    })
    expect(payload).not.toHaveProperty('response_format')
    expect(payload).not.toHaveProperty('tool_stream')
  })

  it('Global 请求只读取 Global 凭据并解析空块、思考、工具分片、usage 与完成态', async () => {
    const provider = createBigmodelProvider({ endpointProfile: 'global' })
    const credentialReads: Array<[string, string]> = []
    const fetch = vi.fn(async () => sseResponse())
    const runtime: RuntimeContext = {
      transport: { fetch },
      credentials: { get: async (scope, id) => {
        credentialReads.push([scope, id])
        return id === BIGMODEL_GLOBAL_CREDENTIAL_ID ? 'global-fixture-key' : null
      } },
      media: { read: async () => { throw new Error('fixture does not read media') } },
    }
    const request: LlmChatRequestDto = {
      ...provider,
      requestId: 'bigmodel-global-fixture',
      modelId: 'glm-5.3-flash',
      messages: [{ role: 'user', content: [fixture.contentParts.text] }],
      capabilities: { reasoning: true },
      reasoning: { enabled: true, effort: 'max' },
    }
    const outcome = await runLlmChatStream(request, request.requestId!, () => undefined, runtime)
    expect(fetch).toHaveBeenCalledWith('https://api.z.ai/api/paas/v4/chat/completions', expect.any(Object))
    expect(credentialReads).toEqual([['llm', BIGMODEL_GLOBAL_CREDENTIAL_ID]])
    expect(outcome).toMatchObject({
      reasoningOutput: '分析',
      finishReason: 'tool_calls',
      usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 },
      toolCalls: [{
        index: 0,
        id: 'call_1',
        function: { name: 'lookup', arguments: '{"q":"fixture"}' },
      }],
    })
  })

  it('模型发现同样使用 profile 路由与独立凭据，不探测另一地区', async () => {
    const provider = createBigmodelProvider({ endpointProfile: 'global' })
    const reads: string[] = []
    const fetch = vi.fn(async () => new Response(JSON.stringify({
      data: [{ id: 'glm-5.3-flash', active: true }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    const runtime: RuntimeContext = {
      transport: { fetch },
      credentials: { get: async (_scope, id) => { reads.push(id); return 'global-key' } },
      media: { read: async () => { throw new Error('media unavailable') } },
    }
    await expect(discoverModels(provider.providerId, provider.baseUrl!, runtime, {
      providerFamilyId: provider.providerFamilyId,
      endpointProfile: provider.endpointProfile,
      credentialId: provider.credentialId,
      requireCredential: true,
    })).resolves.toEqual([{
      modelId: 'glm-5.3-flash', displayName: 'glm-5.3-flash', contextWindow: null, maxOutputTokens: null,
    }])
    expect(reads).toEqual(['bigmodel-global'])
    expect(fetch).toHaveBeenCalledWith('https://api.z.ai/api/paas/v4/models', expect.any(Object))
  })
})
