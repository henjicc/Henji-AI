import { describe, expect, it, vi } from 'vitest'

import {
  createCapabilityClient,
  type CapabilityDescriptor,
  type CapabilityModule,
  type RuntimeContext,
} from '../src/capabilities'
import {
  bailianNonRealtimeAsrPresets,
} from '../src/capabilities/speech-recognition/bailian'
import {
  bailianRealtimeAsrPresets,
} from '../src/capabilities/speech-recognition/bailian/realtime'
import {
  groqAsrPresets,
} from '../src/capabilities/speech-recognition/groq'
import {
  siliconFlowAsrPresets,
} from '../src/capabilities/speech-recognition/siliconflow'
import {
  volcengineFileAsrPresets,
} from '../src/capabilities/speech-recognition/volcengine'
import {
  volcengineRealtimeAsrPresets,
} from '../src/capabilities/speech-recognition/volcengine/realtime'
import {
  BAILIAN_QWEN_MT_PRESETS,
  createBailianQwenMtTranslationModule,
} from '../src/capabilities/translation/bailian'
import { createModelCapabilityDiscovery } from '../src/discovery'
import { GROQ_DEFAULT_MODEL_CONFIG } from '../src/llm/groq'

const FIXTURE_RUNTIME: RuntimeContext = {
  transport: { fetch: async () => { throw new Error('ID contract fixture must not use network') } },
  credentials: { get: async () => undefined },
  media: { read: async () => { throw new Error('ID contract fixture must not read media') } },
}

const asrDescriptors = [
  ...bailianNonRealtimeAsrPresets,
  ...bailianRealtimeAsrPresets,
  ...volcengineFileAsrPresets,
  ...volcengineRealtimeAsrPresets,
  ...siliconFlowAsrPresets,
  ...groqAsrPresets,
].map((preset) => preset.descriptor)

const translationModules = Object.values(BAILIAN_QWEN_MT_PRESETS).map((preset) => (
  createBailianQwenMtTranslationModule(preset.modelId)
))
const translationDescriptors = translationModules.map((module) => module.descriptor)

function descriptor(input: {
  id: string
  namespace: string
  kind?: string
  providerId?: string
  modelId?: string
  operations?: readonly string[]
}): CapabilityDescriptor {
  return {
    id: input.id,
    kind: input.kind ?? 'fixture-operation',
    source: { kind: 'plugin', namespace: input.namespace },
    providerIds: input.providerId ? [input.providerId] : undefined,
    modelId: input.modelId,
    operations: input.operations,
    contract: {
      input: [{ kind: 'text' }],
      output: [{ kind: 'structured-data' }],
    },
  }
}

function moduleOf(value: CapabilityDescriptor, dispose = vi.fn()): CapabilityModule<unknown, unknown> {
  return { descriptor: value, execute: async (input) => input, dispose }
}

