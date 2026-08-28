import { describe, expect, it } from 'vitest'

import {
  catalog,
  compileRuntimeCondition,
  createAIClient,
  evaluateRuntimeCondition,
  getRuntimeMediaInputContract,
  type JsonObject,
  type RuntimeConditionExpression,
  type RuntimeConditionFunction,
  type RuntimeContext,
} from '../src'
import { renderMinimalModelForm } from '../examples/form-renderer'

const runtime: RuntimeContext = {
  transport: {
    fetch: async () => {
      throw new Error('Catalog contract tests must not access the network')
    },
  },
  credentials: { get: async () => undefined },
  media: {
    read: async () => {
      throw new Error('Catalog contract tests must not read media')
    },
  },
}

function defaultValues(modelId: string): JsonObject {
  const model = catalog.find((candidate) => candidate.meta.id === modelId)
  if (!model) throw new Error(`Unknown test model ${modelId}`)
  return {
    ...Object.fromEntries(model.params.map((param) => [param.id, param.default])),
    uploadedFilePaths: [],
    uploadedVideoFilePaths: [],
    uploadedAudioFilePaths: [],
    images: [],
    videos: [],
    audios: [],
    uploadedImages: [],
    uploadedVideos: [],
    uploadedAudios: [],
  } as JsonObject
}

function collectCatalogConditions(): Array<{
  modelId: string
  condition: RuntimeConditionExpression | RuntimeConditionFunction
}> {
  const conditions: Array<{
    modelId: string
    condition: RuntimeConditionExpression | RuntimeConditionFunction
  }> = []
  for (const model of catalog) {
    for (const param of model.params) {
      if (param.visible?.condition) conditions.push({ modelId: model.meta.id, condition: param.visible.condition })
      if (param.disabled?.condition) conditions.push({ modelId: model.meta.id, condition: param.disabled.condition })
    }
    const params = defaultValues(model.meta.id)
    const inputLimits = typeof model.inputLimits === 'function'
      ? model.inputLimits(params)
      : model.inputLimits
    for (const rule of inputLimits?.rules ?? []) {
      if (rule.when) conditions.push({ modelId: model.meta.id, condition: rule.when })
    }
    for (const requirement of model.requirements ?? []) {
      if (requirement.when) conditions.push({ modelId: model.meta.id, condition: requirement.when })
    }
  }
  return conditions
}

