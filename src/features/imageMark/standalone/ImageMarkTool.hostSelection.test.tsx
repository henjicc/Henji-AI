/** @vitest-environment jsdom */

import '@/tests/imageEditDocumentFixture'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { NotificationProvider } from '@/contexts/NotificationContext'
import { ImageMarkTool } from './ImageMarkTool'
import { clearImageMarkToolWorkspaceSourceV3 } from './imageMarkToolWorkspaceV3'

const mocks = vi.hoisted(() => ({
  openDialog: vi.fn(),
  allowMediaRoot: vi.fn(),
}))

vi.mock('@/platform/runtime', () => ({
  isDesktopRuntime: () => false,
}))

vi.mock('@/platform/desktopApi', () => ({
  allowMediaRoot: mocks.allowMediaRoot,
  basename: (value: string) => value.split('/').at(-1) ?? value,
  dirname: async () => '/private/tmp',
  getPathForFile: () => null,
  openDialog: mocks.openDialog,
}))

vi.mock('@/commands/clipboard', () => ({ readClipboardImage: vi.fn() }))
vi.mock('./ImageMarkToolV3Host', () => ({
  ImageMarkToolV3Host: ({
    initialSession,
    onSessionReferenceChange,
  }: {
    initialSession?: { revision: number }
    onSessionReferenceChange: (session: {
      kind: 'image-edit-v3'
      sourceUrl: string
      documentRef: 'image-edit-v3:test-document'
      revision: number
      previewRef: null
    }) => void
  }) => (
    <div
      data-testid="v3-image-editor"
      data-session-revision={initialSession?.revision ?? 'none'}
    >
      <button type="button" onClick={() => onSessionReferenceChange({
        kind: 'image-edit-v3',
        sourceUrl: `henji-media://image-editor-v3/${'a'.repeat(64)}?mediaType=image%2Fpng`,
        documentRef: 'image-edit-v3:test-document',
        revision: 2,
        previewRef: null,
      })}>remember</button>
    </div>
  ),
}))

function renderTool() {
  return render(
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
    window.history.replaceState({}, '', '/')
    mocks.openDialog.mockReset().mockResolvedValue('/private/tmp/source.png')
    mocks.allowMediaRoot.mockReset().mockResolvedValue(undefined)
    clearImageMarkToolWorkspaceSourceV3()
  })

  afterEach(() => {
    cleanup()
  })

  it('开发启动素材自动进入图片编辑器', async () => {
    window.history.replaceState({}, '', '/?henjiDevMedia=%2Fprivate%2Ftmp%2Ftest01.jpg')

    renderTool()

    expect(await screen.findByTestId('v3-image-editor')).toBeTruthy()
    expect(mocks.openDialog).not.toHaveBeenCalled()
    expect(mocks.allowMediaRoot).toHaveBeenCalledWith('/private/tmp')
  })

  it('打开图片后进入 V3 编辑器', async () => {
    renderTool()
    await openSource()
    expect(await screen.findByTestId('v3-image-editor')).toBeTruthy()
  })

  it('切回工具箱再进入时恢复稳定 V3 会话，不要求用户重新打开图片', async () => {
    renderTool()
    await openSource()
    fireEvent.click(await screen.findByRole('button', { name: 'remember' }))
    cleanup()

    renderTool()
    const restored = await screen.findByTestId('v3-image-editor')
    expect(restored.getAttribute('data-session-revision')).toBe('2')
    expect(mocks.openDialog).toHaveBeenCalledTimes(1)
  })
})
