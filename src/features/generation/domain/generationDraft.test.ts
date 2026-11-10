import { describe, expect, it } from 'vitest'

import { applyGenerationDraftPatch, createEmptyGenerationDraft } from './generationDraft'

describe('generationDraft', () => {
  it('空 draft 不选模型，其余字段为空', () => {
    const draft = createEmptyGenerationDraft()
    expect(draft.selectedProvider).toBe('')
    expect(draft.selectedModel).toBe('')
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

  it('patch 只改动列出的字段，不影响其他字段（不可变更新）', () => {
    const draft = createEmptyGenerationDraft()
    const patched = applyGenerationDraftPatch(draft, { selectedModel: 'other-model' })

    expect(patched.selectedModel).toBe('other-model')
    expect(patched.selectedProvider).toBe(draft.selectedProvider)
    expect(patched).not.toBe(draft)
    expect(draft.selectedModel).toBe('')
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
