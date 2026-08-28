import { describe, expect, it } from 'vitest'

import { composeModelDefinition } from '@/core/composeModelDefinition'
import type { ImageUploadParamDef } from '@/core/types/ParamDef'
import { apimartPresentation } from '@/models/presentation/apimart'
import { falPresentation } from '@/models/presentation/fal'
import { catalog } from '@henjicc/ai-sdk'

const MASK_MODELS = [
  {
    modelId: 'apimart-gpt-image-2',
    paramId: 'apimartGptImage2MaskUrl',
    presentation: apimartPresentation,
  },
  {
    modelId: 'fal-ai-gpt-image-2',
    paramId: 'falGptImage2MaskUrl',
    presentation: falPresentation,
  },
] as const

describe('派生媒体展示契约', () => {
  it.each(MASK_MODELS)('$modelId 的遮罩参数透传统一创作契约', ({
    modelId,
    paramId,
    presentation,
  }) => {
    const runtime = catalog.find((candidate) => candidate.meta.id === modelId)
    if (!runtime) throw new Error(`SDK catalog 缺少模型: ${modelId}`)

    const model = composeModelDefinition(runtime, presentation[modelId])
    const param = model.params.find((candidate) => candidate.id === paramId)
    expect(param?.type).toBe('image-upload')

    const imageParam = param as ImageUploadParamDef
    expect(imageParam.derivedMediaAuthoring).toEqual({
      kind: 'mask',
      source: { kind: 'first-image' },
      editor: { kind: 'mask' },
      output: {
        format: 'png',
        maskEncoding: 'alpha',
        dimensions: 'source',
        paintMeaning: 'transparent-edit',
      },
      onSourceChange: 'invalidate',
      actions: {
        create: { zh: '绘制', en: 'Draw' },
        edit: { zh: '编辑', en: 'Edit' },
      },
    })
  })

  it.each(MASK_MODELS)('$modelId 同时保留助手 description 与用户 tooltip', ({
    modelId,
    paramId,
    presentation,
  }) => {
    const runtime = catalog.find((candidate) => candidate.meta.id === modelId)
    if (!runtime) throw new Error(`SDK catalog 缺少模型: ${modelId}`)

    const model = composeModelDefinition(runtime, presentation[modelId])
    const param = model.params.find((candidate) => candidate.id === paramId)

    expect(param?.description).toMatchObject({
      zh: expect.stringContaining('定义'),
      en: expect.stringContaining('Defines'),
    })
    expect(param?.tooltip).toMatchObject({
      zh: expect.stringContaining('绘制'),
      en: expect.stringContaining('Draw'),
    })
    expect(param?.description).not.toEqual(param?.tooltip)
  })
})
