import { existsSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { findLlmModelCatalogEntry } from '../../src/llm/modelCatalog'
import {
  LLM_PROVIDER_PRESETS,
  createModelsFromPreset,
  createProviderFromPreset,
  findLlmProviderPreset,
} from '../../src/llm/providerPresets'
import { hasProviderReasoningRule } from '../../src/llm/providerReasoningRequest'

/**
 * 迁入 SDK 后 `preset.docs` 从仓库根相对路径改成了包内相对路径（不带 `packages/ai-sdk/` 前缀，
 * 见任务 4.1 执行记录），基准目录相应从仓库根改成包根。`__dirname` 是
 * `packages/ai-sdk/tests/llm`，上两级就是包根 `packages/ai-sdk`。
 */
const PACKAGE_ROOT = path.resolve(__dirname, '../..')

describe('LLM_PROVIDER_PRESETS', () => {
  it('providerId 唯一且是规范化的小写形式', () => {
    const ids = LLM_PROVIDER_PRESETS.map(preset => preset.providerId)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) {
      expect(id).toBe(id.trim().toLowerCase())
    }
  })

  it('推荐模型全部能在内置目录里查到', () => {
    // 预设的意义就是"加进来就已经标好能力"，混进目录里没有的模型会退回纯文本默认值，
    // 用户又要自己勾一遍。
    for (const preset of LLM_PROVIDER_PRESETS) {
      for (const modelId of preset.modelIds) {
        expect(findLlmModelCatalogEntry(modelId), `${preset.providerId} -> ${modelId}`).not.toBeNull()
      }
    }
  })

  it('每条都能追溯到仓库里真实存在的资料文件', () => {
    for (const preset of LLM_PROVIDER_PRESETS) {
      expect(existsSync(path.join(PACKAGE_ROOT, preset.docs)), preset.docs).toBe(true)
    }
  })

  it('没有通用 Base URL 的供应商必须给出指路说明', () => {
    for (const preset of LLM_PROVIDER_PRESETS) {
      if (!preset.baseUrl) expect(preset.baseUrlHint, preset.providerId).toBeTruthy()
    }
  })

  it('有专门思考参数写法的供应商，其 providerId 必须与映射表登记的一致', () => {
    // 这两份表按 providerId 对齐；预设改了 id 而映射表没改，思考模式会静默退回通用兜底。
    for (const providerId of ['deepseek', 'kimi', 'bigmodel', 'volcengine', 'bailian', 'groq']) {
      expect(findLlmProviderPreset(providerId), providerId).not.toBeNull()
      expect(hasProviderReasoningRule(providerId), providerId).toBe(true)
    }
  })
})

describe('createProviderFromPreset / createModelsFromPreset', () => {
  it('生成的供应商可直接落库，空 Base URL 转成 undefined', () => {
    const bailian = createProviderFromPreset(findLlmProviderPreset('bailian')!)
    expect(bailian.baseUrl).toBeUndefined()
    expect(bailian.enabled).toBe(true)
    expect(createProviderFromPreset(findLlmProviderPreset('kimi')!).baseUrl).toBe('https://api.moonshot.cn/v1')
  })

  it('推荐模型带上目录标注与 catalogId，避免保存时被再标一次', () => {
    const preset = findLlmProviderPreset('mimo')!
    const provider = createProviderFromPreset(preset)
    const models = createModelsFromPreset(preset, provider)
    const omni = models.find(model => model.modelId === 'mimo-v2.5')
    expect(omni?.catalogId).toBe('mimo-v2.5')
    expect(omni?.capabilities).toMatchObject({ image: true, video: true, audio: true })
    expect(models.every(model => model.providerId === 'mimo' && model.baseUrl === provider.baseUrl)).toBe(true)
  })
})
