import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  catalog,
  clearCancelFlag,
  createModelCapabilityDiscovery,
  isCancelled,
  LLM_MODEL_CATALOG_ENTRIES,
  type RuntimeContext,
} from '@henjicc/ai-sdk'
import falImageEditTools from '@henjicc/ai-sdk/tool-packs/fal-image-edit-tools'

import {
  assertHenjiGenerationSelection,
  createHenjiAIClient,
  getHenjiGenerationModel,
  HENJI_GENERATION_MODELS,
  HENJI_GENERATION_EXECUTION_PACKS,
  HENJI_GENERATION_PROVIDER_IDS,
  HENJI_GENERATION_PROVIDER_PACKS,
  henjiModelCapabilityDiscovery,
  searchHenjiModelCapabilities,
} from './applicationModelProfile'

afterEach(() => {
  clearCancelFlag('generation', 'application-profile-cancel')
})

function createRuntime(fetch: RuntimeContext['transport']['fetch'] = async () => {
  throw new Error('Unexpected transport request')
}): RuntimeContext {
  return {
    transport: { fetch },
    credentials: { get: () => 'test-key' },
    media: {
      read: async () => ({
        bytes: new Uint8Array(),
        mimeType: 'application/octet-stream',
        filename: 'unused',
      }),
    },
  }
}

describe('Henji-AI 显式模型选择', () => {
  it('组合 8 个 provider pack 并与兼容目录保持严格 105/105 parity', () => {
    expect(HENJI_GENERATION_PROVIDER_PACKS).toHaveLength(8)
    expect(HENJI_GENERATION_MODELS).toHaveLength(105)
    expect(new Set(HENJI_GENERATION_MODELS.map((model) => model.meta.id))).toEqual(
      new Set(catalog.map((model) => model.meta.id))
    )
    expect(new Set(HENJI_GENERATION_PROVIDER_PACKS.flatMap((pack) => pack.providers.map((item) => item.id))))
      .toEqual(new Set(HENJI_GENERATION_PROVIDER_IDS))
    const modelWithAlias = HENJI_GENERATION_MODELS.find((model) => (model.meta.aliases?.length ?? 0) > 0)
    expect(modelWithAlias).toBeTruthy()
    const alias = modelWithAlias?.meta.aliases?.[0]
    expect(alias).toBeTruthy()
    expect(getHenjiGenerationModel(alias!)).toBe(modelWithAlias)
  })

  it('缺少任一 provider pack 时产品选择门禁明确变红', () => {
    expect(() => assertHenjiGenerationSelection(HENJI_GENERATION_PROVIDER_PACKS.slice(0, -1)))
      .toThrow(/provider selection mismatch/)
    expect(assertHenjiGenerationSelection(HENJI_GENERATION_PROVIDER_PACKS)).toHaveLength(105)
  })

  it('生产 client 使用 modular 目录、保留八供应商、取消与 LLM chat', async () => {
    const fetch = vi.fn(async () => new Response([
      'data: {"id":"chatcmpl-app","object":"chat.completion.chunk","created":1,"model":"fixture","choices":[{"index":0,"delta":{"role":"assistant","content":"完成"},"finish_reason":null}]}',
      '',
      'data: {"id":"chatcmpl-app","object":"chat.completion.chunk","created":1,"model":"fixture","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}',
      '',
      'data: [DONE]',
      '',
    ].join('\n'), {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    }))
    const client = createHenjiAIClient(createRuntime(fetch))

    try {
      expect(HENJI_GENERATION_EXECUTION_PACKS).toHaveLength(9)
      expect(client.catalog.list()).toHaveLength(108)
      expect(new Set(client.providers.list())).toEqual(new Set(HENJI_GENERATION_PROVIDER_IDS))
      expect(client.catalog.get('fal-flux-pro-erase')).toBeUndefined()
      expect(client.catalog.get('fal-qwen-image-edit-2509-multiple-angles')).toBeDefined()
      expect(client.catalog.get('fal-perspective-change')).toBeDefined()
      expect(client.catalog.get('fal-flux-2-multiple-angles')).toBeDefined()

      client.cancel({ namespace: 'generation', taskId: 'application-profile-cancel' })
      expect(isCancelled('generation', 'application-profile-cancel')).toBe(true)

      const events: string[] = []
      await expect(client.chat.stream({
        requestId: 'application-profile-chat',
        providerId: 'openai',
        modelId: 'fixture',
        baseUrl: 'https://example.test/v1',
        messages: [{ role: 'user', content: '测试' }],
      }, (event) => events.push(event.type))).resolves.toMatchObject({ outputChars: 2 })
      expect(events).toContain('Token')
      expect(fetch).toHaveBeenCalledOnce()
    } finally {
      client.dispose()
    }
  })
})

