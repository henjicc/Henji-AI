/** @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createEmptyImageEditDocument } from '@/core/imageEdit'
import { ViewerMarkEditor } from './ViewerMarkEditor'

vi.mock('@/features/imageEdit/editor/ImageEditor', () => ({
  ImageEditor: () => <div data-testid="legacy-viewer-editor" />,
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

    expect(screen.getByTestId('legacy-viewer-editor')).toBeTruthy()
    expect(screen.queryByTestId('v3-viewer-editor')).toBeNull()
  })

  it('精简版不把查看器切到尚未收口的 quick 宿主', () => {
    render(
      <ViewerMarkEditor
        imageUrl="image.png"
        session={{ sourceUrl: 'image.png', document: createEmptyImageEditDocument() }}
        onClose={() => undefined}
        onSave={() => undefined}
      />,
    )

    expect(screen.getByTestId('legacy-viewer-editor')).toBeTruthy()
  })
})
