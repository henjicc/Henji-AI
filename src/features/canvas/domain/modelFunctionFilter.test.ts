import { expect, it } from 'vitest'
import { inferModelFunctionFilter } from './modelFunctionFilter'

it('接了视频时只在当前模型能收视频的功能唯一时预选，推不出唯一就不预选', () => {
  const h3 = ['text-to-video', 'image-to-video', 'start-end-frame', 'reference-mode']
  expect(inferModelFunctionFilter('video', h3, { images: 1, videos: 1, audios: 0 })).toBe('reference-mode')
  expect(inferModelFunctionFilter('video', ['reference-mode', 'video-to-video'], { images: 0, videos: 1, audios: 0 })).toBeNull()
  expect(inferModelFunctionFilter('video', h3, { images: 1, videos: 0, audios: 0 })).toBe('image-to-video')
  expect(inferModelFunctionFilter('video', h3, { images: 0, videos: 0, audios: 0 })).toBeNull()
  expect(inferModelFunctionFilter('image', ['text-to-image', 'image-to-image'], { images: 2, videos: 0, audios: 0 })).toBe('image-to-image')
})
