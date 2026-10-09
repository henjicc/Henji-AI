import { createImageEditSparseMaskReferenceV3 } from '@/core/imageEdit/v3/layerTypes'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { init, type Gpu } from 'vgpu/node'
import { createImageEditDocumentV3, createImageEditEffectLayerV3, createImageEditAdjustmentLayerV3, createImageEditRasterLayerV3 } from '@/core/imageEdit/v3/documentFactory'
import { createBuiltInImageEditRenderNodeRegistry } from '@/core/imageEdit/v3/builtInRenderNodes'
import { compileImageEditRenderPlanV3 } from '@/core/imageEdit/v3/renderPlanCompiler'
import { executeImageEditCpuRenderPlanV3 } from '@/core/imageEdit/v3/execution/cpuRenderPlanExecutor'
import { decodeInterleavedRgbaSourceTileV3 } from '@/core/imageEdit/v3/execution/sourceTileDecode'
import { convertFloat32TileColorDomainV3 } from '@/core/imageEdit/v3/execution/tileColor'
import type { ImageEditJsonObjectV3 } from '@/core/imageEdit/v3/layerTypes'
import type { ImageEditorV3SourceTile } from '@/platform/contracts/imageEditorV3'
import { ImageEditorGpuRasterCompositorV3 } from './imageEditorGpuRasterCompositorV3'
import { compileImageEditorGpuRasterSceneV3 } from './imageEditorGpuRasterSceneCompilerV3'
import { imageEditorGpuSceneTileKeyV3 } from './imageEditorGpuSceneProtocolV3'
import { measureImageGaussianRegionsV3 } from './imageEditorGpuGaussianMeasurementsV3.testSupport'
import { appendFileSync } from 'node:fs'

let gpu: Gpu
const errors: string[] = []
beforeAll(async () => { gpu = await init(); gpu.onError(error => { errors.push(String(error)) }) })
afterAll(() => gpu?.dispose())

it.skipIf(process.env.HENJI_GPU_MEASURE !== '1' || !!process.env.CI)('t117 本机大图区域高斯性能', async () => {
  await measureImageGaussianRegionsV3(gpu)
}, 600_000)

const cases: Array<[string, ImageEditJsonObjectV3]> = [
  ['exposure', { stops: .3, offset: .01, gamma: 1.1 }],
  ['curves', { master: [{ x: 0, y: 0 }, { x: .5, y: .6 }, { x: 1, y: 1 }] }],
  ['temperature-tint', { temperature: .2, tint: -.1 }],
  ['hsl', { hueDegrees: 25, saturation: .1, lightness: -.1 }],
  ['color_grade', { exposure: .2, saturation: 10 }],
  ['gaussian_blur', { sigma_fraction_height: .08, axis: 'both', edge_mode: 'transparent' }],
  ['gaussian_blur', { sigma_fraction_height: .25, axis: 'both', edge_mode: 'transparent' }],
  ['gaussian_blur', { sigma_fraction_height: .0019, axis: 'horizontal', edge_mode: 'clamp' }],
  ['gaussian_blur', { sigma_fraction_height: 0, axis: 'vertical', edge_mode: 'clamp' }],
]

