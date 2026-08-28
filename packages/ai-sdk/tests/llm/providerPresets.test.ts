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
import {
  normalizeLlmApiKeyManagementUrl,
  normalizeLlmProviderSetup,
  resolveLlmProviderApiKeyUrl,
} from '../../src/llm/providerSetup'

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
    expect(bailian).toMatchObject({
      credentialId: 'bailian',
      setup: { kind: 'preset', presetId: 'bailian', lifecycle: 'user' },
    })
    expect(createProviderFromPreset(findLlmProviderPreset('kimi')!).baseUrl).toBe('https://api.moonshot.cn/v1')
  })

  it('宿主可显式创建不可永久删除的 builtin 预设记录', () => {
    expect(createProviderFromPreset(findLlmProviderPreset('ppio')!, { lifecycle: 'builtin' }))
      .toMatchObject({
        providerId: 'ppio',
        credentialId: 'ppio',
        setup: { kind: 'preset', presetId: 'ppio', lifecycle: 'builtin' },
      })
    expect(createProviderFromPreset(findLlmProviderPreset('bigmodel')!, {
      endpointProfile: 'global',
      lifecycle: 'builtin',
    })).toMatchObject({
      providerId: 'bigmodel-global',
      providerFamilyId: 'bigmodel',
      endpointProfile: 'global',
      credentialId: 'bigmodel-global',
      setup: { kind: 'preset', presetId: 'bigmodel', lifecycle: 'builtin' },
    })
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

describe('provider setup / API key URL', () => {
  it('预设返回官方地址，自定义地址只接受无内嵌凭据的 HTTP(S)', () => {
    const preset = createProviderFromPreset(findLlmProviderPreset('groq')!)
    expect(resolveLlmProviderApiKeyUrl(preset)).toBe('https://console.groq.com/keys')
    expect(resolveLlmProviderApiKeyUrl({
      ...preset,
      providerId: 'custom-gateway',
      credentialId: 'custom-gateway',
      setup: { kind: 'custom', apiKeyManagementUrl: 'https://keys.example.com/manage' },
    })).toBe('https://keys.example.com/manage')
    expect(() => normalizeLlmApiKeyManagementUrl('javascript:alert(1)'))
      .toThrow('unsupported protocol')
    expect(() => normalizeLlmApiKeyManagementUrl('file:///tmp/key'))
      .toThrow('unsupported protocol')
    expect(() => normalizeLlmApiKeyManagementUrl('https://user:secret@example.com/keys'))
      .toThrow('must not contain embedded credentials')
    expect(() => normalizeLlmApiKeyManagementUrl(`https://example.com/${'x'.repeat(2_100)}`))
      .toThrow('exceeds 2048 characters')
  })

  it('未知 preset 的错误列出可用 preset，便于调用方自行修正', () => {
    expect(() => normalizeLlmProviderSetup({
      kind: 'preset', presetId: 'not-a-preset', lifecycle: 'user',
    })).toThrow(/choose one of: .*groq.*ppio/)
  })

  it('拒绝畸形 setup 类型与 preset 生命周期', () => {
    expect(() => normalizeLlmProviderSetup({ kind: 'other' } as never))
      .toThrow('setup kind must be "preset" or "custom"')
    expect(() => normalizeLlmProviderSetup({
      kind: 'preset', presetId: 'ppio', lifecycle: 'temporary',
    } as never)).toThrow('preset lifecycle must be "builtin" or "user"')
  })
})
