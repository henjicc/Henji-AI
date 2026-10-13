// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useState } from 'react'
import path from 'node:path'
import { useImageUpload } from './useImageUpload'

const mocks = vi.hoisted(() => ({ importMedia: vi.fn(), source: vi.fn(), sources: vi.fn(), memory: vi.fn() }))
vi.mock('@/services/localMediaImport', () => ({ importLocalMedia: mocks.importMedia, readClipboardImageSource: mocks.source, readClipboardImageSources: mocks.sources }))
vi.mock('@/utils/save', () => ({ saveUploadImage: mocks.memory }))
vi.mock('@/platform/desktopApi', () => ({ toDisplaySrc: (p: string) => `display:${p}` }))
vi.mock('@/platform/runtime', () => ({ isDesktopRuntime: () => true }))
vi.mock('@/core/logging', () => ({ createLogger: () => ({ error: vi.fn() }) }))

const entry = { path: path.resolve(path.sep, 'media', 'large.png'), mimeType: 'image/png', size: 2 * 1024 ** 3 }
function setup() {
  return renderHook(() => {
    const [images, setImages] = useState<string[]>([])
    const [paths, setPaths] = useState<string[]>([])
    return { images, paths, upload: useImageUpload(images, setImages, paths, setPaths) }
  })
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.source.mockResolvedValue(entry)
  mocks.sources.mockImplementation(async () => { const source = await mocks.source(); return source ? [source] : [] })
  mocks.importMedia.mockResolvedValue({ kind: 'image', fullPath: entry.path, previewPath: '/preview.png' })
})
afterEach(cleanup)

it('提示词粘贴大文件按路径导入，同时回填预览与原文件路径', async () => {
  const { result } = setup()
  const event = { preventDefault: vi.fn(), clipboardData: { items: [], files: [] } } as unknown as ClipboardEvent
  await act(async () => { await result.current.upload.handlePaste(event, 1) })
  expect(mocks.importMedia).toHaveBeenCalledWith(entry, 'image')
  expect(mocks.memory).not.toHaveBeenCalled()
  expect(result.current.images).toEqual(['display:/preview.png'])
  expect(result.current.paths).toEqual([entry.path])
  expect(event.preventDefault).toHaveBeenCalled()
})

it('文件粘贴在异步读取前阻止默认插入，截图转换为实际 File 后导入', async () => {
  const { result } = setup()
  mocks.source.mockResolvedValue({ dataUrl: 'data:image/png;base64,AQID', name: '截图.png', origin: 'bitmap' })
  const event = { preventDefault: vi.fn(), clipboardData: { items: [{ kind: 'file', type: '' }], files: [] } } as unknown as ClipboardEvent
  let pending: Promise<void>
  await act(async () => {
    pending = result.current.upload.handlePaste(event, 1)
    expect(event.preventDefault).toHaveBeenCalled()
    await pending
  })
  expect(mocks.importMedia).toHaveBeenCalledWith(expect.objectContaining({ name: '截图.png', type: 'image/png', size: 3 }), 'image')
})

it('达到图片数量上限后不再导入或弹出大文件询问', async () => {
  const { result } = setup()
  await act(async () => { await result.current.upload.handleImageFileUpload([entry], 0) })
  expect(mocks.importMedia).not.toHaveBeenCalled()
})

it('同时复制多张图片时保持全部导入，上限外的文件不触发导入', async () => {
  const { result } = setup()
  mocks.sources.mockResolvedValue([entry, { ...entry, path: path.resolve(path.sep, 'media', 'second.png') }, entry])
  const event = { preventDefault: vi.fn(), clipboardData: { items: [], files: [] } } as unknown as ClipboardEvent
  await act(async () => { await result.current.upload.handlePaste(event, 2) })
  expect(mocks.importMedia).toHaveBeenCalledTimes(2)
  expect(result.current.images).toHaveLength(2)
  expect(result.current.paths).toHaveLength(2)
})

it('路径导入失败上抛，图片和路径不发生部分写入', async () => {
  const { result } = setup()
  mocks.importMedia.mockRejectedValue(new Error('导入失败'))
  await act(async () => { await expect(result.current.upload.handleImageFileUpload([entry], 1)).rejects.toThrow('导入失败') })
  expect(result.current.images).toEqual([])
  expect(result.current.paths).toEqual([])
})

it('替换图片时同步替换原文件路径', async () => {
  const { result } = setup()
  await act(async () => { await result.current.upload.handleImageFileUpload([entry], 1) })
  const replacement = new File(['bitmap'], 'new.png', { type: 'image/png' })
  mocks.importMedia.mockResolvedValue({ kind: 'image', fullPath: '/new.png', previewPath: '/new-preview.png' })
  await act(async () => { await result.current.upload.handleImageReplace(0, replacement) })
  expect(result.current.images).toEqual(['display:/new-preview.png'])
  expect(result.current.paths).toEqual(['/new.png'])
})

it('并发粘贴共享数量上限，随后删除与重排仍保持预览和路径对应', async () => {
  const { result } = setup()
  let finish!: (value: { kind: string; fullPath: string; previewPath: string }) => void
  mocks.importMedia.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  await act(async () => {
    const first = result.current.upload.handleImageFileUpload([entry], 1)
    await result.current.upload.handleImageFileUpload([entry], 1)
    expect(mocks.importMedia).toHaveBeenCalledTimes(1)
    finish({ kind: 'image', fullPath: '/first.png', previewPath: '/first-preview.png' })
    await first
  })
  mocks.importMedia.mockResolvedValue({ kind: 'image', fullPath: '/second.png', previewPath: '/second-preview.png' })
  await act(async () => { await result.current.upload.handleImageFileUpload([entry], 2) })
  act(() => result.current.upload.handleImageReorder(0, 1))
  expect(result.current.paths).toEqual(['/second.png', '/first.png'])
  expect(result.current.images).toEqual(['display:/second-preview.png', 'display:/first-preview.png'])
  act(() => result.current.upload.removeImage(0))
  expect(result.current.paths).toEqual(['/first.png'])
  expect(result.current.images).toEqual(['display:/first-preview.png'])
})
