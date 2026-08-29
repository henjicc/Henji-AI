/** @vitest-environment jsdom */

import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { registry } from '@/core/ModelRegistry'
import type { ModelDefinition } from '@/core/types'

import PriceEstimate from './PriceEstimate'

const { readImageInfoMock } = vi.hoisted(() => ({
  readImageInfoMock: vi.fn(),
}))

vi.mock('@/commands/image', () => ({
  readImageInfo: readImageInfoMock,
}))

vi.mock('@/commands/video', () => ({
  readVideoInfo: vi.fn(),
}))

vi.mock('@/hooks/useI18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
    i18n: { language: 'en-US', resolvedLanguage: 'en-US' },
  }),
}))

const unitPriceModel: ModelDefinition = {
  meta: {
    id: 'unit-price-test', canonicalModelId: 'control-light', provider: 'fal', type: 'image',
    name: { zh: '单位价测试', en: 'Unit price test' }, tags: [],
  },
  inputLimits: { images: { max: 1 }, videos: { max: 0 }, audios: { max: 0 } },
  params: [],
  linkages: [],
  endpoints: '/test',
  request: { builder: (params) => params },
  pricing: {
    currency: '$',
    calculator: () => 0.03,
    estimateMode: 'unit',
    estimateUnit: 'MP',
    description: '$0.03/MP unit reference',
  },
}

const mediaPriceModel: ModelDefinition = {
  meta: {
    id: 'media-price-test', canonicalModelId: 'control-light', provider: 'fal', type: 'image',
    name: { zh: '媒体价格测试', en: 'Media price test' }, tags: [],
  },
  inputLimits: { images: { min: 1, max: 1 }, videos: { max: 0 }, audios: { max: 0 } },
  params: [{
    id: 'factor', type: 'number', order: 1, default: 2, min: 1, max: 4,
    name: { zh: '倍率', en: 'Factor' },
  }],
  linkages: [],
  endpoints: '/test',
  request: { builder: (params) => params },
  pricing: {
    currency: '$',
    calculator: (params) => Number(params.__outputMegapixels) * 0.01,
    mediaContext: [{
      targetParam: '__outputMegapixels',
      mediaType: 'image',
      metric: 'megapixels',
      multiplier: { kind: 'parameter', paramId: 'factor', fallback: 2, exponent: 2 },
    }],
  },
}

describe('PriceEstimate', () => {
  beforeEach(() => {
    registry.clear()
    registry.register(unitPriceModel)
    registry.register(mediaPriceModel)
    localStorage.clear()
    readImageInfoMock.mockReset()
    readImageInfoMock.mockResolvedValue({
      source: 'source.png',
      fileName: 'source.png',
      extension: '.png',
      width: 1000,
      height: 1000,
      orientation: null,
      hasAlpha: false,
      fileSizeBytes: 1000,
      createdAt: null,
      modifiedAt: null,
    })
  })

  afterEach(() => {
    cleanup()
    registry.clear()
  })

  it('单位参考价明确显示 /MP，不伪装成单次总价', () => {
    const rendered = render(
      <PriceEstimate providerId="fal" modelId={unitPriceModel.meta.id} params={{}} variant="badge" />,
    )

    expect(rendered.getByText('$0.03/MP')).toBeTruthy()
  })

  it('媒体指标未解析时不显示兜底价，解析后随放大倍率实时更新', async () => {
    const rendered = render(
      <PriceEstimate
        providerId="fal"
        modelId={mediaPriceModel.meta.id}
        params={{ images: ['source.png'], factor: 2 }}
        variant="badge"
      />,
    )

    expect(rendered.queryByText('$0.04')).toBeNull()
    expect(await rendered.findByText('$0.04')).toBeTruthy()

    rendered.rerender(
      <PriceEstimate
        providerId="fal"
        modelId={mediaPriceModel.meta.id}
        params={{ images: ['source.png'], factor: 4 }}
        variant="badge"
      />,
    )
    expect(await rendered.findByText('$0.16')).toBeTruthy()
    expect(readImageInfoMock).toHaveBeenCalledTimes(1)
  })
})
