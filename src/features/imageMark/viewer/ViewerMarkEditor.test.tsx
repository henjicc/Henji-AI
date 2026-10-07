/** @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createEmptyImageEditDocument } from '@/core/imageEdit'
import { ViewerMarkEditor } from './ViewerMarkEditor'

vi.mock('@/features/imageEdit/editor/ImageEditor', () => ({
  ImageEditor: () => <div data-testid="quick-mark-editor" />,
}))

vi.mock('@/features/imageEdit/execution/browserImageEditExecution', () => ({
  exportImageEditDocument: vi.fn(),
}))

describe('ViewerMarkEditor 发布路由', () => {
  afterEach(() => {
    cleanup()
  })

  it('默认开关关闭时保持旧查看器编辑路径', () => {
    render(
      <ViewerMarkEditor
        imageUrl="image.png"
        session={{ sourceUrl: 'image.png', document: createEmptyImageEditDocument() }}
        onClose={() => undefined}
        onSave={() => undefined}
      />,
    )

    expect(screen.getByTestId('quick-mark-editor')).toBeTruthy()
    expect(screen.queryByTestId('v3-viewer-editor')).toBeNull()
  })

})
