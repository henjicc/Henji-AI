import { describe, expect, it } from 'vitest'

import { nodeConverter } from './NodeConverter'
import { getModelTypeGroup, getModelTypeOrder, isBuiltinModelType } from './modelSortOrder'
import { resolveProgressSpec } from './progress/progressTracker'
import type { ModelDefinition } from './types'

describe('应用侧扩展模型类型降级', () => {
  it('未知类型归到“其他”且稳定排在内置类型之后', () => {
    expect(getModelTypeGroup('transcript')).toBe('other')
    expect(getModelTypeOrder('transcript')).toBeGreaterThan(getModelTypeOrder('audio'))
    expect(isBuiltinModelType('transcript')).toBe(false)
  })

  it('三个内置类型仍保持原顺序与类型守卫', () => {
    expect(['image', 'video', 'audio'].map(getModelTypeOrder)).toEqual([0, 1, 2])
    expect(['image', 'video', 'audio'].every(isBuiltinModelType)).toBe(true)
  })

  it('画布旧转换入口跳过未知类型且不抛错', () => {
    const unknownModel = {
      meta: { id: 'test-transcript-model', type: 'transcript' },
    } as ModelDefinition

    expect(() => nodeConverter.modelToNode(unknownModel)).not.toThrow()
    expect(nodeConverter.modelToNode(unknownModel)).toBeNull()
  })

  it('未知类型的进度估算使用中性默认值，不套用图片/视频/音频启发式', () => {
    const unknownModel = {
      meta: { id: 'test-transcript-model', type: 'transcript' },
    } as ModelDefinition

    expect(resolveProgressSpec(unknownModel, { text: 'x'.repeat(1000) })?.expectedDurationMs).toBe(60_000)
  })
})