it.each(['stable', 'export'] as const)('%s 正式图片登记的 CPU/GPU 同参数逐像素一致且没有设备验证错误', async quality => {
  const width = 129, height = 131
  const resourceRef = `sha256:${'a'.repeat(64)}` as const
  const pixels = Uint8Array.from({ length: width * height * 4 }, (_, i) => i % 4 === 3 ? 128 + i % 127 : (i * 17) % 256)
  const source: ImageEditorV3SourceTile = { resourceRef, mip: 0, tileX: 0, tileY: 0, width, height,
    halo: 0, bitDepth: 8, sampleFormat: 'uint', numericRange: 'unorm8', channels: 4, byteOrder: 'little-endian', rowStride: width * 4,
    colorSpace: 'srgb', transferFunction: 'srgb', alphaMode: 'straight', orientationApplied: true,
    originX: 0, originY: 0, pixels: pixels.buffer }
  errors.length = 0
  gpu.gpu.pushErrorScope('validation')
  try {
    for (const [id, params] of cases) {
      const document = createImageEditDocumentV3({ width, height })
      document.layers = [createImageEditRasterLayerV3('source', '源', resourceRef),
        (id === 'gaussian_blur' ? createImageEditEffectLayerV3 : createImageEditAdjustmentLayerV3)('processor', '处理', id, params)]
      const compiled = compileImageEditorGpuRasterSceneV3(document, [{ resourceRef, byteLength: pixels.byteLength, mediaType: 'image/png' }], undefined, quality)
      if (!compiled.supported) throw new Error(compiled.reason)
      const compositor = new ImageEditorGpuRasterCompositorV3(gpu)
      const uploaded = new Map<string, ReturnType<typeof compositor.uploadTile>>()
      try {
        compositor.syncScene(compiled.scene)
        compositor.updateViewport({ stageWidth: width, stageHeight: height, viewportKey: `${id}:${quality}`,
          viewport: { documentX: 0, documentY: 0, width, height, zoom: 1, devicePixelRatio: 1 } })
        for (const key of compositor.requiredResourceKeys()) uploaded.set(imageEditorGpuSceneTileKeyV3(key), compositor.uploadTile(key, source))
        const candidate = await compositor.readLinearPixelsForTest(key => uploaded.get(imageEditorGpuSceneTileKeyV3(key)) ?? null)
        const plan = compileImageEditRenderPlanV3(document, createBuiltInImageEditRenderNodeRegistry(), quality)
        const cpu = await executeImageEditCpuRenderPlanV3(plan, { loadRaster: async () => decodeInterleavedRgbaSourceTileV3({ ...source, colorSpace: 'srgb' }),
          rasterizeAnnotations: async () => { throw new Error('无标注') } })
        if (!cpu) throw new Error('没有 CPU 结果')
        const reference = convertFloat32TileColorDomainV3(cpu, 'linear-light').data
        expect(candidate.some(value => value > .1), id).toBe(true)
        let maximum = 0, squared = 0
        candidate.forEach((value, index) => { const error = Math.abs(value - reference[index]); maximum = Math.max(maximum, error); squared += error * error })
        if (process.env.HENJI_GPU_PRECISION_PATH && id === 'gaussian_blur') {
          const channelRmse = Array.from({ length: 4 }, (_, channel) => {
            let squared = 0, bias = 0
            for (let i = channel; i < candidate.length; i += 4) { const delta = candidate[i] - reference[i]; squared += delta * delta; bias += delta }
            return { rmse: Math.sqrt(squared / (candidate.length / 4)), bias: bias / (candidate.length / 4) }
          })
          appendFileSync(process.env.HENJI_GPU_PRECISION_PATH, JSON.stringify({ quality, params, maximum, rmse: Math.sqrt(squared / candidate.length), channelRmse }) + '\n')
        }
        // 金字塔使用 fp32，避免整条预览链多次 fp16 写入累计；两档整链恢复同一 RMSE 门槛。
        expect(maximum, `${id}:${JSON.stringify(params)}`).toBeLessThan(id === 'color_grade' ? 2 / 255 : .002)
        expect(Math.sqrt(squared / candidate.length), id).toBeLessThan(id === 'color_grade' ? 1 / 255 : .0005)
        if (id === 'gaussian_blur' && params.sigma_fraction_height === .25) {
          // 真视口/tile 管线必须保留整幅计划的采样相位，不能把 tile 当作新的文档。
          const region = { x: 43, y: 47, width: 49, height: 53 }
          compositor.updateViewport({ stageWidth: region.width, stageHeight: region.height, viewportKey: `${id}:${quality}:region`,
            viewport: { documentX: region.x, documentY: region.y, width: region.width, height: region.height, zoom: 1, devicePixelRatio: 1 } })
          const window = await compositor.readLinearPixelsForTest(key => uploaded.get(imageEditorGpuSceneTileKeyV3(key)) ?? null)
          for (let y = 0; y < region.height; y++) for (let x = 0; x < region.width; x++) for (let channel = 0; channel < 4; channel++) {
            expect(window[(y * region.width + x) * 4 + channel]).toBeCloseTo(candidate[((y + region.y) * width + x + region.x) * 4 + channel], 5)
          }
        }
      } finally { for (const texture of uploaded.values()) texture.destroy(); compositor.dispose() }
    }
  } finally {
    expect(await gpu.gpu.popErrorScope()).toBeNull()
    expect(errors).toEqual([])
  }
}, 30000)

