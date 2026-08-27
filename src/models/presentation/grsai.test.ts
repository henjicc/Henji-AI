import { describe, expect, it } from 'vitest'

import { grsaiPresentation } from './grsai'

describe('src/models/presentation/grsai 展示补丁', () => {
  it('Nano Banana Pro：渠道切到 VIP 时分辨率选项联动过滤掉 4K', () => {
    const linkages = grsaiPresentation['grsai-nano-banana-pro'].linkages
    const linkage = linkages?.find((item) => item.effect === 'filterOptions')
    expect(linkage).toBeTruthy()
    const options = [
      { value: '1K', label: '1K' },
      { value: '2K', label: '2K' },
      { value: '4K', label: '4K' },
    ]
    const filtered = linkage && linkage.effect === 'filterOptions' ? linkage.filter('vip', options, {}) : []
    expect(filtered.map((option) => option.value)).toEqual(['1K', '2K'])
  })
})
