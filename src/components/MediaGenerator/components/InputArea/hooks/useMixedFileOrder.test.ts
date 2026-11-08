// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useMixedFileOrder } from './useMixedFileOrder'

afterEach(cleanup)

function renderImageAudioTray() {
  const handlers = {
    onImageRemove: vi.fn(),
    onImageReplace: vi.fn(),
    onImageReorder: vi.fn(),
    onAudioRemove: vi.fn(),
    onAudioReplace: vi.fn(),
  }
  const { result } = renderHook(() => useMixedFileOrder({
    mixedKinds: true,
    needsVideoUpload: false,
    needsVideoOnly: false,
    uploadedImages: ['img-a', 'img-b'],
    uploadedVideos: [],
    uploadedAudios: ['voice'],
    maxImageCount: 4,
    maxVideoCount: 0,
    maxAudioCount: 1,
    ...handlers,
  }))
  return { result, handlers }
}

it('不传视频的模型里，音频卡片在首次渲染就带着音频类型', () => {
  const { result } = renderImageAudioTray()
  expect(result.current.mixedFiles).toEqual(['img-a', 'img-b', 'voice'])
  expect(result.current.currentFileOrder.map(item => item.type)).toEqual(['image', 'image', 'audio'])
})

it('不传视频的模型里，删除和替换音频卡片交给音频处理', () => {
  const { result, handlers } = renderImageAudioTray()
  const file = new File(['x'], 'next.mp3', { type: 'audio/mpeg' })
  result.current.handleMixedFileRemove(2)
  result.current.handleMixedFileReplace(2, file)
  expect(handlers.onAudioRemove).toHaveBeenCalledWith(0)
  expect(handlers.onAudioReplace).toHaveBeenCalledWith(0, file)
  expect(handlers.onImageRemove).not.toHaveBeenCalled()
  expect(handlers.onImageReplace).not.toHaveBeenCalled()
})
