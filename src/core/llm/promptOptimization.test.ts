import { describe, expect, it } from 'vitest'

import type { PromptDocumentV1 } from '@/core/inputs/promptDocument'
import { createDefaultPromptProfile } from './defaults'
import {
  normalizePromptOptimizationProfileDocuments,
  readPromptOptimizationProfileDocument,
} from './promptOptimization'
import type { PromptOptimizationProfile } from '@henjicc/ai-sdk'

/**
 * `PromptOptimizationProfile.systemPromptDocument`/`userTemplateDocument` 在 SDK 侧
 * （任务 4.1）改成了 `unknown`——具体的 `PromptDocumentV1` 类型留给应用侧，SDK 不引入这个
 * 画布专属的富文本文档格式。这里在测试里按已知的真实类型窄化一下，避免逐处 `as` 断言。
 */
function asPromptDocument(value: unknown): PromptDocumentV1 | undefined {
  return value as PromptDocumentV1 | undefined
}

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

    expect(asPromptDocument(normalized.systemPromptDocument)?.version).toBe(1)
    expect(asPromptDocument(normalized.userTemplateDocument)?.version).toBe(1)
    expect(normalized.userTemplate).toBe('优化：{{prompt}}')
  })

  it('默认优化配置从创建时就包含结构化文档', () => {
    const profile = createDefaultPromptProfile('2026-01-01T00:00:00.000Z')

    expect(asPromptDocument(profile.systemPromptDocument)?.version).toBe(1)
    expect(asPromptDocument(profile.userTemplateDocument)?.version).toBe(1)
  })
})
