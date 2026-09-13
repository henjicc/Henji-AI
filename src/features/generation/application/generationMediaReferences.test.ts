import { beforeEach, expect, it, vi } from 'vitest'
import { resolveGenerationMediaReferences } from './generationMediaReferences'
const inspect = vi.hoisted(() => vi.fn())
const history = vi.hoisted(() => vi.fn())
const imageInfo = vi.hoisted(() => vi.fn())
vi.mock('@/services/database', () => ({ databaseService: { init: vi.fn(), getHistoryById: history } }))
vi.mock('@/commands/image', () => ({ readImageInfo: imageInfo }))
vi.mock('@/utils/dataPath', () => ({ getDataRoot: async () => 'C:/data', convertPathString: async (path: string) => path.replace('images/', 'C:/data/images/') }))
vi.mock('@/commands/assetLibrary', () => ({ inspectAsset: inspect }))
vi.mock('@/platform/runtime', () => ({ isDesktopRuntime: () => true }))
vi.mock('@/platform/desktopApi', () => ({ toDisplaySrc: (path: string) => `henji-media://local/${encodeURIComponent(path)}` }))
beforeEach(() => { inspect.mockReset(); history.mockReset(); imageInfo.mockReset(); imageInfo.mockResolvedValue({ fileName: 'result.png' }) })
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
it.each([
  ['uploadedImages', 'uploadedFilePaths', 'image'],
  ['uploadedVideos', 'uploadedVideoFilePaths', 'video'],
  ['uploadedAudios', 'uploadedAudioFilePaths', 'audio'],
])('未加入素材库的历史结果直接进入 %s', async (uploaded, paths, type) => {
  history.mockResolvedValue({ id: 'saved', type, status: 'success', filePath: 'images/result.png', params: {} })
  const result = await resolveGenerationMediaReferences({ [uploaded]: [{ kind: 'generation.result', id: 'saved' }] })
  expect(history).toHaveBeenCalledWith('saved')
  expect(result[paths]).toEqual(['C:/data/images/result.png'])
  expect(inspect).not.toHaveBeenCalled()
})
it('历史图片本地副本失效时复用可读远程结果，不丢掉参考图', async () => {
  history.mockResolvedValue({ id: 'saved', type: 'image', status: 'completed', filePath: 'missing.png', params: { __resultUrl: 'https://example.com/result.png' } })
  imageInfo.mockRejectedValueOnce(new Error('missing'))
  const result = await resolveGenerationMediaReferences({ uploadedImages: [{ kind: 'generation.result', id: 'saved' }] })
  expect(result.uploadedFilePaths).toEqual(['https://example.com/result.png'])
})
it('未完成、缺失和类型不匹配的历史结果明确拒绝', async () => {
  const input = { uploadedImages: [{ kind: 'generation.result', id: 'saved' }] }
  history.mockResolvedValue(null)
  await expect(resolveGenerationMediaReferences(input)).rejects.toThrow('NOT_FOUND')
  history.mockResolvedValue({ status: 'running', type: 'image' })
  await expect(resolveGenerationMediaReferences(input)).rejects.toThrow('尚未成功')
  history.mockResolvedValue({ status: 'success', type: 'video' })
  await expect(resolveGenerationMediaReferences(input)).rejects.toThrow('实际为 video')
})
it('错类型与失效素材明确拒绝，不静默丢弃参考图', async () => {
  inspect.mockResolvedValue({ filePath: 'C:/media/file.mp4', mediaType: 'video' })
  await expect(resolveGenerationMediaReferences({ uploadedImages: [{ kind: 'asset', id: 'video' }] })).rejects.toThrow('实际为 video')
  inspect.mockRejectedValue(new Error('素材不存在'))
  await expect(resolveGenerationMediaReferences({ uploadedImages: [{ kind: 'asset', id: 'missing' }] })).rejects.toThrow('素材不存在')
})
