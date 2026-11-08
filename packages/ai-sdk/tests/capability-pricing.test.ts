import { describe, expect, it } from 'vitest'

import {
  BAILIAN_QWEN_MT_PRESETS,
  audioDurationPrice,
  bailianNonRealtimeAsrPresets,
  createBailianQwenMtTranslationModule,
  estimateAudioDurationCost,
  groqAsrPresets,
  siliconFlowAsrPresets,
  snapshotCapabilityDescriptor,
  tokenUsagePrice,
  validateCapabilityDescriptor,
  volcengineFileAsrPresets,
  type CapabilityDescriptor,
} from '../src'
import { bailianRealtimeAsrPresets } from '../src/capabilities/speech-recognition/bailian/realtime'
import { volcengineRealtimeAsrPresets } from '../src/capabilities/speech-recognition/volcengine/realtime'
import { createBailianEmbeddingModule, bailianEmbeddingPresets } from '../src/capabilities/embedding/bailian'
import { createBigmodelEmbeddingModule } from '../src/capabilities/embedding/bigmodel'
import { createPpioEmbeddingModule } from '../src/capabilities/embedding/ppio'
import { createSiliconflowEmbeddingModule, siliconflowEmbeddingPresets } from '../src/capabilities/embedding/siliconflow'
import { createVolcengineEmbeddingModule } from '../src/capabilities/embedding/volcengine'
import { createBailianRerankModule, bailianRerankPresets } from '../src/capabilities/rerank/bailian'
import { createBigmodelRerankModule } from '../src/capabilities/rerank/bigmodel'
import { createPpioRerankModule } from '../src/capabilities/rerank/ppio'
import { createSiliconflowRerankModule, siliconflowRerankPresets } from '../src/capabilities/rerank/siliconflow'

const BASE_URL = 'https://workspace.cn-beijing.maas.aliyuncs.com'

function builtinDescriptors(): CapabilityDescriptor[] {
  return [
    ...[...bailianNonRealtimeAsrPresets, ...bailianRealtimeAsrPresets, ...volcengineFileAsrPresets, ...volcengineRealtimeAsrPresets, ...groqAsrPresets, ...siliconFlowAsrPresets]
      .map((preset) => preset.descriptor),
    ...Object.values(BAILIAN_QWEN_MT_PRESETS).map((preset) => createBailianQwenMtTranslationModule(preset.modelId).descriptor),
    ...(Object.keys(bailianEmbeddingPresets) as (keyof typeof bailianEmbeddingPresets)[]).map((model) => createBailianEmbeddingModule({ baseUrl: BASE_URL, model }).descriptor),
    ...(Object.keys(siliconflowEmbeddingPresets) as (keyof typeof siliconflowEmbeddingPresets)[]).map((model) => createSiliconflowEmbeddingModule({ model }).descriptor),
    createBigmodelEmbeddingModule().descriptor,
    createPpioEmbeddingModule().descriptor,
    createVolcengineEmbeddingModule().descriptor,
    ...(Object.keys(bailianRerankPresets) as (keyof typeof bailianRerankPresets)[]).map((model) => createBailianRerankModule({ baseUrl: BASE_URL, model }).descriptor),
    ...(Object.keys(siliconflowRerankPresets) as (keyof typeof siliconflowRerankPresets)[]).map((model) => createSiliconflowRerankModule({ model }).descriptor),
    createBigmodelRerankModule().descriptor,
    createPpioRerankModule().descriptor,
  ]
}

describe('能力描述的价格', () => {
  it('内置语音识别、翻译、向量与重排序都登记了合法价格，外部消费方能直接读到', () => {
    for (const descriptor of builtinDescriptors()) {
      expect(descriptor.pricing, descriptor.id).toBeDefined()
      expect(() => validateCapabilityDescriptor(descriptor), descriptor.id).not.toThrow()
    }
  })

  it('语音识别的价格都能按时长估算', () => {
    const asr = builtinDescriptors().filter((descriptor) => descriptor.kind === 'speech-recognition')
    for (const descriptor of asr) {
      expect(estimateAudioDurationCost(descriptor.pricing!, 60_000), descriptor.id).not.toBeNull()
    }
  })

  it('按时长估价计入最低计费秒数，按 token 估价用音频折算比例', () => {
    expect(estimateAudioDurationCost(audioDurationPrice('USD', 0.01, 10), 2_000)).toEqual({ amount: 0.1, currency: 'USD' })
    expect(estimateAudioDurationCost(audioDurationPrice('CNY', 0.01), 2_000)).toEqual({ amount: 0.02, currency: 'CNY' })
    const tokens = tokenUsagePrice('CNY', 1, 2, { audioTokenRate: { inputTokensPerSecond: 10, outputTokensPerSecond: 5, source: 'test' } })
    expect(estimateAudioDurationCost(tokens, 100_000)?.amount).toBeCloseTo((1000 * 1 + 500 * 2) / 1_000_000)
    expect(estimateAudioDurationCost(tokenUsagePrice('CNY', 1, 2), 100_000)).toBeNull()
    expect(estimateAudioDurationCost(audioDurationPrice('CNY', 0.01), 0)).toBeNull()
  })

  it('注册时拒绝非法价格，快照后价格不能被改写', () => {
    const base: CapabilityDescriptor = {
      id: 'example.asr', kind: 'speech-recognition', source: { kind: 'external', namespace: 'example' },
      contract: { input: [{ kind: 'audio' }], output: [{ kind: 'text' }] },
    }
    expect(() => validateCapabilityDescriptor({ ...base, pricing: audioDurationPrice('CNY', -1) })).toThrow(/invalid pricing/)
    expect(() => validateCapabilityDescriptor({ ...base, pricing: { ...tokenUsagePrice('CNY', 1, 1), outputPerMillionTokens: Number.NaN } })).toThrow(/invalid pricing/)
    const pricing = { ...tokenUsagePrice('CNY', 1, 1), audioTokenRate: { inputTokensPerSecond: 1, outputTokensPerSecond: 1, source: 'test' } }
    const snapshot = snapshotCapabilityDescriptor({ ...base, pricing })
    pricing.inputPerMillionTokens = 99
    expect(snapshot.pricing).toMatchObject({ inputPerMillionTokens: 1 })
    expect(Object.isFrozen(snapshot.pricing)).toBe(true)
    expect(Object.isFrozen((snapshot.pricing as typeof pricing).audioTokenRate)).toBe(true)
  })
})
