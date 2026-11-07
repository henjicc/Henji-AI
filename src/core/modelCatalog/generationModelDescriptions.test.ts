import { describe, expect, it } from 'vitest'
import { catalog } from '@henjicc/ai-sdk'

import {
  GENERATION_MODEL_DESCRIPTIONS,
  getGenerationModelDescription,
  hasGenerationModelDescription,
} from './generationModelDescriptions'
import { listGenerationModelStandingIds } from './generationModelStanding'

describe('generationModelDescriptions', () => {
  it('所有供应商模型都引用已登记的通用模型标识', () => {
    expect(catalog.length).toBeGreaterThan(0)
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

  it('描述按通用模型解析，未适配的模型没有描述', () => {
    expect(getGenerationModelDescription('gpt-image-2')).toEqual(GENERATION_MODEL_DESCRIPTIONS['gpt-image-2'])
    expect(getGenerationModelDescription('seedream-4.5')).toEqual(
      GENERATION_MODEL_DESCRIPTIONS['seedream-4.5']
    )
    expect(getGenerationModelDescription('not-adapted')).toBeUndefined()
  })

  // 推荐表按通用模型标识登记，写错一个字就静默变成“一般可用”。
  it('推荐与过时登记只用已有的通用模型标识', () => {
    for (const id of listGenerationModelStandingIds()) {
      expect(GENERATION_MODEL_DESCRIPTIONS, id).toHaveProperty([id])
    }
  })
})