it.each(['stable', 'export'] as const)('%s：真实区域/tile、mip、串联与混合保留整幅网格相位', async quality => {
  const width = 509, height = 387
  const resourceRef = `sha256:${'b'.repeat(64)}` as const
  const maskRef = `sha256:${'c'.repeat(64)}` as const
  const data = Uint8Array.from({ length: width * height * 4 }, (_, i) => i % 4 === 3 ? 128 + i % 127 : (i * 17) % 256)
  const source: ImageEditorV3SourceTile = { resourceRef, mip: 0, tileX: 0, tileY: 0, width, height, halo: 0,
    bitDepth: 8, sampleFormat: 'uint', numericRange: 'unorm8', channels: 4, byteOrder: 'little-endian', rowStride: width * 4,
    colorSpace: 'srgb', transferFunction: 'srgb', alphaMode: 'straight', orientationApplied: true, originX: 0, originY: 0, pixels: data.buffer }
  for (const axis of ['both', 'horizontal', 'vertical']) for (const scale of [1, .75]) {
    const document = createImageEditDocumentV3({ width, height })
    const first = createImageEditEffectLayerV3('first', '高斯', 'gaussian_blur', { sigma_fraction_height: .003, axis, edge_mode: 'transparent' })
    first.opacity = .81; first.mask = { ...createImageEditSparseMaskReferenceV3(maskRef, true), tiles: { '0/0/0': maskRef } }
    const second = createImageEditEffectLayerV3('second', '串联', 'gaussian_blur', { sigma_fraction_height: .03, axis, edge_mode: 'clamp' })
    second.opacity = .73; second.blendMode = 'screen'
    second.mask = { ...createImageEditSparseMaskReferenceV3(maskRef, false), tiles: { '0/0/0': maskRef } }
    const raster = createImageEditRasterLayerV3('source', '源', resourceRef)
    raster.transform = [1.2, .15, -.2, .9, 12.3, -5.2]
    document.layers = [raster, first,
      createImageEditAdjustmentLayerV3('exposure', '曝光', 'exposure', { stops: .2 }), second]
    const compiled = compileImageEditorGpuRasterSceneV3(document, [resourceRef, maskRef].map(resourceRef => ({ resourceRef, byteLength: data.byteLength, mediaType: 'image/png' })), undefined, quality)
    if (!compiled.supported) throw new Error(compiled.reason)
    const compositor = new ImageEditorGpuRasterCompositorV3(gpu)
    const uploaded = new Map<string, ReturnType<typeof compositor.uploadTile>>()
    const resolve = (key: Parameters<typeof imageEditorGpuSceneTileKeyV3>[0]): ReturnType<typeof compositor.uploadTile> | null => uploaded.get(imageEditorGpuSceneTileKeyV3(key)) ?? null
    const render = async (x: number, y: number, w: number, h: number, exporting = false): Promise<Float32Array> => {
      const layout = { stageWidth: w, stageHeight: h, viewportKey: `${x}:${y}:${w}:${h}:${exporting}`, viewport: { documentX: x / scale, documentY: y / scale, width: w, height: h, zoom: scale, devicePixelRatio: 1 } }
      if (exporting) compositor.updateExportViewport(layout, [Math.ceil(width * scale), Math.ceil(height * scale)])
      else compositor.updateViewport(layout)
      for (const key of compositor.requiredResourceKeys()) if (!resolve(key)) uploaded.set(imageEditorGpuSceneTileKeyV3(key), compositor.uploadTile(key,
        key.resourceRef === maskRef ? { ...source, resourceRef: maskRef } : source))
      return await compositor.readLinearPixelsForTest(resolve)
    }
    try {
      compositor.syncScene(compiled.scene)
      const w = Math.ceil(width * scale), h = Math.ceil(height * scale)
      const full = await render(0, 0, w, h)
      for (const region of [{ x: 143, y: 107, width: 49, height: 53 }, { x: 0, y: 0, width: 43, height: 41 }, { x: w - 47, y: h - 39, width: 47, height: 39 }]) {
        for (const exporting of [false, true]) {
          const local = await render(region.x, region.y, region.width, region.height, exporting)
          let maximum = 0
          for (let y = 0; y < region.height; y++) for (let x = 0; x < region.width; x++) for (let c = 0; c < 4; c++) maximum = Math.max(maximum, Math.abs(local[(y * region.width + x) * 4 + c] - full[((region.y + y) * w + region.x + x) * 4 + c]))
          expect(maximum, JSON.stringify({ axis, scale, region, exporting })).toBeLessThan(.00001)
        }
      }
      const outside = await render(-10000, -10000, 20, 20)
      expect(outside.every(value => value === 0)).toBe(true)
      expect(compositor.snapshotStats().maximumGraphTargetWidth).toBeLessThanOrEqual(w)
    } finally { for (const allocation of uploaded.values()) allocation.destroy(); compositor.dispose() }
  }
}, 60_000)
