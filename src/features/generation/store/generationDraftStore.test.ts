// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { registry } from '@/core/ModelRegistry'
import type { ModelDefinition } from '@/core/types'

import { createEmptyGenerationDraft } from '../domain/generationDraft'
import { useGenerationDraftStore } from './generationDraftStore'

const testModel: ModelDefinition = {
  meta: {
    id: 'generation-draft-store-test-model',
    canonicalModelId: 'nano-banana',
    provider: 'draft-store-test-provider',
    type: 'image',
    name: { zh: '草稿 store 测试模型', en: 'Draft store test model' },
    tags: [],
  },
  inputLimits: { images: { max: 1 }, videos: { max: 0 }, audios: { max: 0 } },
  params: [],
  linkages: [],
  endpoints: '/test',
  request: { builder: (params) => params },
  pricing: { currency: '$', fixed: 0.5, description: '测试模型基础价格' },
}

function resetStore(): void {
  useGenerationDraftStore.setState({ draft: createEmptyGenerationDraft() })
}

describe('generationDraftStore（5.3）', () => {
  beforeEach(() => {
    registry.clear()
    registry.register(testModel)
    resetStore()
  })

  afterEach(() => {
    registry.clear()
    resetStore()
  })

  it('patchField 写入单个字段，直接值形式', () => {
    useGenerationDraftStore.getState().patchField('selectedModel', 'other-model')
    expect(useGenerationDraftStore.getState().draft.selectedModel).toBe('other-model')
  })

  it('patchField 支持更新函数形式，且能读到最新值（不是过期闭包）', () => {
    useGenerationDraftStore.getState().patchField('fileOrder', [{ type: 'image', index: 0 }])
    useGenerationDraftStore.getState().patchField('fileOrder', (prev) => [...prev, { type: 'video', index: 1 }])
    expect(useGenerationDraftStore.getState().draft.fileOrder).toEqual([
      { type: 'image', index: 0 },
      { type: 'video', index: 1 },
    ])
  })

  it('patchField 新旧值引用相等时不产生新的 draft 对象', () => {
    const before = useGenerationDraftStore.getState().draft
    useGenerationDraftStore.getState().patchField('selectedModel', before.selectedModel)
    expect(useGenerationDraftStore.getState().draft).toBe(before)
  })

  it('patch 一次改动多个字段', () => {
    useGenerationDraftStore.getState().patch({
      uploadedFilePaths: ['/a.png'],
      modelFilterType: 'favorite',
    })
    const draft = useGenerationDraftStore.getState().draft
    expect(draft.uploadedFilePaths).toEqual(['/a.png'])
    expect(draft.modelFilterType).toBe('favorite')
  })

  it('reset 回到默认 draft', () => {
    useGenerationDraftStore.getState().patch({ selectedModel: 'other-model', uploadedFilePaths: ['/a.png'] })
    useGenerationDraftStore.getState().reset()
    const draft = useGenerationDraftStore.getState().draft
    expect(draft.selectedModel).toBe('generation-draft-store-test-model')
    expect(draft.uploadedFilePaths).toEqual([])
  })

  it('patchUploadedImages 按新增 url 生成带 resourceId 的图片项，并保留已有项的 id', () => {
    useGenerationDraftStore.getState().patchUploadedImages(['a.png', 'b.png'])
    const firstPass = useGenerationDraftStore.getState().draft.uploadedPromptImages
    expect(firstPass.map((image) => image.url)).toEqual(['a.png', 'b.png'])
    const idsAfterFirstPass = firstPass.map((image) => image.resourceId)

    // 更新函数形式：在现有基础上追加一个 url，已有两项的 resourceId 应该保持不变
    useGenerationDraftStore.getState().patchUploadedImages((prev) => [...prev, 'c.png'])
    const secondPass = useGenerationDraftStore.getState().draft.uploadedPromptImages
    expect(secondPass.map((image) => image.url)).toEqual(['a.png', 'b.png', 'c.png'])
    expect(secondPass.slice(0, 2).map((image) => image.resourceId)).toEqual(idsAfterFirstPass)
  })

  it('setLegacyInput 把旧版文本解析进 promptDocument', () => {
    useGenerationDraftStore.getState().setLegacyInput('一段测试提示词')
    const document = useGenerationDraftStore.getState().draft.promptDocument
    expect(document.type).toBe('doc')
    expect(JSON.stringify(document)).toContain('一段测试提示词')
  })

  it('loadPromptCarrier 一次性替换图片与提示词文档', () => {
    useGenerationDraftStore.getState().loadPromptCarrier({ legacyText: '带图 @图1', legacyImages: ['x.png'] })
    const draft = useGenerationDraftStore.getState().draft
    expect(draft.uploadedPromptImages.map((image) => image.url)).toEqual(['x.png'])
    expect(draft.promptDocument.type).toBe('doc')
  })
})
