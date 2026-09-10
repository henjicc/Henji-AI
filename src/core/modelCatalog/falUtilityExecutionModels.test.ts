import { describe, expect, it } from 'vitest'
import { isParamVisible } from '@/components/params/paramVisibility'

import {
  FAL_IMAGE_UTILITY_EXECUTION_MODELS,
  getFalImageUtilityExecutionModel,
} from './falUtilityExecutionModels'

describe('Fal 图片实用工具宿主展示', () => {
  it('三个固定比例单图工具隐藏自动画幅，其余工具不启用裁剪', () => {
    for (const model of FAL_IMAGE_UTILITY_EXECUTION_MODELS) {
      const aspect = model.params.find((param) => param.id === 'aspectRatio')
      if (aspect) {
        expect(model.sourceImageFraming).toEqual({ aspectParamId: aspect.id })
        expect(isParamVisible(aspect, { aspectRatio: '1:1' }, null)).toBe(false)
      } else {
        expect(model.sourceImageFraming).toBeUndefined()
      }
    }
  })
  it('完整组合五个隐藏工具的模型与参数展示', () => {
    expect(FAL_IMAGE_UTILITY_EXECUTION_MODELS).toHaveLength(5)
    expect(new Set(FAL_IMAGE_UTILITY_EXECUTION_MODELS.map((model) => model.meta.id)).size).toBe(5)

    for (const model of FAL_IMAGE_UTILITY_EXECUTION_MODELS) {
      expect(model.meta.provider, model.meta.id).toBe('fal')
      expect(model.meta.name, model.meta.id).toBeTruthy()
      expect(getFalImageUtilityExecutionModel(model.meta.id)).toBe(model)
      for (const param of model.params) {
        expect(param.name, `${model.meta.id}.${param.id}`).toBeTruthy()
        if (param.type === 'dropdown' || param.type === 'radio') {
          expect(param.options.every((option) => Boolean(option.label)), `${model.meta.id}.${param.id}`).toBe(true)
        }
      }
    }
  })

  it('保留标准单图输入限制，并且不会误解析普通模型', () => {
    expect(FAL_IMAGE_UTILITY_EXECUTION_MODELS.every((model) => {
      const limits = typeof model.inputLimits === 'function'
        ? model.inputLimits({})
        : model.inputLimits
      return limits?.images?.exact === 1
    })).toBe(true)
    expect(getFalImageUtilityExecutionModel('fal-control-light')).toBeUndefined()
    expect(getFalImageUtilityExecutionModel('fal-ai-gpt-image-2')).toBeUndefined()
  })
})
