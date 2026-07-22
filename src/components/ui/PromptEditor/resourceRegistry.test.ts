import { describe, expect, it, vi } from 'vitest'

import { PromptEditorResourceRegistry } from './resourceRegistry'
import type { PromptReferenceItem } from './types'

const IMAGE_A: PromptReferenceItem = {
  resourceId: 'asset:a',
  mediaType: 'image',
  label: '图1',
}

describe('PromptEditorResourceRegistry', () => {
  it('按稳定 ID 解析引用，不受数组重排和动态标签影响', () => {
    const imageB: PromptReferenceItem = {
      resourceId: 'asset:b',
      mediaType: 'image',
      label: '图2',
    }
    const registry = new PromptEditorResourceRegistry({
      references: [IMAGE_A, imageB],
      variables: [],
    })

    registry.update({
      references: [imageB, { ...IMAGE_A, label: '图2' }],
      variables: [],
    })

    expect(registry.resolveReference('asset:a')?.label).toBe('图2')
  })

  it('默认候选过滤并限制八项', async () => {
    const references = Array.from({ length: 12 }, (_, index): PromptReferenceItem => ({
      resourceId: `asset:${index}`,
      mediaType: 'image',
      label: `参考图 ${index}`,
    }))
    const registry = new PromptEditorResourceRegistry({ references, variables: [] })

    await expect(registry.getReferenceSuggestions('参考')).resolves.toHaveLength(8)
  })

  it('支持业务候选 provider 且不改写其稳定身份', async () => {
    const provider = vi.fn(async () => [IMAGE_A])
    const registry = new PromptEditorResourceRegistry({
      references: [],
      variables: [],
      getReferenceSuggestions: provider,
    })

    await expect(registry.getReferenceSuggestions('图')).resolves.toEqual([IMAGE_A])
    expect(provider).toHaveBeenCalledWith('图')
  })
})
