import { describe, expect, it } from 'vitest'
import {
  getResultImageSlotHeight,
  parseResultImageDimensions,
  resolveResultImageDimensions,
} from './resultImageDimensions'

describe('resultImageDimensions', () => {
  it('解析常见尺寸分隔符并拒绝无效值', () => {
    expect(parseResultImageDimensions('1024x768')).toEqual({ width: 1024, height: 768 })
    expect(parseResultImageDimensions('832*480')).toEqual({ width: 832, height: 480 })
    expect(parseResultImageDimensions('1080 × 1920')).toEqual({ width: 1080, height: 1920 })
    expect(parseResultImageDimensions({ width: 2048, height: 2048 })).toEqual({ width: 2048, height: 2048 })
    expect(parseResultImageDimensions('smart')).toBeNull()
    expect(parseResultImageDimensions('1024x0')).toBeNull()
  })

  it('按单图学习值、实际结果尺寸和请求尺寸的顺序解析', () => {
    const task = {
      dimensions: '1024x768',
      options: {
        size: '512x512',
        resultImageDimensions: [
          { width: 1536, height: 1024 },
          { width: 768, height: 1024 },
        ],
      },
    }

    expect(resolveResultImageDimensions(task, 0)).toEqual({ width: 1536, height: 1024 })
    expect(resolveResultImageDimensions(task, 1)).toEqual({ width: 768, height: 1024 })
    expect(resolveResultImageDimensions(task, 2)).toEqual({ width: 1024, height: 768 })
  })

  it('按结果图片的固定宽度计算生成状态占位高度', () => {
    expect(getResultImageSlotHeight({ width: 1024, height: 1024 })).toBe('16rem')
    expect(getResultImageSlotHeight({ width: 1920, height: 1080 })).toBe('9rem')
    expect(getResultImageSlotHeight(null)).toBeNull()
  })
})
