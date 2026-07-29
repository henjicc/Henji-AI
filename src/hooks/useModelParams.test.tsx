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
