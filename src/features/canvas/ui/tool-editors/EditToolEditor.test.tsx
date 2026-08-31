/** @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { CanvasToolPlugin } from '@/features/canvas/tools'
import { EditToolEditor } from './EditToolEditor'

const mocks = vi.hoisted(() => ({ enabled: false }))

vi.mock('@/platform/runtime', () => ({
  isImageEditorV3Enabled: () => mocks.enabled,
}))

vi.mock('@/features/imageEdit/editor/ImageEditor', () => ({
  ImageEditor: () => <div data-testid="legacy-image-editor" />,
}))

vi.mock('../../imageEditV3/CanvasEditToolEditorV3Host', () => ({
  CanvasEditToolEditorV3Host: () => <div data-testid="canvas-edit-v3-host" />,
}))

const plugin = {
  type: 'edit',
  label: '编辑',
  icon: 'edit',
  editor: 'edit',
  dialog: { size: 'workspace', resultNodeTitle: '编辑结果' },
  supportsNode: () => true,
  createInitialOptions: () => ({}),
  fields: [],
  execute: async () => ({}),
} satisfies CanvasToolPlugin

describe('EditToolEditor V3 开关', () => {
  afterEach(() => {
    cleanup()
    mocks.enabled = false
  })

  it('开关关闭时只挂载原有 V2 编辑器', async () => {
    render(
      <EditToolEditor
        plugin={plugin}
        options={{}}
        sourceImageUrl="source.png"
        onOptionsChange={() => undefined}
      />,
    )

    expect(await screen.findByTestId('legacy-image-editor')).toBeTruthy()
    expect(screen.queryByTestId('canvas-edit-v3-host')).toBeNull()
  })

  it('开关开启时只懒加载 canvas-edit V3 宿主，不静默挂载 V2', async () => {
    mocks.enabled = true
    render(
      <EditToolEditor
        plugin={plugin}
        options={{}}
        sourceImageUrl="source.png"
        onOptionsChange={() => undefined}
      />,
    )

    expect(await screen.findByTestId('canvas-edit-v3-host')).toBeTruthy()
    expect(screen.queryByTestId('legacy-image-editor')).toBeNull()
  })
})
