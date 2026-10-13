// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import path from 'node:path'
import { useGlobalPasteImage } from './useGlobalPasteImage'
vi.mock('@/core/inputs/inputLimits', () => ({ resolveInputLimits: () => ({ images: { max: 2 } }) }))
afterEach(cleanup)

it('全局路径事件只把图片元数据交给上传入口，不读取大视频', async () => {
  const upload = vi.fn().mockResolvedValue(undefined)
  renderHook(() => useGlobalPasteImage({ selectedModel: 'test', modelParams: {}, uploadedImagesCount: 0, uploadedVideosCount: 0, handleImageFileUpload: upload }))
  const image = { path: path.resolve(path.sep, 'media', 'large.png'), mimeType: 'image/png', size: 2 * 1024 ** 3 }
  const video = { path: path.resolve(path.sep, 'media', 'large.mp4'), mimeType: 'video/mp4', size: 2 * 1024 ** 3 }
  await act(async () => { window.dispatchEvent(new CustomEvent('globalPasteImage', { detail: { clipboardPaths: [video, image] } })) })
  expect(upload).toHaveBeenCalledWith([image], 2)
})

it('截图位图事件继续转换为 File 交给同一上传入口', async () => {
  const upload = vi.fn().mockResolvedValue(undefined)
  renderHook(() => useGlobalPasteImage({ selectedModel: 'test', modelParams: {}, uploadedImagesCount: 0, uploadedVideosCount: 0, handleImageFileUpload: upload }))
  await act(async () => { window.dispatchEvent(new CustomEvent('globalPasteImage', { detail: { imageBlob: new Blob(['bitmap']), imageType: 'image/png' } })) })
  expect(upload).toHaveBeenCalledWith([expect.objectContaining({ name: 'pasted-image.png', type: 'image/png' })], 2)
})

it('路径导入失败通过调用方反馈错误，不留下未处理的拒绝', async () => {
  const error = new Error('文件不可读')
  const upload = vi.fn().mockRejectedValue(error)
  const onPasteError = vi.fn()
  renderHook(() => useGlobalPasteImage({ selectedModel: 'test', modelParams: {}, uploadedImagesCount: 0, uploadedVideosCount: 0, handleImageFileUpload: upload, onPasteError }))
  await act(async () => { window.dispatchEvent(new CustomEvent('globalPasteImage', { detail: { clipboardPaths: [{ path: path.resolve(path.sep, 'media', 'large.png'), mimeType: 'image/png', size: 2 * 1024 ** 3 }] } })) })
  await waitFor(() => expect(onPasteError).toHaveBeenCalledWith(error))
})
