import { describe, expect, it } from 'vitest'

import { createImageEditSparseMaskReferenceV3 } from '@/core/imageEdit/v3/layerTypes'
import { loadPreviewSparseMaskV3 } from './previewSparseMaskV3'

const MASK_TILE = `sha256:${'9'.repeat(64)}`

describe('ImageEditor V3 managed preview 稀疏蒙版合成', () => {
  it('只用已提供的 mask-float32 瓦片替换默认值区域', () => {
    const mask = {
      ...createImageEditSparseMaskReferenceV3('mask-preview', false, 1),
      tiles: { '0/0/0': MASK_TILE },
    }
    const values = Float32Array.from([0, 0.5])
    const result = loadPreviewSparseMaskV3(mask, new Map([[
      MASK_TILE,
      {
        resourceId: MASK_TILE,
        storage: 'mask-float32' as const,
        width: 2,
        height: 1,
        bytes: values.buffer,
      },
    ]]), { width: 4, height: 1, scaleX: 1, scaleY: 1 })

    expect([...result.data]).toEqual([0, 0.5, 1, 1])
  })

  it('拒绝把 RGBA 瓦片冒充蒙版读取', () => {
    const mask = {
      ...createImageEditSparseMaskReferenceV3('mask-preview', false, 0),
      tiles: { '0/0/0': MASK_TILE },
    }
    expect(() => loadPreviewSparseMaskV3(mask, new Map([[
      MASK_TILE,
      {
        resourceId: MASK_TILE,
        storage: 'rgba-float32' as const,
        width: 1,
        height: 1,
        bytes: new Float32Array(4).buffer,
      },
    ]]), { width: 1, height: 1, scaleX: 1, scaleY: 1 })).toThrow(/非蒙版/)
  })
})
