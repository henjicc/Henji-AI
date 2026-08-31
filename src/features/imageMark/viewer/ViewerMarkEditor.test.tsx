/** @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createEmptyImageEditDocument } from '@/core/imageEdit'
import { ViewerMarkEditor } from './ViewerMarkEditor'

const mocks = vi.hoisted(() => ({
  v3Enabled: false,
}))

vi.mock('@/platform/runtime', () => ({
  isImageEditorV3Enabled: () => mocks.v3Enabled,
}))

vi.mock('@/features/imageEdit/editor/ImageEditor', () => ({
  ImageEditor: () => <div data-testid="legacy-viewer-editor" />,
}))

vi.mock('@/features/imageEdit/execution/browserImageEditExecution', () => ({
  exportImageEditDocument: vi.fn(),
}))

vi.mock('./ViewerMarkEditorV3Host', () => ({
  ViewerMarkEditorV3Host: () => <div data-testid="v3-viewer-editor" data-profile="quick" />,
}))

describe('ViewerMarkEditor V3 路由', () => {
  afterEach(() => {
    cleanup()
    mocks.v3Enabled = false
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

  it('开关开启后只进入 V3 quick 宿主，不在失败前预装旧编辑器', async () => {
    mocks.v3Enabled = true
    render(
      <ViewerMarkEditor
        imageUrl="image.png"
        session={{ sourceUrl: 'image.png', document: createEmptyImageEditDocument() }}
        onClose={() => undefined}
        onSave={() => undefined}
      />,
    )

    expect(await screen.findByTestId('v3-viewer-editor')).toBeTruthy()
    expect(screen.queryByTestId('legacy-viewer-editor')).toBeNull()
  })
})
