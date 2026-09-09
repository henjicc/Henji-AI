import { describe, expect, it } from 'vitest'

import { relightDirectionFromPoint } from './relightDirectionVisualizerState'

describe('打光方向可视化映射', () => {
  it('把中心与四个方向区域映射到模型支持的五档方向', () => {
    expect(relightDirectionFromPoint({ x: 0.1, y: -0.1 })).toBe('none')
    expect(relightDirectionFromPoint({ x: -0.7, y: 0.2 })).toBe('left')
    expect(relightDirectionFromPoint({ x: 0.7, y: -0.2 })).toBe('right')
    expect(relightDirectionFromPoint({ x: 0.2, y: -0.7 })).toBe('top')
    expect(relightDirectionFromPoint({ x: -0.2, y: 0.7 })).toBe('bottom')
  })

})
