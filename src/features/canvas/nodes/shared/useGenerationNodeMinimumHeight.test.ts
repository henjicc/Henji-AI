import { describe, expect, it } from 'vitest'

import {
  GENERATION_PROMPT_MIN_HEIGHT_PX,
  resolveGenerationNodeManualDimension,
  resolveGenerationNodeMinimumHeight,
} from './useGenerationNodeMinimumHeight'

describe('resolveGenerationNodeMinimumHeight', () => {
  it('没有参数行测量值时保留调用方配置的最低高度', () => {
    expect(resolveGenerationNodeMinimumHeight(160, 0)).toBe(160)
  })

  it('只用参数区与提示词固定下限计算高度，不接收提示词正文高度', () => {
    expect(resolveGenerationNodeMinimumHeight(160, 420)).toBe(
      GENERATION_PROMPT_MIN_HEIGHT_PX + 24 + 420,
    )
  })

  it('无提示词工具不为隐藏编辑器预留空白', () => {
    expect(resolveGenerationNodeMinimumHeight(0, 200, false)).toBe(218)
  })

  it('参数减少后自动收紧，旧测量高度不继续撑大默认节点', () => {
    expect(resolveGenerationNodeMinimumHeight(0, 86, false)).toBe(104)
    expect(resolveGenerationNodeMinimumHeight(0, 40, false)).toBe(58)
    expect(resolveGenerationNodeManualDimension(160, 104, false)).toBeNull()
    expect(resolveGenerationNodeManualDimension(220, 104, true)).toBe(220)
    expect(resolveGenerationNodeMinimumHeight(300, 86, false)).toBe(300)
  })

  it('过滤无效测量值并向上取整，避免亚像素裁切', () => {
    expect(resolveGenerationNodeMinimumHeight(160, 200.2)).toBe(325)
    expect(resolveGenerationNodeMinimumHeight(160, Number.NaN)).toBe(160)
  })
})

describe('resolveGenerationNodeManualDimension', () => {
  it('忽略内容展开留下的旧测量尺寸', () => {
    expect(resolveGenerationNodeManualDimension(780, 320, false)).toBeNull()
  })

  it('只在用户手动调整后保留尺寸，并继续服从当前内容下限', () => {
    expect(resolveGenerationNodeManualDimension(780, 320, true)).toBe(780)
    expect(resolveGenerationNodeManualDimension(260, 320, true)).toBe(320)
    expect(resolveGenerationNodeManualDimension(Number.NaN, 320, true)).toBeNull()
  })
})
