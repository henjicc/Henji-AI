import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cropImageSource, readImageInfo } from '@/commands/image'
import { getFalImageUtilityExecutionModel } from '@/core/modelCatalog/falUtilityExecutionModels'
import { normalizeSmartAspectParams } from './generationRequestPreflight'

vi.mock('@/commands/image', () => ({ readImageInfo: vi.fn(), cropImageSource: vi.fn() }))

const source = 'C:/images/portrait.png'
const cropped = 'C:/images/cropped.png'
const imageInfo = (width: number, height: number, orientation: number | null = null) => ({
  source, width, height, orientation, fileName: 'portrait.png', extension: 'png',
  hasAlpha: false, fileSizeBytes: 1024, createdAt: null, modifiedAt: null,
})
const tools = ['relighting', 'photo-restoration', 'product-photography']
const model = (name = 'relighting') => getFalImageUtilityExecutionModel(`fal-image-apps-v2-${name}`)!

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(readImageInfo).mockResolvedValue(imageInfo(853, 1280))
  vi.mocked(cropImageSource).mockResolvedValue(cropped)
})

describe('单图处理按源图匹配画幅', () => {
  it.each(tools)('%s 的旧固定比例被纠正，真实 builder 收到裁剪图和匹配比例', async (name) => {
    const original = { images: [source], uploadedFilePaths: [source], image: [source], aspectRatio: '1:1' }
    const result = await normalizeSmartAspectParams(model(name), original, 'framing-test')
    expect(cropImageSource).toHaveBeenCalledTimes(1)
    expect(cropImageSource).toHaveBeenCalledWith({ source, aspectRatio: '3:4' })
    expect(result.params).toMatchObject({ images: [cropped], uploadedFilePaths: [cropped], image: [cropped], aspectRatio: '3:4' })
    expect(await model(name).request!.builder!(result.params)).toMatchObject({
      [name === 'product-photography' ? 'product_image_url' : 'image_url']: cropped,
      aspect_ratio: { ratio: '3:4' },
    })
    expect(original).toEqual({ images: [source], uploadedFilePaths: [source], image: [source], aspectRatio: '1:1' })
    expect(result.report.adjustments).toContainEqual(expect.objectContaining({ to: '3:4', reason: 'reference-image' }))
  })

  it.each(['images', 'uploadedFilePaths', 'uploadedImages', 'image'])('识别 %s 输入，空别名不遮蔽源图', async (key) => {
    const result = await normalizeSmartAspectParams(model(), { images: [], [key]: [source] })
    expect(readImageInfo).toHaveBeenCalledWith(source)
    expect(await model().request!.builder!(result.params)).toMatchObject({ image_url: cropped })
  })

  it('选择保留面积最多的比例，横竖图对称', async () => {
    vi.mocked(readImageInfo).mockResolvedValue(imageInfo(650, 1000))
    expect((await normalizeSmartAspectParams(model(), { image: [source] })).params.aspectRatio).toBe('3:4')
    vi.mocked(readImageInfo).mockResolvedValue(imageInfo(1000, 650))
    expect((await normalizeSmartAspectParams(model(), { image: [source] })).params.aspectRatio).toBe('4:3')
  })

  it('原比例已被支持时保持原文件，不重复编码', async () => {
    vi.mocked(readImageInfo).mockResolvedValue(imageInfo(900, 1600))
    const result = await normalizeSmartAspectParams(model(), { images: [source] })
    expect(result.params.aspectRatio).toBe('9:16')
    expect(result.params.images).toEqual([source])
    expect(cropImageSource).not.toHaveBeenCalled()
  })

  it('换源图重新匹配，不复用旧裁剪结果', async () => {
    await normalizeSmartAspectParams(model(), { images: [source] })
    vi.mocked(readImageInfo).mockResolvedValue(imageInfo(1600, 900))
    const result = await normalizeSmartAspectParams(model(), { images: ['landscape.png'], aspectRatio: '3:4' })
    expect(result.params).toMatchObject({ aspectRatio: '16:9', images: ['landscape.png'] })
    expect(cropImageSource).toHaveBeenCalledTimes(1)
  })

  it('尺寸读取和裁剪失败均终止准备，不能静默发送可能拉伸的图', async () => {
    vi.mocked(readImageInfo).mockRejectedValueOnce(new Error('unreadable'))
    await expect(normalizeSmartAspectParams(model(), { images: [source] })).rejects.toThrow('无法读取输入图片尺寸')
    expect(cropImageSource).not.toHaveBeenCalled()
    vi.mocked(cropImageSource).mockRejectedValueOnce(new Error('crop failed'))
    await expect(normalizeSmartAspectParams(model(), { images: [source] })).rejects.toThrow('crop failed')
  })

  it('未声明自动裁剪的模型继续保留原图与显式比例', async () => {
    const other = { ...model(), sourceImageFraming: undefined }
    const result = await normalizeSmartAspectParams(other, { images: [source], aspectRatio: '16:9' })
    expect(result.params).toMatchObject({ images: [source], aspectRatio: '16:9' })
    expect(cropImageSource).not.toHaveBeenCalled()
  })

  it.each([5, 6, 7, 8])('EXIF 方向 %s 按用户看到的横竖关系匹配', async (orientation) => {
    vi.mocked(readImageInfo).mockResolvedValue(imageInfo(1280, 853, orientation))
    const result = await normalizeSmartAspectParams(model(), { images: [source] })
    expect(result.params.aspectRatio).toBe('3:4')
  })
})
