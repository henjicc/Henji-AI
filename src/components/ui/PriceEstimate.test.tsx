/** @vitest-environment jsdom */

import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { registry } from '@/core/ModelRegistry'
import type { ModelDefinition } from '@/core/types'

import PriceEstimate from './PriceEstimate'

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

describe('PriceEstimate', () => {
  beforeEach(() => {
    registry.clear()
    registry.register(unitPriceModel)
    localStorage.clear()
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
})
