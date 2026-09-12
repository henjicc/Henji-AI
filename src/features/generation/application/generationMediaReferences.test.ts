import { beforeEach, expect, it, vi } from 'vitest'
import { resolveGenerationMediaReferences } from './generationMediaReferences'
const inspect = vi.hoisted(() => vi.fn())
vi.mock('@/commands/assetLibrary', () => ({ inspectAsset: inspect }))
vi.mock('@/platform/runtime', () => ({ isDesktopRuntime: () => true }))
vi.mock('@/platform/desktopApi', () => ({ toDisplaySrc: (path: string) => `henji-media://local/${encodeURIComponent(path)}` }))
beforeEach(() => { inspect.mockReset() })
it.each([
  ['uploadedImages', 'images', 'uploadedFilePaths', 'image'],
  ['uploadedVideos', 'videos', 'uploadedVideoFilePaths', 'video'],
  ['uploadedAudios', 'audios', 'uploadedAudioFilePaths', 'audio'],
])('将 %s 的真实素材交给正式媒体字段', async (uploaded, visible, paths, type) => {
  inspect.mockResolvedValue({ filePath: 'C:/media/file.png', mediaType: type })
  const result = await resolveGenerationMediaReferences({ [uploaded]: [{ kind: 'asset', id: 'real-asset' }], quality: 'high' })
  expect(inspect).toHaveBeenCalledWith('real-asset')
  expect(result[paths]).toEqual(['C:/media/file.png'])
  expect(result[visible]).toEqual([expect.stringContaining('henji-media:')])
  expect(result.quality).toBe('high')
  expect(result[uploaded]).toBeUndefined()
})
it('错类型与失效素材明确拒绝，不静默丢弃参考图', async () => {
  inspect.mockResolvedValue({ filePath: 'C:/media/file.mp4', mediaType: 'video' })
  await expect(resolveGenerationMediaReferences({ uploadedImages: [{ kind: 'asset', id: 'video' }] })).rejects.toThrow('实际为 video')
  inspect.mockRejectedValue(new Error('素材不存在'))
  await expect(resolveGenerationMediaReferences({ uploadedImages: [{ kind: 'asset', id: 'missing' }] })).rejects.toThrow('素材不存在')
})
