import { describe, expect, it } from 'vitest'

import {
  applyAssistantModelPreferencesUpdate,
  assistantModelPreferencesSchema,
  createDefaultAssistantModelPreferences,
  formatAssistantModelPreferencesForPrompt,
} from './modelPreferences'

describe('assistantModelPreferences', () => {
  it('只更新指定媒体类型，不清空其余模型偏好', () => {
    const current = createDefaultAssistantModelPreferences('2026-01-01T00:00:00.000Z')
    current.preferredModels.video = ['wan-2.7']
    const next = applyAssistantModelPreferencesUpdate(
      current,
      { preferredModels: { image: ['seedream-4.5', 'seedream-4.5'] } },
      '2026-01-02T00:00:00.000Z'
    )

    expect(next.preferredModels.image).toEqual(['seedream-4.5'])
    expect(next.preferredModels.video).toEqual(['wan-2.7'])
    expect(next.updatedAt).toBe('2026-01-02T00:00:00.000Z')
  })

  it('拒绝未知字段并生成不含时间戳的提示词载荷', () => {
    const preferences = createDefaultAssistantModelPreferences()
    expect(() => assistantModelPreferencesSchema.parse({
      ...preferences,
      unknown: true,
    })).toThrow()

    const formatted = formatAssistantModelPreferencesForPrompt(preferences)
    expect(formatted).toContain('"strategy":"balanced"')
    expect(formatted).not.toContain('updatedAt')
    expect(formatted).not.toContain('schemaVersion')
  })
})
