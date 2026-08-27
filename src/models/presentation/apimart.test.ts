import { describe, expect, it } from 'vitest'

import { composeModelDefinition } from '@/core/composeModelDefinition'
import { LinkageEngine } from '@/core/linkage/LinkageEngine'
import { apimartPresentation } from '@/models/presentation/apimart'
import { catalog } from '@henjicc/ai-sdk'

function runtimeModel(modelId: string) {
  const model = catalog.find((candidate) => candidate.meta.id === modelId)
  if (!model) throw new Error(`SDK catalog 缺少模型: ${modelId}`)
  return model
}

const apimartGrokImagine20Runtime = runtimeModel('apimart-grok-imagine-2.0')
const apimartMidjourneyRuntime = runtimeModel('apimart-midjourney')

const apimartMidjourneyModel = composeModelDefinition(
  apimartMidjourneyRuntime,
  apimartPresentation[apimartMidjourneyRuntime.meta.id],
)
const apimartGrokImagine20Model = composeModelDefinition(
  apimartGrokImagine20Runtime,
  apimartPresentation[apimartGrokImagine20Runtime.meta.id],
)

describe('APIMart 应用展示定义', () => {
  it('Midjourney 把通用参数留在顶层，并按版本与输入联动专属参数', () => {
    const groupedIds = apimartMidjourneyModel.paramPresentation?.groups
      .flatMap((group) => group.sections)
      .flatMap((section) => section.paramIds) ?? []
    expect(groupedIds).not.toContain('apimartMidjourneyAspectRatio')
    expect(groupedIds).not.toContain('apimartMidjourneySpeed')
    expect(groupedIds).not.toContain('apimartMidjourneyQuality')
    expect(groupedIds).not.toContain('apimartMidjourneyRepeat')
    expect(groupedIds).toContain('apimartMidjourneyVersion')

    const linkage = new LinkageEngine(apimartMidjourneyModel.linkages ?? [])
    expect(linkage.getFilteredOptions('apimartMidjourneyVersion', {
      apimartMidjourneyNiji: true,
      apimartMidjourneyVersion: '7'
    }, apimartMidjourneyModel.params).map((option) => option.value)).toEqual(['auto', '7', '6'])
    expect(linkage.isParamHidden('apimartMidjourneyImageWeight', { images: [] })).toBe(true)
    expect(linkage.isParamHidden('apimartMidjourneyImageWeight', { images: ['input.png'] })).toBe(false)
    expect(linkage.isParamHidden('apimartMidjourneyHd', {
      apimartMidjourneyNiji: false,
      apimartMidjourneyVersion: '7'
    })).toBe(true)
  })

  it('Grok 按渠道联动比例与输出数量', () => {
    const linkageEngine = new LinkageEngine(apimartGrokImagine20Model.linkages ?? [])
    const officialRatios = linkageEngine.getFilteredOptions(
      'apimartGrokImagine20AspectRatio',
      { apimartGrokImagine20Version: 'official' },
      apimartGrokImagine20Model.params
    )
    const extRatios = linkageEngine.getFilteredOptions(
      'apimartGrokImagine20AspectRatio',
      { apimartGrokImagine20Version: 'ext' },
      apimartGrokImagine20Model.params
    )
    expect(officialRatios.map((option) => option.value)).toContain('19.5:9')
    expect(extRatios.map((option) => option.value)).not.toContain('19.5:9')
    expect(linkageEngine.getFilteredRange(
      'apimartGrokImagine20Count',
      { apimartGrokImagine20Version: 'official' },
      apimartGrokImagine20Model.params
    )?.max).toBe(10)
    expect(linkageEngine.execute('apimartGrokImagine20Version', {
      apimartGrokImagine20Version: 'official',
      apimartGrokImagine20AspectRatio: '1:1',
      apimartGrokImagine20Count: 12
    }, apimartGrokImagine20Model.params)).toMatchObject({ apimartGrokImagine20Count: 10 })
  })
})
