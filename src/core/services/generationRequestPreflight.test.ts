import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cropImageSource, readImageInfo } from '@/commands/image'
import { getFalImageUtilityExecutionModel } from '@/core/modelCatalog/falUtilityExecutionModels'
import { normalizeSmartAspectParams } from './generationRequestPreflight'
import { catalog } from '@henjicc/ai-sdk'
import { composeModelDefinition } from '@/core/composeModelDefinition'
import { gptImage25Presentation } from '@/models/presentation/gpt-image-2.5'
import type { ModelDefinition } from '@/core/types'

vi.mock('@/commands/image', () => ({ readImageInfo: vi.fn(), cropImageSource: vi.fn() }))

const source = 'C:/images/portrait.png'
const cropped = 'C:/images/cropped.png'
const imageInfo = (width: number, height: number, orientation: number | null = null) => ({
  source, width, height, orientation, fileName: 'portrait.png', extension: 'png',
  hasAlpha: false, fileSizeBytes: 1024, createdAt: null, modifiedAt: null,
})
const tools = ['relighting', 'photo-restoration']
const model = (name = 'relighting') => getFalImageUtilityExecutionModel(`fal-image-apps-v2-${name}`)!

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(readImageInfo).mockResolvedValue(imageInfo(853, 1280))
  vi.mocked(cropImageSource).mockResolvedValue(cropped)
})

