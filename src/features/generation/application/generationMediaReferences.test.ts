import { beforeEach, expect, it, vi } from 'vitest'
import { resolveGenerationMediaReferences } from './generationMediaReferences'
import { APPLICATION_MEDIA_REFERENCE_KINDS } from '@/core/application-control/mediaReferenceKinds'
const inspect = vi.hoisted(() => vi.fn())
const history = vi.hoisted(() => vi.fn())
const imageInfo = vi.hoisted(() => vi.fn())
vi.mock('@/features/imageEdit/application/imageEditApplicationService', () => ({ materializeImageEditPreview: async () => 'C:/data/images/result.png' }))
vi.mock('@/services/database', () => ({ databaseService: { init: vi.fn(), getHistoryById: history } }))
vi.mock('@/commands/image', () => ({ readImageInfo: imageInfo }))
vi.mock('@/commands/assetLibrary', () => ({ inspectAsset: inspect }))
vi.mock('@/platform/runtime', () => ({ isDesktopRuntime: () => true }))
vi.mock('@/platform/desktopApi', () => ({ toDisplaySrc: (path: string) => `henji-media://local/${encodeURIComponent(path)}` }))
beforeEach(() => { inspect.mockReset(); history.mockReset(); imageInfo.mockReset(); imageInfo.mockResolvedValue({ fileName: 'result.png' }) })
it.each(['uploadedImages', 'images', 'uploadedVideos', 'videos', 'uploadedAudios', 'audios', 'uploadedFilePaths', 'uploadedVideoFilePaths', 'uploadedAudioFilePaths'])('拒绝 %s 中的调用方本地路径，包括被另一媒体字段遮盖的路径', async field => {
  for (const path of ['/private/secret.png', '~/Documents/secret.png', 'file:///etc/hosts', 'C:\\private\\secret.png', 'henji-media://local/secret']) {
    await expect(resolveGenerationMediaReferences({ [field]: [path] })).rejects.toThrow('INVALID_INPUT')
  }
  await expect(resolveGenerationMediaReferences({ uploadedImages: ['https://example.com/a.png'], [field]: ['/private/secret.png'] })).rejects.toThrow('INVALID_INPUT')
})
it('允许远程及内嵌媒体，显式路径字段不能覆盖已解析的引用', async () => {
  for (const source of ['https://example.com/a.png', 'http://example.com/a.png', 'data:image/png;base64,AA==']) {
    expect((await resolveGenerationMediaReferences({ images: [source] })).uploadedFilePaths).toEqual([source])
  }
  inspect.mockResolvedValue({ mediaType: 'image', filePath: 'C:/media/allowed.png' })
  expect((await resolveGenerationMediaReferences({ uploadedImages: [{ kind: 'asset', id: 'a' }], uploadedFilePaths: ['https://example.com/other.png'] })).uploadedFilePaths).toEqual(['C:/media/allowed.png'])
})
it('每种正式媒体来源都必须有可执行解析样例，新增声明不能只更新工具说明', async () => {
  const examples: Record<typeof APPLICATION_MEDIA_REFERENCE_KINDS[number], () => void> = {
    asset: () => { inspect.mockResolvedValue({ mediaType: 'image', filePath: 'C:/data/images/result.png' }) },
    'generation.result': () => { history.mockResolvedValue({ id: 'result', type: 'image', status: 'success', resultPaths: ['C:/data/images/result.png'], params: {} }) },
    'image_edit.preview': () => {},
  }
  expect(Object.keys(examples).sort()).toEqual([...APPLICATION_MEDIA_REFERENCE_KINDS].sort())
  for (const kind of APPLICATION_MEDIA_REFERENCE_KINDS) {
    examples[kind]()
    const resolved = await resolveGenerationMediaReferences({ uploadedImages: [{ kind, id: 'result' }] })
    expect(resolved.uploadedFilePaths, kind).toEqual(['C:/data/images/result.png'])
  }
})
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
  history.mockResolvedValue({ id: 'saved', type, status: 'success', resultPaths: ['C:/data/images/result.png'], params: {} })
  const result = await resolveGenerationMediaReferences({ [uploaded]: [{ kind: 'generation.result', id: 'saved' }] })
  expect(history).toHaveBeenCalledWith('saved')
  expect(result[paths]).toEqual(['C:/data/images/result.png'])
  expect(inspect).not.toHaveBeenCalled()
})
it('历史图片本地副本失效时复用可读远程结果，不丢掉参考图', async () => {
  history.mockResolvedValue({ id: 'saved', type: 'image', status: 'completed', resultPaths: ['missing.png'], params: { __resultUrl: ['https://example.com/result.png'] } })
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
