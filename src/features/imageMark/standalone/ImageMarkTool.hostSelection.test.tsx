/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { NotificationProvider } from '@/contexts/NotificationContext'
import type { ProjectLibraryCreate } from '@/components/ProjectLibraryPage'
import i18n from '@/i18n/config'
import {
  getImageDocumentWorkspace,
  requestImageDocumentInEditor,
  resetImageDocumentWorkspaceForTests,
} from '@/features/imageEdit/documents/imageDocumentWorkspace'
import type { ImageDocumentRecoveryInfo, ImageDocumentRecoveryChoice } from '@/features/imageEdit/documents/imageDocumentPersistence'
import { ImageMarkTool } from './ImageMarkTool'

const mocks = vi.hoisted(() => ({
  openDialog: vi.fn(),
  allowMediaRoot: vi.fn(),
  createFromSource: vi.fn(),
  openDocument: vi.fn(),
  leaveDocument: vi.fn(),
  saveDocument: vi.fn(),
  saveDocumentAs: vi.fn(),
}))

vi.mock('@/platform/runtime', () => ({
  isDesktopRuntime: () => false,
}))

vi.mock('@/platform/desktopApi', () => ({
  allowMediaRoot: mocks.allowMediaRoot,
  dirname: async () => '/private/tmp',
  getPathForFile: () => null,
  openDialog: mocks.openDialog,
}))

vi.mock('@/commands/clipboard', () => ({ readClipboardImage: vi.fn() }))

vi.mock('./imageDocumentFromSource', () => ({
  createImageDocumentFromSource: mocks.createFromSource,
}))

vi.mock('@/features/imageEdit/documents/imageDocumentRuntime', () => ({
  findOpenImageDocument: () => undefined,
  openImageDocument: mocks.openDocument,
  leaveImageDocument: mocks.leaveDocument,
  saveImageDocument: mocks.saveDocument,
  saveImageDocumentAs: mocks.saveDocumentAs,
}))

// 列表页本身（取数、右键）由 DocumentLibraryPage 的测试覆盖；这里只看新建来源与打开入口。
vi.mock('@/features/documents/DocumentLibraryPage', () => ({
  DocumentLibraryPage: ({ create, onOpen }: { create: ProjectLibraryCreate; onOpen: (document: { id: string; path: string }) => void }) => (
    <div data-testid="image-document-library">
      {create.kind === 'menu' ? create.options.map((option) => (
        <button key={option.id} type="button" onClick={option.onSelect}>{option.label}</button>
      )) : null}
      <button type="button" onClick={() => onOpen({ id: 'doc-2', path: 'D:/作品/图片文档/b.henjiimg' })}>open-doc-2</button>
    </div>
  ),
}))

vi.mock('./ImageMarkToolV3Host', () => ({
  ImageMarkToolV3Host: ({ document, onBack, onSave }: { document: { id: string }; onBack: () => void; onSave: () => void }) => (
    <div data-testid="v3-image-editor" data-document-id={document.id}>
      <button type="button" onClick={onBack}>back</button>
      <button type="button" onClick={onSave}>save</button>
    </div>
  ),
}))

function fakeDocument(id: string) {
  return { id, session: { documentMeta: { name: id }, isEnded: false } }
}

function renderTool() {
  return render(
    <NotificationProvider>
      <ImageMarkTool />
    </NotificationProvider>,
  )
}

