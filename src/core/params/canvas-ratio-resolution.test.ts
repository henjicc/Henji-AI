import { describe, expect, it } from 'vitest'
import { catalog } from '@henjicc/ai-sdk'

import { composeModelDefinition } from '@/core/composeModelDefinition'
import { modelPresentations } from '@/models/presentation'

const models = catalog.map((runtimeModel) =>
  composeModelDefinition(runtimeModel, modelPresentations[runtimeModel.meta.id])
)

describe('画布模型参数', () => {
  it('所有模型都将比例与分辨率声明为独立参数', () => {
    const compositeResolutionModels = models
      .filter((model) => model.params.some((param) => param.type === 'composite' && param.panel === 'resolution'))
      .map((model) => model.meta.id)

    expect(compositeResolutionModels).toEqual([])
  })
})
