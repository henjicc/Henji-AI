import { describe, expect, it } from 'vitest'

import { evaluateCondition } from './conditionEvaluator'

describe('evaluateCondition', () => {
  it('保留旧入口把空条件视为可用的兼容语义', () => {
    expect(evaluateCondition(undefined, {})).toBe(true)
    expect(evaluateCondition('', {})).toBe(true)
  })

  it('委托 SDK 受限表达式入口并保留 context 覆盖 params 的语义', () => {
    expect(evaluateCondition('mode === "edit"', { mode: 'view' }, { mode: 'edit' })).toBe(true)
    expect(evaluateCondition('mode === "edit" && images.length > 0', {
      mode: 'edit',
      images: ['image.png'],
    })).toBe(true)
  })

  it('继续支持函数条件', () => {
    expect(evaluateCondition((params) => params.mode === 'edit', { mode: 'edit' })).toBe(true)
  })

  it('非法表达式保持应用层兼容行为：记录错误并返回 false', () => {
    expect(evaluateCondition('globalThis.fetch()', {})).toBe(false)
  })
})
