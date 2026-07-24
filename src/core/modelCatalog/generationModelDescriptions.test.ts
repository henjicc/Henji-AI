import { describe, expect, it } from 'vitest'

import {
  GENERATION_MODEL_DESCRIPTIONS,
  getGenerationModelDescription,
  hasGenerationModelDescription,
} from './generationModelDescriptions'

const modelSources = import.meta.glob('/src/models/**/*.model.ts', {
  eager: true,
  import: 'default',
  query: '?raw',
}) as Record<string, string>

describe('generationModelDescriptions', () => {
  it('所有供应商模型都引用已登记的通用模型标识', () => {
    expect(Object.keys(modelSources)).toHaveLength(65)
    for (const [file, source] of Object.entries(modelSources)) {
      const canonicalModelId = source.match(/canonicalModelId:\s*'([^']+)'/)?.[1]
      expect(canonicalModelId, file).toBeTruthy()
      expect(hasGenerationModelDescription(canonicalModelId ?? '')).toBe(true)
    }
  })

  it('供应商模型元数据不再直接声明 description', () => {
    for (const [file, source] of Object.entries(modelSources)) {
      const metaBeforeTags = source.match(/meta:\s*\{[\s\S]*?\n\s*tags:/)?.[0] ?? ''
      expect(metaBeforeTags, file).toContain('canonicalModelId:')
      expect(metaBeforeTags, file).not.toMatch(/\bdescription\s*:/)
    }
  })

  it('所有通用模型都有中文定性描述并可注入模型元数据', () => {
    expect(Object.keys(GENERATION_MODEL_DESCRIPTIONS)).toHaveLength(43)
    for (const description of Object.values(GENERATION_MODEL_DESCRIPTIONS)) {
      expect(description.zh.trim()).not.toBe('')
    }
    expect(getGenerationModelDescription('gpt-image-2')).toMatchObject({
      zh: expect.stringContaining('推荐使用'),
    })
    expect(getGenerationModelDescription('seedream-4.5')).toEqual(
      GENERATION_MODEL_DESCRIPTIONS['seedream-4.5']
    )
    expect(getGenerationModelDescription('not-adapted')).toBeUndefined()
  })
})
