import { describe, expect, it } from 'vitest'

import { createDefaultPromptProfile } from './defaults'
import {
  normalizePromptOptimizationProfileDocuments,
  readPromptOptimizationProfileDocument,
} from './promptOptimization'
import type { PromptOptimizationProfile } from './types'

function createLegacyProfile(): PromptOptimizationProfile {
  return {
    id: 'legacy-profile',
    name: '旧配置',
    providerId: 'provider',
    modelId: 'model',
    systemPrompt: '只输出结果',
    userTemplate: '优化：{{prompt}}',
    capabilities: { text: true, image: false, video: false },
    isDefault: false,
    enabled: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

describe('prompt optimization documents', () => {
  it('旧配置读取时把已知模板变量升级为原子节点', () => {
    const profile = createLegacyProfile()
    const document = readPromptOptimizationProfileDocument(profile, 'userTemplate')

    expect(JSON.stringify(document)).toContain('templateVariable')
    expect(JSON.stringify(document)).toContain('prompt')
  })

  it('归一化时结构化字段与旧字符串保持双写', () => {
    const normalized = normalizePromptOptimizationProfileDocuments(createLegacyProfile())

    expect(normalized.systemPromptDocument?.version).toBe(1)
    expect(normalized.userTemplateDocument?.version).toBe(1)
    expect(normalized.userTemplate).toBe('优化：{{prompt}}')
  })

  it('默认优化配置从创建时就包含结构化文档', () => {
    const profile = createDefaultPromptProfile('2026-01-01T00:00:00.000Z')

    expect(profile.systemPromptDocument?.version).toBe(1)
    expect(profile.userTemplateDocument?.version).toBe(1)
  })
})
