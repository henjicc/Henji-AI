// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import path from 'node:path'
const mock = vi.hoisted(() => ({ image: vi.fn(), files: vi.fn(), upload: vi.fn(), text: vi.fn() }))
vi.mock('@/hooks/useI18n', () => ({ useI18n: () => ({ t: () => '粘贴' }) }))
vi.mock('@/core/logging', () => ({ createLogger: () => ({ debug: vi.fn(), error: vi.fn(), warn: vi.fn() }) }))
vi.mock('@/platform/runtime', () => ({ isDesktopRuntime: () => true, getPlatform: () => ({ clipboard: { readImage: mock.image, readClipboardFiles: mock.files, readText: mock.text } }) }))
vi.mock('@/core/inputs/inputLimits', () => ({ resolveInputLimits: () => ({ images: { max: 2 } }) }))
vi.mock('@/components/ContextMenu', () => ({ default: ({ visible, items }: { visible: boolean; items: { onClick: () => void; label: string }[] }) => visible ? <div role="menuitem" onClick={items[0].onClick}>{items[0].label}</div> : null }))
import GlobalContextMenuProvider from './GlobalContextMenuProvider'
import { useGlobalPasteImage } from '@/components/MediaGenerator/hooks/useGlobalPasteImage'
function Consumer() {
  useGlobalPasteImage({ selectedModel: 'test', modelParams: {}, uploadedImagesCount: 0, uploadedVideosCount: 0, handleImageFileUpload: mock.upload })
  return <div data-prompt-textarea />
}
function pasteFromMenu(prompt = true): HTMLTextAreaElement {
  const result = render(<GlobalContextMenuProvider><Consumer /></GlobalContextMenuProvider>)
  const textarea = document.createElement('textarea')
  const parent = prompt ? result.container.querySelector('[data-prompt-textarea]')! : result.container
  parent.append(textarea)
  fireEvent.contextMenu(textarea, { clientX: 10, clientY: 10 })
  fireEvent.click(screen.getByRole('menuitem'))
  return textarea
}

afterEach(() => { cleanup(); vi.resetAllMocks(); vi.unstubAllGlobals() })

it.each([42, 2 * 1024 ** 3])('右键粘贴 %i 字节的图片文件将路径元数据传到正式 hook，不读位图', async size => {
  const image = { path: path.resolve(path.sep, 'media', 'image.png'), mimeType: 'image/png', size }
  const video = { path: path.resolve(path.sep, 'media', 'large.mp4'), mimeType: 'video/mp4', size: 2 * 1024 ** 3 }
  mock.files.mockResolvedValue([video, image])
  mock.image.mockResolvedValue(null)
  pasteFromMenu()
  await waitFor(() => expect(mock.upload).toHaveBeenCalledWith([image], 2))
  expect(mock.files).toHaveBeenCalledOnce()
  expect(mock.image).not.toHaveBeenCalled()
  expect(mock.text).not.toHaveBeenCalled()
})

it('没有文件路径的系统截图仍通过有界位图与正式 hook 上传', async () => {
  mock.files.mockResolvedValue([])
  mock.image.mockResolvedValue({ dataUrl: 'data:image/png;base64,AQID', name: 'image.png', origin: 'bitmap' })
  pasteFromMenu()
  await waitFor(() => expect(mock.upload).toHaveBeenCalledOnce())
  const [files, maxCount] = mock.upload.mock.calls[0] as [File[], number]
  expect(files[0].name).toBe('image.png'); expect(files[0].type).toBe('image/png'); expect(files[0].size).toBe(3)
  expect(maxCount).toBe(2); expect(mock.files).toHaveBeenCalledOnce(); expect(mock.image).toHaveBeenCalledOnce()
})

it.each([{ entries: [] }, { entries: [{ path: path.resolve(path.sep, 'media', 'large.mp4'), mimeType: 'video/mp4', size: 2 * 1024 ** 3 }] }])('纯文本或非图片文件继续粘贴文本，不上传媒体', async ({ entries }) => {
  vi.stubGlobal('navigator', { clipboard: { readText: mock.text } })
  mock.files.mockResolvedValue(entries)
  mock.image.mockResolvedValue(null)
  mock.text.mockResolvedValue('剪贴板文本')
  const textarea = pasteFromMenu()
  await waitFor(() => expect(textarea.value).toBe('剪贴板文本'))
  expect(mock.upload).not.toHaveBeenCalled()
  if (entries.length) expect(mock.image).not.toHaveBeenCalled()
  else expect(mock.image).toHaveBeenCalledOnce()
})

it('普通文本输入框保持只读文本，不查询图片或文件路径', async () => {
  mock.text.mockResolvedValue('普通文本')
  const textarea = pasteFromMenu(false)
  await waitFor(() => expect(textarea.value).toBe('普通文本'))
  expect(mock.files).not.toHaveBeenCalled()
  expect(mock.image).not.toHaveBeenCalled()
  expect(mock.upload).not.toHaveBeenCalled()
})
