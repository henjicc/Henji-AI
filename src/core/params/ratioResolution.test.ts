import { describe, expect, it } from 'vitest'

import type { ParamDef } from '@/core/types'
import { getSupportedAspectRatios, isAspectRatioChoiceParam } from './ratioResolution'

describe('模型宽高比候选提取', () => {
  it('忽略智能值并同时识别值和展示文案中的比例', () => {
    const params: ParamDef[] = [{
      id: 'size',
      type: 'dropdown',
      order: 1,
      name: { zh: '宽高比', en: 'Aspect ratio' },
      default: 'smart',
      options: [
        { value: 'smart', label: { zh: '智能', en: 'Smart' } },
        { value: 'portrait_4_3', label: { zh: '竖版 3:4', en: 'Portrait 3:4' } },
        { value: '4:5', label: '4:5' },
        { value: '1:1', label: '1:1' },
      ],
    }]

    expect(getSupportedAspectRatios(params)).toEqual([0.75, 0.8, 1])
  })

  it('不会把 registrationQuality 中的 ratio 子串误判成宽高比', () => {
    const quality: ParamDef = {
      id: 'registrationQuality',
      type: 'dropdown',
      order: 1,
      name: { zh: '对齐精度', en: 'Alignment quality' },
      default: 'precise',
      options: [
        { value: 'fast', label: 'Fast' },
        { value: 'precise', label: 'Precise' },
      ],
    }

    expect(isAspectRatioChoiceParam(quality)).toBe(false)
  })
})
