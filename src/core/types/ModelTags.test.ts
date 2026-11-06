import { expect, it } from 'vitest'
import zhModels from '@/i18n/locales/zh-CN/models.json'
import enModels from '@/i18n/locales/en-US/models.json'
import { MODEL_TAGS } from './ModelTags'

it('词表里的每个能力标签都有中英文名，语言包里没有词表外的标签', () => {
  for (const tags of [zhModels.tags, enModels.tags] as Record<string, string>[]) {
    expect(Object.keys(tags).sort()).toEqual([...MODEL_TAGS].sort())
    expect(Object.values(tags).every((label) => label.trim().length > 0)).toBe(true)
  }
})
