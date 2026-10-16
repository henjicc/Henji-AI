import { describe, expect, it, vi } from 'vitest'
import { CodeReuseProbe } from './videoEditCodeReuse'

describe('动态复用否定探针', () => {
  it('持续变化只读差异标量，停止/寻帧/原地修改时恢复精确比较', () => {
    const probe = new CodeReuseProbe()
    const serialize = vi.fn((value: unknown) => JSON.stringify(value))
    const value = { children: [{ x: 0, fill: [1, 0, 0, 1] }] }
    const signature = () => probe.signature(value, () => serialize(value))
    expect(signature()).toBe(JSON.stringify(value))
    value.children[0].x = 1; signature()
    for (let x = 2; x < 50; x++) { value.children[0].x = x; expect(signature()).toBeUndefined() }
    expect(serialize).toHaveBeenCalledTimes(2)
    expect(signature()).toBe(JSON.stringify(value))
    value.children[0].fill[1] += 1e-12
    expect(signature()).toBe(JSON.stringify(value))
    value.children[0].x = 0
    expect(signature()).toBe(JSON.stringify(value))
  })
  it('长度、结构、媒体类型、字体修订变化不产生相等证明', () => {
    const probe = new CodeReuseProbe()
    const inputs = [
      [1, [{ kind: 'text', blur: 0 }]], [1, [{ kind: 'text', blur: 1 }]],
      [1, [{ kind: 'text', blur: 2 }]], [1, [{ kind: 'image' }]],
      [2, []], [2, [{ kind: 'text', blur: 2 }]], [2, [{ kind: 'text', blur: 2 }]],
    ]
    for (const value of inputs) {
      const result = probe.signature(value, () => JSON.stringify(value))
      if (result !== undefined) expect(result).toBe(JSON.stringify(value))
    }
    expect(probe.signature(inputs[6], () => JSON.stringify(inputs[6]))).toBe(JSON.stringify(inputs[6]))
  })
  it('编辑器标识不进入视觉比较；极小变化仍可证明不相等', () => {
    const probe = new CodeReuseProbe()
    const sample = (x: number, id: string) => probe.signature([{ x, elementId: id }], () => JSON.stringify([{ x }]))
    expect(sample(1, 'a')).toBe(sample(1, 'b'))
    sample(1 + Number.EPSILON, 'c')
    expect(sample(1 + 2 * Number.EPSILON, 'd')).toBeUndefined()
  })
})
