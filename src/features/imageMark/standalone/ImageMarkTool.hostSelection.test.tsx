/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { NotificationProvider } from '@/contexts/NotificationContext'
import { ImageMarkTool } from './ImageMarkTool'

const mocks = vi.hoisted(() => ({
  featureEnabled: vi.fn(),
  openDialog: vi.fn(),
  allowMediaRoot: vi.fn(),
}))

vi.mock('@/platform/runtime', () => ({
  isImageEditorV3Enabled: mocks.featureEnabled,
}))

vi.mock('@/platform/desktopApi', () => ({
  allowMediaRoot: mocks.allowMediaRoot,
  basename: (value: string) => value.split('/').at(-1) ?? value,
  dirname: async () => '/private/tmp',
  getPathForFile: () => null,
  openDialog: mocks.openDialog,
  saveDialog: vi.fn(),
}))

vi.mock('@/commands/clipboard', () => ({ readClipboardImage: vi.fn() }))
vi.mock('@/commands/image', () => ({
  copyImageSourceToClipboard: vi.fn(),
  persistImageSource: vi.fn(),
  saveImageSourceToPath: vi.fn(),
}))
vi.mock('@/features/assets/hooks/useAddToAssetLibrary', () => ({
  useAddToAssetLibrary: () => ({ addMedia: vi.fn(), collecting: false }),
}))
vi.mock('@/features/imageEdit/execution/browserImageEditExecution', () => ({
  exportImageEditDocument: vi.fn(),
}))
vi.mock('@/features/imageEdit/editor/ImageEditor', () => ({
  ImageEditor: () => <div data-testid="legacy-image-editor" />,
}))
vi.mock('./ImageMarkToolV3Host', () => ({
  ImageMarkToolV3Host: ({ onFallback }: { onFallback: () => void }) => (
    <div data-testid="v3-image-editor">
      <button type="button" onClick={onFallback}>fallback</button>
    </div>
  ),
}))

function renderTool(): void {
  render(
    <NotificationProvider>
      <ImageMarkTool />
    </NotificationProvider>,
  )
}

async function openSource(): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: '从文件打开' }))
  await waitFor(() => expect(mocks.openDialog).toHaveBeenCalledTimes(1))
}

describe('ImageMarkTool host selection', () => {
  beforeEach(() => {
    mocks.featureEnabled.mockReset().mockReturnValue(false)
    mocks.openDialog.mockReset().mockResolvedValue('/private/tmp/source.png')
    mocks.allowMediaRoot.mockReset().mockResolvedValue(undefined)
  })

  afterEach(() => {
    cleanup()
  })

  it('功能开关默认关闭时继续使用旧编辑器', async () => {
    renderTool()
    await openSource()
    expect(await screen.findByTestId('legacy-image-editor')).toBeTruthy()
    expect(screen.queryByTestId('v3-image-editor')).toBeNull()
  })

  it('功能开关开启时进入 V3，显式回退只影响当前图片会话', async () => {
    mocks.featureEnabled.mockReturnValue(true)
    renderTool()
    await openSource()
    expect(await screen.findByTestId('v3-image-editor')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'fallback' }))
    expect(await screen.findByTestId('legacy-image-editor')).toBeTruthy()
    expect(screen.queryByTestId('v3-image-editor')).toBeNull()
  })
})