describe('ImageMarkTool（图片文档）', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN')
    window.history.replaceState({}, '', '/')
    resetImageDocumentWorkspaceForTests()
    mocks.openDialog.mockReset().mockResolvedValue('/private/tmp/source.png')
    mocks.allowMediaRoot.mockReset().mockResolvedValue(undefined)
    mocks.createFromSource.mockReset().mockImplementation(async () => fakeDocument('doc-1'))
    mocks.openDocument.mockReset().mockImplementation(async (target: { id: string }) => fakeDocument(target.id))
    mocks.leaveDocument.mockReset().mockResolvedValue('closed')
    mocks.saveDocument.mockReset().mockResolvedValue(true)
    mocks.saveDocumentAs.mockReset().mockResolvedValue(null)
  })

  afterEach(() => {
    cleanup()
  })

  it('列表页“打开图片”把图片作为内容新建草稿图片文档并进入编辑器', async () => {
    renderTool()
    fireEvent.click(screen.getByRole('button', { name: '打开图片' }))

    const editor = await screen.findByTestId('v3-image-editor')
    expect(editor.getAttribute('data-document-id')).toBe('doc-1')
    expect(mocks.createFromSource).toHaveBeenCalledWith({ url: '/private/tmp/source.png' })
    expect(mocks.allowMediaRoot).toHaveBeenCalledWith('/private/tmp')
    expect(getImageDocumentWorkspace().current).toBe('doc-1')
  })

  it('开发启动素材自动新建图片文档', async () => {
    window.history.replaceState({}, '', '/?henjiDevMedia=%2Fprivate%2Ftmp%2Ftest01.jpg')
    renderTool()

    expect(await screen.findByTestId('v3-image-editor')).toBeTruthy()
    expect(mocks.openDialog).not.toHaveBeenCalled()
    expect(mocks.createFromSource).toHaveBeenCalledWith({ url: '/private/tmp/test01.jpg' })
  })

  it('返回列表走离开流程：取消留在编辑器，关闭后回到列表', async () => {
    renderTool()
    fireEvent.click(screen.getByRole('button', { name: '打开图片' }))
    await screen.findByTestId('v3-image-editor')

    mocks.leaveDocument.mockResolvedValueOnce('cancelled')
    fireEvent.click(screen.getByRole('button', { name: 'back' }))
    await waitFor(() => expect(mocks.leaveDocument).toHaveBeenCalledTimes(1))
    expect(screen.getByTestId('v3-image-editor')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'back' }))
    expect(await screen.findByTestId('image-document-library')).toBeTruthy()
    expect(mocks.leaveDocument).toHaveBeenLastCalledWith('doc-1')
    expect(getImageDocumentWorkspace().current).toBeNull()
  })

  it('别处请求打开：先离开当前文档，再打开请求的文档', async () => {
    renderTool()
    fireEvent.click(screen.getByRole('button', { name: '打开图片' }))
    await screen.findByTestId('v3-image-editor')

    act(() => { requestImageDocumentInEditor({ id: 'doc-3', path: 'D:/作品/图片文档/c.henjiimg' }) })
    await waitFor(() => expect(screen.getByTestId('v3-image-editor').getAttribute('data-document-id')).toBe('doc-3'))
    expect(mocks.leaveDocument).toHaveBeenCalledWith('doc-1')
    expect(mocks.openDocument).toHaveBeenCalledWith(
      { id: 'doc-3', path: 'D:/作品/图片文档/c.henjiimg' },
      expect.objectContaining({ chooseRecovery: expect.any(Function) }),
    )
    expect(getImageDocumentWorkspace().pending).toBeNull()
  })

  it('有没写回的修改时询问恢复：选“恢复修改”继续打开', async () => {
    let answer: Promise<ImageDocumentRecoveryChoice> | null = null
    mocks.openDocument.mockImplementationOnce(async (target: { id: string }, options: { chooseRecovery: (info: ImageDocumentRecoveryInfo) => Promise<ImageDocumentRecoveryChoice> }) => {
      answer = options.chooseRecovery({ name: '海报', workingSavedAt: Date.UTC(2026, 9, 6, 2), fileSavedAt: Date.UTC(2026, 9, 6, 1) })
      if (await answer === 'cancel') throw Object.assign(new Error('cancelled'), { name: 'AbortError' })
      return fakeDocument(target.id)
    })
    renderTool()
    fireEvent.click(screen.getByRole('button', { name: 'open-doc-2' }))

    expect(await screen.findByText('恢复上次没写回的修改？')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '恢复修改' }))
    await expect(answer).resolves.toBe('restore')
    expect((await screen.findByTestId('v3-image-editor')).getAttribute('data-document-id')).toBe('doc-2')
  })

  it('编辑器里的保存交给文档运行时（草稿起名在运行时里）', async () => {
    renderTool()
    fireEvent.click(screen.getByRole('button', { name: '打开图片' }))
    await screen.findByTestId('v3-image-editor')
    fireEvent.click(screen.getByRole('button', { name: 'save' }))
    await waitFor(() => expect(mocks.saveDocument).toHaveBeenCalledWith('doc-1'))
  })
})
