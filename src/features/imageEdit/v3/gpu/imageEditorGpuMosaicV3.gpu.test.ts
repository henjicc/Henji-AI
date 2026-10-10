import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { init, type Gpu } from 'vgpu/node'
import { createImageEditDocumentV3, createImageEditEffectLayerV3, createImageEditRasterLayerV3, decodeInterleavedRgbaSourceTileV3 } from '@/core/imageEdit/v3'
import { executeMosaicCpu } from '@/core/imaging/effects/cpu/mosaic'
import type { ImageEditorV3SourceTile } from '@/platform/contracts/imageEditorV3'
import { compileImageEditorGpuRasterSceneV3 } from './imageEditorGpuRasterSceneCompilerV3'
import { ImageEditorGpuRasterCompositorV3 } from './imageEditorGpuRasterCompositorV3'
import { imageEditorGpuSceneTileKeyV3 } from './imageEditorGpuSceneProtocolV3'
import type { ImageEditorViewportLayoutV3 } from '../editor/useImageEditorViewportLayoutV3'

describe('共享马赛克 GPU 像素', () => {
  let gpu: Gpu
  beforeAll(async () => { gpu = await init() })
  afterAll(() => gpu?.dispose())
  it('完整画面与离原点的局部视口均按全局色块网格平均，透明边缘与 CPU 一致', async () => {
    const resourceRef = `sha256:${'a'.repeat(64)}` as const
    const width = 13, height = 9, pixels = Uint8Array.from({ length: width * height * 4 }, (_, i) => i % 4 === 3 ? i % 3 === 0 ? 0 : 192 : i * 37 % 256)
    const source: ImageEditorV3SourceTile = { resourceRef, mip: 0, tileX: 0, tileY: 0, width, height, halo: 0, bitDepth: 8,
      sampleFormat: 'uint', numericRange: 'unorm8', channels: 4, byteOrder: 'little-endian', rowStride: width * 4,
      colorSpace: 'srgb', transferFunction: 'srgb', alphaMode: 'straight', orientationApplied: true, originX: 0, originY: 0, pixels: pixels.buffer }
    const document = createImageEditDocumentV3({ width, height })
    document.layers = [createImageEditRasterLayerV3('source', '原图', resourceRef), createImageEditEffectLayerV3('mosaic', '马赛克', 'mosaic', { block_fraction_height: 4 / height })]
    const compiled = compileImageEditorGpuRasterSceneV3(document, [{ resourceRef, byteLength: pixels.byteLength, mediaType: 'image/png' }])
    if (!compiled.supported) throw new Error(compiled.reason)
    const input = decodeInterleavedRgbaSourceTileV3({ ...source, colorSpace: 'srgb' })
    const expected = executeMosaicCpu({ blockSize: 4, width, height }, { x: 0, y: 0, width, height, data: input.data }, { x: 0, y: 0, width, height })
    const compositor = new ImageEditorGpuRasterCompositorV3(gpu)
    const resources = new Map<string, ReturnType<typeof compositor.uploadTile>>()
    try {
      compositor.syncScene(compiled.scene)
      for (const [x, y, w, h] of [[0,0,width,height], [5,3,7,5]]) {
        const layout: ImageEditorViewportLayoutV3 = { stageWidth: w, stageHeight: h, viewportKey: `${x}:${y}`, viewport: { width: w, height: h,
          documentX: x, documentY: y, zoom: 1, devicePixelRatio: 1, interacting: false, velocityX: 0, velocityY: 0 } }
        compositor.updateViewport(layout)
        for (const key of compositor.requiredResourceKeys()) if (!resources.has(imageEditorGpuSceneTileKeyV3(key))) resources.set(imageEditorGpuSceneTileKeyV3(key), compositor.uploadTile(key, source))
        const result = await compositor.readLinearPixelsForTest(key => resources.get(imageEditorGpuSceneTileKeyV3(key)) ?? null)
        for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) for (let c = 0; c < 4; c++) expect(result[(py * w + px) * 4 + c]).toBeCloseTo(expected[((y + py) * width + x + px) * 4 + c], 3)
      }
    } finally { for (const value of resources.values()) value.destroy(); compositor.dispose() }
  })
})
