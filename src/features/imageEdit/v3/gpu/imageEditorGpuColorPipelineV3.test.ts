import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { init, type Gpu } from 'vgpu/node'

import {
  convertFloat32TileWorkingSpaceV3,
  createFloat32PremultipliedRgbaTile,
  decodeInterleavedRgbaSourceTileV3,
  encodeSrgbExtended,
  toneMapFloat32TileToSdrV3,
} from '@/core/imageEdit/v3'
import { createImageEditHdrMetadataV3, type ImageEditColorModeV3 } from '@/core/imageEdit/v3/colorTypes'
import { createImageEditDocumentV3, createImageEditRasterLayerV3 } from '@/core/imageEdit/v3/documentFactory'
import type { ImageEditorV3SourceTile } from '@/platform/contracts/imageEditorV3'
import { ImageEditorGpuRasterCompositorV3 } from './imageEditorGpuRasterCompositorV3'
import { compileImageEditorGpuRasterSceneV3 } from './imageEditorGpuRasterSceneCompilerV3'
import { renderImageEditorGpuSdrColorProbeV3 } from './imageEditorGpuColorProbeV3'

const RESOURCE = `sha256:${'c'.repeat(64)}` as const
let gpu: Gpu

beforeAll(async () => { gpu = await init() })
afterAll(() => gpu.dispose())

describe('GPU 宽色域/HDR 色彩管线（真实 WebGPU）', () => {
  it.each([
    ['display-p3', 'srgb'],
    ['rec2020', 'pq'],
    ['rec2020', 'hlg'],
  ] as const)('%s/%s 线性中间结果与 CPU golden 的 HDR/Float 相对误差≤1e-3', async (
    workingSpace,
    transferFunction,
  ) => {
    const color: ImageEditColorModeV3 = {
      workingSpace,
      bitDepth: 'float16',
      transferFunction,
      hdrMetadata: transferFunction === 'srgb' ? null : createImageEditHdrMetadataV3(transferFunction),
      iccProfileResourceId: transferFunction === 'srgb' ? 'icc:display-p3-test' : null,
    }
    const { compositor, source, resolve } = createColorScene(color)
    const actual = await compositor.readLinearPixelsForTest(resolve)
    const expected = decodeInterleavedRgbaSourceTileV3({ ...source, colorSpace: 'srgb' }, workingSpace).data
    const relativeError = maxRelativeError(expected, actual)
    if (process.env.REPORT_GPU_COLOR === '1') {
      process.stdout.write(`[image-editor-gpu-color] ${JSON.stringify({
        workingSpace, transferFunction, relativeError,
      })}\n`)
    }
    expect(relativeError).toBeLessThanOrEqual(1e-3)
    resolve().destroy()
    compositor.dispose()
  })

  it.each(['pq', 'hlg'] as const)('%s SDR tone-map 与 CPU golden 保持 1 LSB', async (standard) => {
    const color: ImageEditColorModeV3 = {
      workingSpace: 'rec2020', bitDepth: 'float16', transferFunction: standard,
      hdrMetadata: createImageEditHdrMetadataV3(standard), iccProfileResourceId: null,
    }
    const hdrMetadata = color.hdrMetadata!
    const input = createFloat32PremultipliedRgbaTile(
      2, 1, 'linear-light', Float32Array.from([2.5, 0.4, 0.1, 1, 0.2, 1.8, 0.6, 0.75]),
      'rec2020', standard, hdrMetadata.referenceWhiteNits,
    )
    const expected = toneMapFloat32TileToSdrV3(input, 'srgb').data
    const actual = await renderImageEditorGpuSdrColorProbeV3(gpu, input.data, 2, 1, color)
    const lsbError = maxLsbError(expected, actual)
    if (process.env.REPORT_GPU_COLOR === '1') {
      process.stdout.write(`[image-editor-gpu-color] ${JSON.stringify({ standard, lsbError })}\n`)
    }
    expect(lsbError).toBeLessThanOrEqual(1)
  })

  it('Display-P3 SDR 转 sRGB 不修改 ICC/CICP/参考白元数据', async () => {
    const color: ImageEditColorModeV3 = {
      workingSpace: 'display-p3', bitDepth: 16, transferFunction: 'srgb',
      hdrMetadata: null, iccProfileResourceId: 'icc:p3-profile',
    }
    const input = createFloat32PremultipliedRgbaTile(
      1, 1, 'linear-light', Float32Array.from([0.2, 0.8, 0.1, 1]), 'display-p3', 'srgb', 203,
    )
    const converted = convertFloat32TileWorkingSpaceV3(input, 'srgb')
    const expected = Float32Array.from([
      encodeSrgbExtended(converted.data[0]),
      encodeSrgbExtended(converted.data[1]),
      encodeSrgbExtended(converted.data[2]),
      1,
    ])
    const actual = await renderImageEditorGpuSdrColorProbeV3(gpu, input.data, 1, 1, color)
    expect(maxLsbError(expected, actual)).toBeLessThanOrEqual(1)
    const document = createImageEditDocumentV3({ width: 1, height: 1 })
    document.color = structuredClone(color)
    document.layers = [createImageEditRasterLayerV3('source', '源', RESOURCE)]
    const compiled = compileImageEditorGpuRasterSceneV3(document, [{
      resourceRef: RESOURCE, byteLength: 16, mediaType: 'image/tiff',
    }])
    expect(compiled.supported && compiled.scene.color).toEqual(color)
    expect(document.color).toEqual(color)
  })
})

