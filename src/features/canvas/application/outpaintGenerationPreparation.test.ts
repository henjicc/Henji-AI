// @vitest-environment jsdom
import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { loadRealModelsIntoRegistry } from '@/tests/loadRealModels'
import { persistImageSourceTracked, readImageInfo } from '@/commands/image'
import { prepareOutpaintGeneration } from './outpaintGenerationPreparation'
import type { GenerationNodeRuntimePreparationContext } from '../nodes/shared/generationNodeExecutionTypes'

vi.mock('@/commands/image', () => ({ readImageInfo: vi.fn(), persistImageSourceTracked: vi.fn() }))
vi.mock('./outpaintPreviewTexture', () => ({ getOutpaintPreview: vi.fn(async () => 'data:image/png;base64,blur') }))
const canvasSizes: number[][] = []
beforeAll(async () => { await loadRealModelsIntoRegistry() })
beforeEach(() => {
  vi.clearAllMocks(); canvasSizes.length = 0
  vi.mocked(readImageInfo).mockResolvedValue({ width: 800, height: 1200 } as Awaited<ReturnType<typeof readImageInfo>>)
  vi.mocked(persistImageSourceTracked).mockResolvedValue({ imagePath: 'D:/prepared.png', createdFilePaths: ['D:/prepared.png'] })
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, blob: async () => new Blob() })))
  vi.stubGlobal('Image', class { src = ''; naturalWidth = 800; naturalHeight = 1200; async decode() {} })
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = vi.fn(() => 'blob:source')
    static revokeObjectURL = vi.fn()
  })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({
    drawImage: vi.fn(), fillRect: vi.fn(), createLinearGradient: () => ({ addColorStop: vi.fn() }),
  }) as unknown as CanvasRenderingContext2D)
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(function (this: HTMLCanvasElement) {
    canvasSizes.push([this.width, this.height]); return 'data:image/png;base64,composed'
  })
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

function context(modelId: string): GenerationNodeRuntimePreparationContext {
  return { modelId, images: ['D:/source.png'], videos: [], audios: [],
    data: { outpaintMargins: { expandLeft: 600, expandRight: 600, expandTop: 0, expandBottom: 0 } },
    params: { prompt: '保留蓝色衣服', kieGptImage2AspectRatio: '9:16', expandLeft: 0, quality: 'high', images: ['D:/source.png'] } }
}
describe('扩图生成前处理', () => {
  it('编辑模型收到模糊合成图、修复提示词及最终框比例，资源交给执行器回收', async () => {
    const result = await prepareOutpaintGeneration(context('kie-gpt-image-2'))
    expect(canvasSizes).toEqual([[2000, 1200]])
    expect(result.inputs?.images).toEqual(['D:/prepared.png'])
    expect(result.createdFilePaths).toEqual(['D:/prepared.png'])
    expect(result.params?.prompt).toContain('修复图片周围的模糊区域')
    expect(result.params?.prompt).toContain('保留蓝色衣服')
    expect(result.params?.quality).toBe('high')
    expect(result.params?.kieGptImage2AspectRatio).toBe('16:9')
    expect(result.params?.images).toEqual(['D:/prepared.png'])
    expect(result.params).not.toHaveProperty('expandLeft')
  })
  it('专用扩图保留原图链路，不合成模糊输入、不附加修复提示词', async () => {
    const result = await prepareOutpaintGeneration(context('fal-image-apps-v2-outpaint'))
    expect(result.inputs).toBeUndefined()
    expect(result.params).toMatchObject({ expandLeft: 600, expandRight: 600, zoomOutPercentage: 0, prompt: '保留蓝色衣服' })
    expect(fetch).not.toHaveBeenCalled()
    expect(persistImageSourceTracked).not.toHaveBeenCalled()
  })
  it('图片读取或合成失败就停止，不悄悄退回原图生成', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('cannot read'))
    await expect(prepareOutpaintGeneration(context('kie-gpt-image-2'))).rejects.toThrow('cannot read')
    expect(persistImageSourceTracked).not.toHaveBeenCalled()
  })
})