describe('能力 ID、来源命名空间与按需注册收口', () => {
  it('15 个 ASR、3 个 Qwen-MT 与 Groq 默认模型均可发现且坐标唯一', () => {
    const discovery = createModelCapabilityDiscovery({
      extensions: [...asrDescriptors, ...translationDescriptors],
      llmModels: [GROQ_DEFAULT_MODEL_CONFIG],
    })
    const items = discovery.list()
    const ids = items.map((item) => item.id)
    expect(items).toHaveLength(19)
    expect(new Set(ids)).toHaveLength(ids.length)

    const asr = discovery.search({
      providerIds: 'bailian',
      operations: 'speech-to-text',
      acceptedInputContentKinds: 'audio',
    })
    expect(asr).toHaveLength(9)
    expect(asr.every((item) => item.id.startsWith('bailian.speech-recognition.'))).toBe(true)
    expect(discovery.search({
      providerIds: 'bailian', operations: 'speech-to-text', features: 'realtime',
    })).toHaveLength(4)
    expect(discovery.search({
      providerIds: 'bailian', operations: 'text-translation', outputContentKinds: 'text',
    })).toHaveLength(3)
    expect(discovery.search({ providerIds: 'groq', operations: 'chat' })).toMatchObject([{
      id: 'groq:openai/gpt-oss-20b',
      profile: { providerIds: ['groq'] },
    }])
    expect(discovery.search({
      providerIds: 'volcengine', operations: 'speech-to-text', features: 'realtime',
    })).toHaveLength(1)
    expect(discovery.search({
      providerIds: 'siliconflow', operations: 'speech-to-text', features: 'file-transcription',
    })).toHaveLength(2)
    expect(discovery.search({
      providerIds: 'groq', operations: 'speech-to-text', features: 'file-transcription',
    })).toHaveLength(2)

    const providerIds = items.flatMap((item) => item.profile.providerIds)
    expect(new Set(providerIds)).toEqual(new Set(['bailian', 'groq', 'siliconflow', 'volcengine']))
    expect(providerIds).not.toContain('funasr')
    expect(asrDescriptors.every((item) => (
      item.source.kind === 'builtin' && item.source.namespace === '@henjicc/ai-sdk'
    ))).toBe(true)
  })

  it('moduleId 跨执行形态全局冲突时保留原模块并报告双方来源', async () => {
    const first = moduleOf(descriptor({
      id: 'shared.module', namespace: 'com.example.first', providerId: 'fixture', modelId: 'one',
    }))
    const client = createCapabilityClient({ runtime: FIXTURE_RUNTIME, modules: [first] })
    const conflicting = {
      descriptor: descriptor({
        id: 'shared.module', namespace: 'com.example.second', providerId: 'fixture', modelId: 'two',
      }),
      open: async () => ({ send: async () => undefined, finish: async () => undefined }),
    }

    expect(() => client.registerRealtime(conflicting)).toThrow(
      /shared\.module.*com\.example\.second.*execute module.*com\.example\.first/
    )
    expect(client.list()).toEqual([first.descriptor])
    await client.dispose()
  })

  it('同 provider/kind/model 不能换 moduleId 重复占用，卸载后才能重新注册', async () => {
    const firstDispose = vi.fn()
    const first = moduleOf(descriptor({
      id: 'plugin.first', namespace: 'com.example.first', providerId: 'fixture', modelId: 'same',
    }), firstDispose)
    const replacement = moduleOf(descriptor({
      id: 'plugin.replacement', namespace: 'com.example.second', providerId: 'fixture', modelId: 'same',
    }))
    const client = createCapabilityClient({ runtime: FIXTURE_RUNTIME, modules: [first] })

    expect(() => client.register(replacement)).toThrow(
      /fixture\/fixture-operation\/same.*plugin\.first.*com\.example\.first/
    )
    await expect(client.unregister('plugin.first')).resolves.toBe(true)
    expect(firstDispose).toHaveBeenCalledOnce()
    expect(() => client.register(replacement)).not.toThrow()
    await client.dispose()
  })

  it('按 source namespace 批量卸载只释放自己的活动模块', async () => {
    const disposeA = vi.fn()
    const disposeB = vi.fn()
    const client = createCapabilityClient({ runtime: FIXTURE_RUNTIME })
    client.register(moduleOf(descriptor({ id: 'plugin.a.one', namespace: 'com.example.a' }), disposeA))
    client.register(moduleOf(descriptor({ id: 'plugin.a.two', namespace: 'com.example.a' }), disposeA))
    client.register(moduleOf(descriptor({ id: 'plugin.b.one', namespace: 'com.example.b' }), disposeB))

    await expect(client.unregisterSource('com.example.a')).resolves.toBe(2)
    expect(disposeA).toHaveBeenCalledTimes(2)
    expect(disposeB).not.toHaveBeenCalled()
    expect(client.list().map((item) => item.id)).toEqual(['plugin.b.one'])
    await expect(client.unregisterSource('com.example.a')).resolves.toBe(0)
    await client.dispose()
    expect(disposeB).toHaveBeenCalledOnce()
  })

  it('注册时冻结描述快照，插件事后改对象不能污染 ID/坐标索引', async () => {
    const mutable = descriptor({
      id: 'plugin.mutable', namespace: 'com.example.mutable', providerId: 'fixture', modelId: 'stable',
    })
    const client = createCapabilityClient({ runtime: FIXTURE_RUNTIME })
    const handle = client.register(moduleOf(mutable))
    mutable.id = 'plugin.mutated'
    mutable.modelId = 'mutated'
    mutable.source.namespace = 'com.example.mutated'

    expect(handle.descriptor).toMatchObject({
      id: 'plugin.mutable', modelId: 'stable', source: { namespace: 'com.example.mutable' },
    })
    expect(client.get('plugin.mutated')).toBeUndefined()
    await expect(client.unregister('plugin.mutable')).resolves.toBe(true)
    expect(() => client.register(moduleOf(descriptor({
      id: 'plugin.reuse', namespace: 'com.example.reuse', providerId: 'fixture', modelId: 'stable',
    })))).not.toThrow()
    await client.dispose()
  })

  it('不规范或重复 provider/operation 立即变红，不做静默 trim/去重', async () => {
    const client = createCapabilityClient({ runtime: FIXTURE_RUNTIME })
    const invalidProvider = descriptor({ id: 'invalid.provider', namespace: 'com.example.invalid' })
    invalidProvider.providerIds = ['bailian', 'bailian']
    expect(() => client.register(moduleOf(invalidProvider))).toThrow(/provider id is duplicated: bailian/)

    const invalidOperation = descriptor({ id: 'invalid.operation', namespace: 'com.example.invalid' })
    invalidOperation.operations = ['ocr', 'ocr']
    expect(() => client.register(moduleOf(invalidOperation))).toThrow(/operation id is duplicated: ocr/)

    const invalidSource = descriptor({ id: 'invalid.source', namespace: ' com.example.invalid' })
    expect(() => client.register(moduleOf(invalidSource))).toThrow(/source namespace.*canonical string/)
    await client.dispose()
  })

  it('发现索引拒绝跨 LLM/extension 的同 ID，错误标明两种来源', () => {
    const collision = descriptor({
      id: 'groq:openai/gpt-oss-20b', namespace: 'com.example.shadow', operations: ['chat'],
    })
    expect(() => createModelCapabilityDiscovery({
      llmModels: [GROQ_DEFAULT_MODEL_CONFIG],
      extensions: [collision],
    })).toThrow(/capability_discovery_id_conflict.*plugin source.*llm-model/)
  })

  it('未来 OCR/custom operation 可直接注册和组合筛选，无需修改内核联合类型', async () => {
    const ocr = moduleOf(descriptor({
      id: 'plugin.ocr.document-layout',
      namespace: 'com.example.document-tools',
      kind: 'document-understanding',
      providerId: 'example-vision',
      modelId: 'layout-v1',
      operations: ['ocr', 'document-layout-analysis'],
    }))
    const client = createCapabilityClient({ runtime: FIXTURE_RUNTIME, modules: [ocr] })
    const discovery = createModelCapabilityDiscovery({ extensions: client.list() })

    expect(discovery.search({
      providerIds: 'example-vision',
      operations: { allOf: ['ocr', 'document-layout-analysis'] },
    })).toMatchObject([{ id: 'plugin.ocr.document-layout' }])
    await client.dispose()
  })
})
