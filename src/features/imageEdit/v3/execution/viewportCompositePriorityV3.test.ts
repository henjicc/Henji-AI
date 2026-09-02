import { describe, expect, it } from 'vitest'

import { IMAGE_EDIT_RENDER_PRIORITY } from '@/core/imageEdit/v3/renderScheduler'
import type { ImageEditorViewportCompositeRequestV3 } from './viewportCompositeTypesV3'
import { resolveImageEditorViewportCompositePriorityV3 } from './viewportCompositePriorityV3'

const base = {
  quality: 'stable',
  coverage: 'viewport',
} as ImageEditorViewportCompositeRequestV3

describe('resolveImageEditorViewportCompositePriorityV3', () => {
  it('保证可见草稿高于目标、分析和整图后台任务', () => {
    expect(resolveImageEditorViewportCompositePriorityV3({
      ...base, phase: 'coarse', quality: 'draft',
    })).toBe(IMAGE_EDIT_RENDER_PRIORITY.interactionDraft)
    expect(resolveImageEditorViewportCompositePriorityV3({
      ...base, phase: 'target',
    })).toBe(IMAGE_EDIT_RENDER_PRIORITY.viewportStable)
    expect(resolveImageEditorViewportCompositePriorityV3({
      ...base, phase: 'analysis', coverage: 'document',
    })).toBe(IMAGE_EDIT_RENDER_PRIORITY.otherVisibleEditor)
    expect(resolveImageEditorViewportCompositePriorityV3({
      ...base, phase: 'coarse', coverage: 'document', quality: 'draft',
    })).toBe(IMAGE_EDIT_RENDER_PRIORITY.prefetch)
  })
})
