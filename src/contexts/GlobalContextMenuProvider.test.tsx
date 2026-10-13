// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
const mock = vi.hoisted(() => ({ image: vi.fn(), files: vi.fn(), upload: vi.fn() }))
vi.mock('@/hooks/useI18n', () => ({ useI18n: () => ({ t: () => '粘贴' }) }))
vi.mock('@/core/logging', () => ({ createLogger: () => ({ debug: vi.fn(), error: vi.fn(), warn: vi.fn() }) }))
vi.mock('@/platform/runtime', () => ({ isDesktopRuntime: () => true, getPlatform: () => ({ clipboard: { readImage: mock.image, readClipboardFiles: mock.files } }) }))
vi.mock('@/core/inputs/inputLimits', () => ({ resolveInputLimits: () => ({ images: { max: 2 } }) }))
vi.mock('@/components/ContextMenu', () => ({ default: ({ visible, items }: { visible: boolean; items: { onClick: () => void; label: string }[] }) => visible ? <div role="menuitem" onClick={items[0].onClick}>{items[0].label}</div> : null }))
import GlobalContextMenuProvider from './GlobalContextMenuProvider'
import { useGlobalPasteImage } from '@/components/MediaGenerator/hooks/useGlobalPasteImage'
function Consumer() {
  useGlobalPasteImage({ selectedModel: 'test', modelParams: {}, uploadedImagesCount: 0, uploadedVideosCount: 0, handleImageFileUpload: mock.upload })
  return <div data-prompt-textarea />
}
afterEach(() => { cleanup(); vi.resetAllMocks() })
it('右键粘贴通过共享图片读取和正式监听事件上传，不读取全部文件', async () => {
  mock.image.mockResolvedValue({ dataUrl: 'data:image/png;base64,AQID', name: 'image.png', origin: 'file' })
  mock.files.mockResolvedValue([{ data: 'AQID', path: 'C:/image.png', mimeType: 'image/png' }])
  const result = render(<GlobalContextMenuProvider><Consumer /></GlobalContextMenuProvider>)
  const textarea = document.createElement('textarea')
  result.container.querySelector('[data-prompt-textarea]')!.append(textarea)
  fireEvent.contextMenu(textarea, { clientX: 10, clientY: 10 })
  fireEvent.click(screen.getByRole('menuitem'))
  await waitFor(() => expect(mock.upload).toHaveBeenCalledOnce())
  const [files, maxCount] = mock.upload.mock.calls[0] as [File[], number]
  expect(files[0].name).toBe('image.png'); expect(files[0].type).toBe('image/png'); expect(files[0].size).toBe(3)
  expect(maxCount).toBe(2); expect(mock.files).not.toHaveBeenCalled(); expect(mock.image).toHaveBeenCalledOnce()
})