describe('Henji-AI 统一能力发现', () => {
  it('只索引已选 105 generation 与真实 LLM 目录，不默认包含 Fal 工具', () => {
    const items = henjiModelCapabilityDiscovery.list()
    expect(items.filter((item) => item.sourceKind === 'generation-model')).toHaveLength(105)
    expect(items.filter((item) => item.sourceKind === 'llm-model')).toHaveLength(LLM_MODEL_CATALOG_ENTRIES.length)
    expect(searchHenjiModelCapabilities({ features: 'erase' })).toEqual([])

    const optionalDiscovery = createModelCapabilityDiscovery({ generationPacks: [falImageEditTools] })
    expect(optionalDiscovery.search({
      providerIds: 'fal',
      outputModalities: 'image',
      operations: 'image-edit',
      features: 'erase',
    })).toHaveLength(3)
  })

  it.each([
    ['图片生成', { outputModalities: 'image', operations: 'image-generation' }],
    ['图片编辑', { outputModalities: 'image', operations: 'image-edit', acceptedInputContentKinds: 'image' }],
    ['视频生成', { outputModalities: 'video', operations: 'video-generation' }],
    ['文生视频', { outputModalities: 'video', operations: 'text-to-video' }],
    ['图生视频', { outputModalities: 'video', operations: 'image-to-video', acceptedInputContentKinds: 'image' }],
    ['参考生视频', { outputModalities: 'video', operations: 'reference-to-video' }],
    ['视频编辑', { outputModalities: 'video', operations: 'video-edit', acceptedInputContentKinds: 'video' }],
    ['音频生成', { outputModalities: 'audio', operations: 'audio-generation' }],
  ] as const)('%s 能由标准 provider/output/operation/input 条件表达', (_label, query) => {
    expect(searchHenjiModelCapabilities(query).length).toBeGreaterThan(0)
  })

  it('LLM 可按 text/image/video/audio 输入及组合条件筛选', () => {
    const text = searchHenjiModelCapabilities({
      operations: 'chat',
      acceptedInputContentKinds: 'text',
    })
    const image = searchHenjiModelCapabilities({
      operations: 'chat',
      acceptedInputContentKinds: 'image',
    })
    const video = searchHenjiModelCapabilities({
      operations: 'chat',
      acceptedInputContentKinds: 'video',
    })
    const audio = searchHenjiModelCapabilities({
      operations: 'chat',
      acceptedInputContentKinds: 'audio',
    })
    const allMedia = searchHenjiModelCapabilities({
      operations: 'chat',
      acceptedInputContentKinds: { allOf: ['text', 'image', 'video', 'audio'] },
    })

    expect(text.length).toBe(LLM_MODEL_CATALOG_ENTRIES.length)
    expect(image.length).toBeGreaterThan(0)
    expect(video.length).toBeGreaterThan(0)
    expect(audio.length).toBeGreaterThan(0)
    expect(allMedia.length).toBeGreaterThan(0)
    expect(text.some((item) => item.profile.acceptedInputContentKinds.length === 1)).toBe(true)
  })
})