function createColorScene(color: ImageEditColorModeV3) {
  const document = createImageEditDocumentV3({ width: 2, height: 1 })
  document.color = structuredClone(color)
  document.layers = [createImageEditRasterLayerV3('source', '源', RESOURCE)]
  const compilation = compileImageEditorGpuRasterSceneV3(document, [{
    resourceRef: RESOURCE, byteLength: 32, mediaType: 'image/tiff',
  }])
  if (!compilation.supported) throw new Error(compilation.reason)
  const compositor = new ImageEditorGpuRasterCompositorV3(gpu)
  compositor.syncScene(compilation.scene)
  compositor.updateViewport({
    stageWidth: 2, stageHeight: 1, viewportKey: 'color',
    viewport: { documentX: 0, documentY: 0, width: 2, height: 1, zoom: 1, devicePixelRatio: 1 },
  })
  const key = compositor.requiredResourceKeys()[0]
  const values = Float32Array.from([2.5, -0.25, 0.5, 0.4, 0.2, 1.5, 0.75, 1])
  const source: ImageEditorV3SourceTile = {
    resourceRef: RESOURCE, mip: 0, tileX: 0, tileY: 0, halo: 0,
    width: 2, height: 1, channels: 4, bitDepth: 32, sampleFormat: 'float', numericRange: 'scene-linear',
    byteOrder: 'little-endian', rowStride: 32, colorSpace: 'scrgb', transferFunction: 'linear',
    alphaMode: 'straight', orientationApplied: true, originX: 0, originY: 0, pixels: values.buffer,
  }
  const allocation = compositor.uploadTile(key, source)
  return { compositor, source, resolve: () => allocation }
}

function maxRelativeError(expected: Float32Array, actual: Float32Array): number {
  let result = 0
  for (let index = 0; index < expected.length; index += 1) {
    result = Math.max(result, Math.abs(expected[index] - actual[index]) / Math.max(1, Math.abs(expected[index])))
  }
  return result
}

function maxLsbError(expected: Float32Array, actual: Float32Array): number {
  let result = 0
  for (let index = 0; index < expected.length; index += 1) {
    result = Math.max(result, Math.abs(Math.round(expected[index] * 255) - Math.round(actual[index] * 255)))
  }
  return result
}