describe('智能比例遵守当前分辨率与渠道约束', () => {
  const definitionFor = (id: string) => composeModelDefinition(
    catalog.find(entry => entry.meta.id === id)!, gptImage25Presentation[id],
  )

  it('省略参数时也按模型默认分辨率和默认智能比例计算', async () => {
    vi.mocked(readImageInfo).mockResolvedValue(imageInfo(1600, 1000))
    const result = await normalizeSmartAspectParams(definitionFor('kie-gpt-image-2.5'), { images: [source] })
    expect(result.params.gpt25AspectRatio).toBe('27:16')
  })

  it.each(['dropdown', 'radio', 'aspect-ratio'] as const)('%s 只能返回当前合法候选；空候选停止，不退回原始列表', async type => {
    const constrained: ModelDefinition = {
      ...definitionFor('kie-gpt-image-2.5'),
      params: [{ id: 'aspectRatio', type, order: 1, name: '比例', default: 'smart', options: [
        { value: 'smart', label: '智能' }, { value: '1:1', label: '1:1' }, { value: '3:2', label: '3:2' },
      ] }],
      linkages: [{ trigger: 'mode', target: 'aspectRatio', effect: 'filterOptions',
        filter: (mode, options) => options.filter(option => option.value === 'smart' || (mode === 'valid' && option.value === '3:2')) }],
    }
    const result = await normalizeSmartAspectParams(constrained, { mode: 'valid' })
    // 没有参考图时也不能回退到已被过滤掉的 1:1。
    expect(result.params.aspectRatio).toBe('3:2')
    await expect(normalizeSmartAspectParams(constrained, { mode: 'unavailable' })).rejects.toThrow('没有可用的图片比例')
  })

  it('连续修改分辨率、版本和提示词后仍保留智能选择，每次提交使用当前约束', async () => {
    const definition = definitionFor('kie-gpt-image-2.5')
    const saved = { prompt: 'first', images: [source], gpt25Variant: 'flare', gpt25Resolution: '1K', gpt25AspectRatio: 'smart' }
    vi.mocked(readImageInfo).mockResolvedValue(imageInfo(1600, 1000))
    const first = await normalizeSmartAspectParams(definition, saved)
    expect(first.params.gpt25AspectRatio).toBe('27:16')
    expect(saved.gpt25AspectRatio).toBe('smart')

    saved.prompt = 'edited prompt'
    saved.gpt25Resolution = '2K'
    saved.gpt25Variant = 'sunburst'
    // 参数编辑本身没有触发额外媒体读取；到生成提交才重新匹配。
    expect(readImageInfo).toHaveBeenCalledTimes(1)
    const second = await normalizeSmartAspectParams(definition, saved)
    expect(second.params).toMatchObject({ prompt: 'edited prompt', gpt25AspectRatio: '3:2' })
    expect(first.params.gpt25AspectRatio).toBe('27:16')
    expect(saved.gpt25AspectRatio).toBe('smart')

    saved.gpt25Resolution = '1K'
    expect((await normalizeSmartAspectParams(definition, saved)).params.gpt25AspectRatio).toBe('27:16')
  })

  it('切换模型或渠道后不复用上个模型算出的比例', async () => {
    vi.mocked(readImageInfo).mockResolvedValue(imageInfo(3000, 1000))
    const saved = { images: [source], gpt25AspectRatio: 'smart', gpt25Resolution: '1K' }
    expect((await normalizeSmartAspectParams(definitionFor('fal-ai-gpt-image-2.5'), saved)).params.gpt25AspectRatio).toBe('3:1')
    const apimart = definitionFor('apimart-gpt-image-2.5')
    expect((await normalizeSmartAspectParams(apimart, { ...saved, gpt25Channel: 'ext' })).params.gpt25AspectRatio).toBe('21:9')
    expect((await normalizeSmartAspectParams(apimart, { ...saved, gpt25Channel: 'official' })).params.gpt25AspectRatio).toBe('3:1')
    expect(saved.gpt25AspectRatio).toBe('smart')
  })

  it('替换、同路径编辑或移除参考图都会重新匹配，不信任旧的尺寸提示', async () => {
    const definition = definitionFor('kie-gpt-image-2.5')
    const saved = { images: [source], gpt25AspectRatio: 'smart', gpt25Resolution: '2K', __firstImageRatio: 99 }
    vi.mocked(readImageInfo).mockResolvedValue(imageInfo(1600, 1000))
    expect((await normalizeSmartAspectParams(definition, saved)).params.gpt25AspectRatio).toBe('3:2')
    vi.mocked(readImageInfo).mockResolvedValue(imageInfo(1000, 1600))
    expect((await normalizeSmartAspectParams(definition, saved)).params.gpt25AspectRatio).toBe('2:3')
    vi.mocked(readImageInfo).mockResolvedValue(imageInfo(900, 1600))
    expect((await normalizeSmartAspectParams(definition, { ...saved, images: ['replacement.png'] })).params.gpt25AspectRatio).toBe('9:16')
    const empty = await normalizeSmartAspectParams(definition, { ...saved, images: [] })
    expect(empty.params.gpt25AspectRatio).toBe('1:1')
    expect(empty.params).not.toHaveProperty('__firstImageRatio')
    expect(readImageInfo).toHaveBeenCalledTimes(3)
  })

  it.each(['flare', 'sunburst'].flatMap(variant => ['1K', '2K', '4K'].map(resolution => [variant, resolution])))('KIE %s %s 按当前合法比例匹配参考图', async (variant, resolution) => {
    const id = 'kie-gpt-image-2.5'
    const runtime = catalog.find(entry => entry.meta.id === id)!
    const definition = composeModelDefinition(runtime, gptImage25Presentation[id])
    vi.mocked(readImageInfo).mockResolvedValue(imageInfo(1600, 1000))
    const result = await normalizeSmartAspectParams(definition, {
      prompt: 'fixture', images: [source], gpt25Variant: variant,
      gpt25Resolution: resolution, gpt25AspectRatio: 'smart',
    })
    const ratio = resolution === '1K' ? '27:16' : '3:2'
    expect(result.params.gpt25AspectRatio).toBe(ratio)
    expect(await runtime.request!.builder!(result.params)).toMatchObject({ input: { aspect_ratio: ratio, resolution } })
    expect(cropImageSource).not.toHaveBeenCalled()
  })

  it.each([
    ['apimart-gpt-image-2.5', { gpt25Channel: 'ext' }, 3, '21:9'],
    ['grsai-gpt-image-2.5', { gpt25Variant: 'sunburst', gpt25Resolution: '2K' }, 1 / 3, '9:21'],
  ] as const)('%s 同样排除渠道或分辨率禁用的比例', async (id, changes, ratio, expected) => {
    const runtime = catalog.find(entry => entry.meta.id === id)!
    const definition = composeModelDefinition(runtime, gptImage25Presentation[id])
    vi.mocked(readImageInfo).mockResolvedValue(imageInfo(ratio * 1200, 1200))
    const result = await normalizeSmartAspectParams(definition, { images: [source], gpt25AspectRatio: 'smart', ...changes })
    expect(result.params.gpt25AspectRatio).toBe(expected)
  })
})

describe('单图处理按源图匹配画幅', () => {
  it.each(tools)('%s 的旧固定比例被纠正，真实 builder 收到裁剪图和匹配比例', async (name) => {
    const original = { images: [source], uploadedFilePaths: [source], image: [source], aspectRatio: '1:1' }
    const result = await normalizeSmartAspectParams(model(name), original, 'framing-test')
    expect(cropImageSource).toHaveBeenCalledTimes(1)
    expect(cropImageSource).toHaveBeenCalledWith({ source, aspectRatio: '3:4' })
    expect(result.params).toMatchObject({ images: [cropped], uploadedFilePaths: [cropped], image: [cropped], aspectRatio: '3:4' })
    expect(await model(name).request!.builder!(result.params)).toMatchObject({
      image_url: cropped,
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
