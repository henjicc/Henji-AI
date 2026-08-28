import { describe, expect, it } from 'vitest'
import { catalog } from '@henjicc/ai-sdk'

import {
  GENERATION_MODEL_DESCRIPTIONS,
  getGenerationModelDescription,
  hasGenerationModelDescription,
} from './generationModelDescriptions'

describe('generationModelDescriptions', () => {
  it('所有供应商模型都引用已登记的通用模型标识', () => {
    expect(catalog).toHaveLength(101)
    for (const model of catalog) {
      expect(model.meta.canonicalModelId, model.meta.id).toBeTruthy()
      expect(hasGenerationModelDescription(model.meta.canonicalModelId), model.meta.id).toBe(true)
    }
  })

  it('供应商模型元数据不再直接声明 description', () => {
    for (const model of catalog) {
      expect(model.meta, model.meta.id).not.toHaveProperty('description')
    }
  })

  it('所有通用模型都有中文定性描述并可注入模型元数据', () => {
    expect(Object.keys(GENERATION_MODEL_DESCRIPTIONS)).toHaveLength(53)
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