describe('catalog consumer contract', () => {
  it('锁定真实 101 catalog 的 RuntimeParamDef type、数量与实际字段集合', () => {
    const rows = new Map<string, { count: number; fields: Set<string> }>()
    for (const model of catalog) {
      for (const param of model.params) {
        const row = rows.get(param.type) ?? { count: 0, fields: new Set<string>() }
        row.count += 1
        for (const field of Object.keys(param)) row.fields.add(field)
        rows.set(param.type, row)
      }
    }

    expect(Object.fromEntries([...rows.entries()].sort().map(([type, row]) => [type, {
      count: row.count,
      fields: [...row.fields].sort(),
    }]))).toEqual({
      composite: {
        count: 4,
        fields: ['default', 'id', 'order', 'type', 'valueType'],
      },
      dropdown: {
        count: 293,
        fields: ['apiField', 'default', 'id', 'options', 'order', 'required', 'type', 'valueType', 'visible'],
      },
      'file-upload': {
        count: 1,
        fields: ['accept', 'default', 'id', 'maxCount', 'maxSize', 'order', 'type', 'valueType'],
      },
      'image-upload': {
        count: 5,
        fields: ['accept', 'default', 'format', 'id', 'maxCount', 'maxSize', 'order', 'type', 'valueType', 'visible'],
      },
      number: {
        count: 79,
        fields: ['apiField', 'default', 'id', 'max', 'min', 'order', 'step', 'type', 'valueType', 'visible'],
      },
      switch: {
        count: 90,
        fields: ['apiField', 'default', 'id', 'order', 'type', 'valueType', 'visible'],
      },
      text: {
        count: 7,
        fields: ['default', 'id', 'order', 'type', 'visible'],
      },
      textarea: {
        count: 3,
        fields: ['default', 'id', 'order', 'type'],
      },
    })
  })

  it('client.catalog 的 6 个公开查询函数直接消费真实 101 catalog', () => {
    const client = createAIClient({ runtime })
    try {
      expect(client.catalog.listByType('image')).toHaveLength(51)
      expect(client.catalog.listByType('video')).toHaveLength(49)
      expect(client.catalog.listByProvider('fal')).toHaveLength(33)
      expect(client.catalog.listByProvider('volcengine')).toHaveLength(2)
      expect(client.catalog.listByTag('voice-cloning').map((model) => model.meta.id))
        .toEqual(['ppio-minimax-speech'])

      expect(client.catalog.getDefaultValues('volcengine-seedream-5.0-lite')).toEqual({
        volcengineSeedream50LiteAspectRatio: 'smart',
        volcengineSeedream50LiteResolution: '2K',
        volcengineSeedream50LiteCount: 1,
      })
      expect(client.catalog.getDefaultValues('apimart-gemini-omni-flash-ext'))
        .toMatchObject({ apimartGeminiOmniFlashChannel: 'ext' })
      expect(client.catalog.getParams('ppio-minimax-speech').map((param) => param.type))
        .toEqual(['dropdown', 'composite', 'dropdown', 'dropdown', 'composite', 'composite'])
      expect(client.catalog.estimatePrice('volcengine-seedream-5.0-lite')).toBeCloseTo(0.22)
      expect(client.catalog.estimatePrice('volcengine-seedream-5.0-lite', {
        volcengineSeedream50LiteCount: 3,
      })).toBeCloseTo(0.66)
    } finally {
      client.dispose()
    }
  })

  it('编译并执行真实 catalog 的全部 152 条显隐/inputLimits/requirement 条件', () => {
    const conditions = collectCatalogConditions()
    const stringConditions = conditions.filter((item) => typeof item.condition === 'string')
    const functionConditions = conditions.filter((item) => typeof item.condition === 'function')

    expect(conditions).toHaveLength(152)
    expect(stringConditions).toHaveLength(121)
    expect(functionConditions).toHaveLength(31)

    for (const { modelId, condition } of conditions) {
      if (typeof condition === 'string') expect(() => compileRuntimeCondition(condition)).not.toThrow()
      expect(() => evaluateRuntimeCondition(condition, defaultValues(modelId))).not.toThrow()
    }
  })

  it('受限表达式按真实语义求值，并明确拒绝未知 token、属性与调用', () => {
    const complex = '(typeof uploadedVideoFilePaths !== "undefined" && Array.isArray(uploadedVideoFilePaths) && uploadedVideoFilePaths.length > 0) || (typeof videos !== "undefined" && Array.isArray(videos) && videos.length > 0)'
    expect(evaluateRuntimeCondition(complex, { uploadedVideoFilePaths: [] })).toBe(false)
    expect(evaluateRuntimeCondition(complex, { uploadedVideoFilePaths: ['clip.mp4'] })).toBe(true)
    expect(evaluateRuntimeCondition('mode === "edit" && images.length > 0', {
      mode: 'edit',
      images: ['image.png'],
    })).toBe(true)

    expect(() => compileRuntimeCondition('mode = "edit"')).toThrow(/Unsupported token/)
    expect(() => compileRuntimeCondition('params.constructor')).toThrow(/Unsupported property/)
    expect(() => compileRuntimeCondition('globalThis.fetch()')).toThrow(/Unsupported call/)
    expect(() => compileRuntimeCondition('true; globalThis.fetch()')).toThrow(/Unsupported token/)
    expect(() => evaluateRuntimeCondition('images.length > 0', {})).toThrow(/requires an array or string/)
  })

  it('从 inputLimits、上传参数类型和 runtime mediaFields 形成无 URL 输入框的媒体契约', () => {
    const midjourney = catalog.find((model) => model.meta.id === 'apimart-midjourney')!
    const midjourneyMedia = getRuntimeMediaInputContract(
      midjourney,
      defaultValues(midjourney.meta.id)
    )
    expect(midjourneyMedia.genericInputs).toEqual([
      expect.objectContaining({ id: 'uploadedFilePaths', kind: 'image' }),
    ])
    expect(midjourneyMedia.paramInputs.map((input) => [input.id, input.kind])).toEqual([
      ['apimartMidjourneyCharacterReference', 'image'],
      ['apimartMidjourneyStyleReference', 'image'],
      ['apimartMidjourneyDepthReference', 'image'],
    ])
    expect(midjourneyMedia.runtimeFields).toEqual([
      { field: 'cref', kind: 'image' },
      { field: 'sref', kind: 'image' },
      { field: 'dref', kind: 'image' },
    ])

    const pdfModel = catalog.find((model) => model.meta.id === 'fal-ai-nano-banana-2')!
    const pdfMedia = getRuntimeMediaInputContract(pdfModel, defaultValues(pdfModel.meta.id))
    expect(pdfMedia.paramInputs).toEqual([
      expect.objectContaining({ id: 'falNanoBanana2PdfUrl', kind: 'file' }),
    ])
    expect(pdfMedia.runtimeFields).toEqual([{ field: 'pdf_url', kind: 'file' }])
  })

  it('最小 renderer 用 5 个真实差异模型覆盖下拉/范围/显隐/媒体/composite', () => {
    const client = createAIClient({ runtime })
    try {
      const simple = renderMinimalModelForm(client, 'volcengine-seedream-5.0-lite')
      expect(simple.controls.map((control) => control.kind)).toEqual([
        'select', 'select', 'number', 'upload',
      ])

      const conditional = renderMinimalModelForm(client, 'apimart-gemini-omni-flash')
      expect(conditional.controls.map((control) => control.id)).toContain('apimartGeminiOmniFlashOfficialDuration')
      expect(conditional.controls.map((control) => control.id)).not.toContain('apimartGeminiOmniFlashExtDuration')
      const alternate = renderMinimalModelForm(client, 'apimart-gemini-omni-flash', {
        apimartGeminiOmniFlashChannel: 'ext',
      })
      expect(alternate.controls.map((control) => control.id)).toContain('apimartGeminiOmniFlashExtDuration')
      expect(alternate.controls.map((control) => control.id)).not.toContain('apimartGeminiOmniFlashOfficialDuration')

      const rangeAndRules = renderMinimalModelForm(client, 'ppio-wan-2.7')
      expect(rangeAndRules.controls).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'ppioWan27Duration', kind: 'number' }),
        expect.objectContaining({ id: 'uploadedFilePaths', kind: 'upload', mediaKind: 'image' }),
        expect.objectContaining({ id: 'uploadedVideoFilePaths', kind: 'upload', mediaKind: 'video' }),
        expect.objectContaining({ id: 'uploadedAudioFilePaths', kind: 'upload', mediaKind: 'audio' }),
      ]))

      const media = renderMinimalModelForm(client, 'apimart-midjourney')
      expect(media.html).toContain('data-media-kind="image"')
      expect(media.controls.filter((control) => control.source === 'param' && control.kind === 'upload'))
        .toHaveLength(3)

      const composite = renderMinimalModelForm(client, 'ppio-minimax-speech')
      expect(composite.customControlIds).toEqual([
        'minimaxVoiceId',
        'minimaxAdvancedSettings',
        'minimaxVoiceClonePanel',
      ])
      expect(composite.html).toContain('data-control="custom"')
    } finally {
      client.dispose()
    }
  })
})
