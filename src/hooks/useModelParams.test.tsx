/** @vitest-environment jsdom */

import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { registry } from '@/core/ModelRegistry'
import type { ModelDefinition } from '@/core/types'
import { useModelParams } from './useModelParams'

function createTestModel(
  id: string,
  ratioId: string,
  resolutionId: string,
  defaultResolution: string
): ModelDefinition {
  return {
    meta: {
      id,
      canonicalModelId: 'nano-banana',
      provider: 'test-provider',
      type: 'video',
      name: { zh: id, en: id },
      tags: ['text-to-video'],
    },
    params: [
      {
        id: ratioId,
        type: 'dropdown',
        order: 1,
        name: { zh: '宽高比', en: 'Aspect Ratio' },
        default: '16:9',
        options: [
          { value: '16:9', label: '16:9' },
          { value: '9:16', label: '9:16' },
        ],
      },
      {
        id: resolutionId,
        type: 'dropdown',
        order: 2,
        name: { zh: '分辨率', en: 'Resolution' },
        default: defaultResolution,
        options: [
          { value: '720p', label: '720p' },
          { value: '1080p', label: '1080p' },
        ],
      },
      {
        id: `${id}Audio`,
        type: 'switch',
        order: 3,
        name: { zh: '生成音频', en: 'Generate Audio' },
        default: false,
        apiField: 'audio',
      },
    ],
    linkages: [],
    endpoints: '/test',
    request: { builder: () => ({}) },
    pricing: { currency: '$', fixed: 0.1, description: '测试价格' },
  }
}

const sourceModel = createTestModel('param-transfer-source', 'sourceRatio', 'sourceResolution', '720p')
const targetModel = createTestModel('param-transfer-target', 'targetRatio', 'targetResolution', '1080p')

/*
 * 5.2：验证 useModelParams 改接 src/features/generation/domain/generationParams.ts
 * 之后，联动仍然在 setParam/getFilteredOptions 这两条路径上生效——这是对"内部改用纯函数，
 * 对外行为不变"的集成级验证，与 generationParams.test.ts 里对纯函数本身的单测互补。
 */
const linkedModel: ModelDefinition = {
  meta: {
    id: 'param-linkage-test',
    canonicalModelId: 'nano-banana',
    provider: 'test-provider',
    type: 'video',
    name: { zh: '联动测试模型', en: 'Linkage test model' },
    tags: ['text-to-video'],
  },
  params: [
    {
      id: 'mode',
      type: 'dropdown',
      order: 1,
      name: { zh: '模式', en: 'Mode' },
      default: 'basic',
      options: [
        { value: 'basic', label: 'Basic' },
        { value: 'pro', label: 'Pro' },
      ],
    },
    {
      id: 'quality',
      type: 'dropdown',
      order: 2,
      name: { zh: '质量', en: 'Quality' },
      default: 'standard',
      options: [
        { value: 'standard', label: 'Standard' },
        { value: 'high', label: 'High' },
      ],
    },
  ],
  linkages: [
    {
      trigger: 'mode',
      effect: 'setValue',
      target: 'quality',
      value: (triggerValue: DynamicValue) => (triggerValue === 'pro' ? 'high' : 'standard'),
    },
    {
      trigger: 'mode',
      effect: 'filterOptions',
      target: 'quality',
      filter: (triggerValue: DynamicValue, options: DynamicValue[]) => (
        triggerValue === 'pro' ? options : options.filter((option) => (option as { value: string }).value !== 'high')
      ),
    },
  ],
  endpoints: '/test',
  request: { builder: () => ({}) },
  pricing: { currency: '$', fixed: 0.1, description: '测试价格' },
}

describe('useModelParams 模型切换', () => {
  beforeEach(() => {
    registry.clear()
    registry.register(sourceModel)
    registry.register(targetModel)
  })

  afterEach(() => {
    registry.clear()
  })

  it('迁移用户修改的兼容参数，并保留目标模型未修改参数的默认值', async () => {
    const { result, rerender } = renderHook(
      ({ modelId }) => useModelParams(modelId),
      { initialProps: { modelId: sourceModel.meta.id } }
    )

    act(() => {
      result.current.setParam('sourceRatio', '9:16')
      result.current.setParam(`${sourceModel.meta.id}Audio`, true)
    })

    rerender({ modelId: targetModel.meta.id })

    await waitFor(() => {
      expect(result.current.params.targetRatio).toBe('9:16')
    })
    expect(result.current.params.targetResolution).toBe('1080p')
    expect(result.current.params[`${targetModel.meta.id}Audio`]).toBe(false)
    expect(result.current.params).not.toHaveProperty('sourceRatio')
  })
})

describe('useModelParams 联动（5.2：内部改接 generationParams.ts 纯函数）', () => {
  beforeEach(() => {
    registry.clear()
    registry.register(linkedModel)
  })

  afterEach(() => {
    registry.clear()
  })

  it('setParam 触发的联动会把依赖参数拉回合法值', () => {
    const { result } = renderHook(() => useModelParams(linkedModel.meta.id))

    act(() => {
      result.current.setParam('mode', 'pro')
    })
    expect(result.current.params.quality).toBe('high')

    act(() => {
      result.current.setParam('mode', 'basic')
    })
    expect(result.current.params.quality).toBe('standard')
  })

  it('getFilteredOptions 随联动参数变化返回过滤后的选项', () => {
    const { result } = renderHook(() => useModelParams(linkedModel.meta.id))

    expect(result.current.getFilteredOptions('quality')).toEqual([
      { value: 'standard', label: 'Standard' },
    ])

    act(() => {
      result.current.setParam('mode', 'pro')
    })
    expect(result.current.getFilteredOptions('quality')).toEqual([
      { value: 'standard', label: 'Standard' },
      { value: 'high', label: 'High' },
    ])
  })
})
