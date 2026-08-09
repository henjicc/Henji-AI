import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { registry } from '@/core/ModelRegistry'
import type { ModelDefinition } from '@/core/types'

import { applyGenerationDraftPatch, createEmptyGenerationDraft } from './generationDraft'

const testModel: ModelDefinition = {
  meta: {
    id: 'generation-draft-test-model',
    canonicalModelId: 'nano-banana',
    provider: 'draft-test-provider',
    type: 'image',
    name: { zh: '草稿测试模型', en: 'Draft test model' },
    tags: [],
  },
  inputLimits: { images: { max: 1 }, videos: { max: 0 }, audios: { max: 0 } },
  params: [],
  linkages: [],
  endpoints: '/test',
  request: { builder: (params) => params },
  pricing: { currency: '$', fixed: 0.5, description: '测试模型基础价格' },
}

describe('generationDraft', () => {
  beforeEach(() => {
    registry.clear()
    registry.register(testModel)
  })

  afterEach(() => {
    registry.clear()
  })

  it('空 draft 默认选中注册中心的第一个供应商/模型，其余字段为空', () => {
    const draft = createEmptyGenerationDraft()
    expect(draft.selectedProvider).toBe('draft-test-provider')
    expect(draft.selectedModel).toBe('generation-draft-test-model')
    expect(draft.uploadedPromptImages).toEqual([])
    expect(draft.uploadedFilePaths).toEqual([])
    expect(draft.fileOrder).toEqual([])
    expect(draft.uploadedVideoDuration).toBe(0)
    expect(draft.uploadedVideoTrimStart).toBeNull()
    expect(draft.uploadedVideoTrimEnd).toBeNull()
    expect(draft.modelFilterProvider).toBe('all')
    expect(draft.modelFilterType).toBe('all')
    expect(draft.modelFilterFunction).toBe('all')
    expect(draft.favoriteModels.size).toBe(0)
    expect(draft.promptDocument).toEqual({ version: 1, type: 'doc', content: [{ type: 'paragraph' }] })
  })

  it('没有任何已注册模型时默认选中回落为空字符串', () => {
    registry.clear()
    const draft = createEmptyGenerationDraft()
    expect(draft.selectedProvider).toBe('')
    expect(draft.selectedModel).toBe('')
  })

  it('patch 只改动列出的字段，不影响其他字段（不可变更新）', () => {
    const draft = createEmptyGenerationDraft()
    const patched = applyGenerationDraftPatch(draft, { selectedModel: 'other-model' })

    expect(patched.selectedModel).toBe('other-model')
    expect(patched.selectedProvider).toBe(draft.selectedProvider)
    expect(patched).not.toBe(draft)
    expect(draft.selectedModel).toBe('generation-draft-test-model')
  })

  it('patch 可以一次改动多个字段', () => {
    const draft = createEmptyGenerationDraft()
    const patched = applyGenerationDraftPatch(draft, {
      uploadedFilePaths: ['/a.png'],
      fileOrder: [{ type: 'image', index: 0 }],
    })

    expect(patched.uploadedFilePaths).toEqual(['/a.png'])
    expect(patched.fileOrder).toEqual([{ type: 'image', index: 0 }])
    expect(draft.uploadedFilePaths).toEqual([])
    expect(draft.fileOrder).toEqual([])
  })

  it('空 patch 返回一个内容相等但不同引用的新对象', () => {
    const draft = createEmptyGenerationDraft()
    const patched = applyGenerationDraftPatch(draft, {})
    expect(patched).toEqual(draft)
    expect(patched).not.toBe(draft)
  })
})
