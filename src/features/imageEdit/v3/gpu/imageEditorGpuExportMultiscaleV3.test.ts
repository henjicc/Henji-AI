import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { init, type Gpu } from 'vgpu/node'
import type { Target } from 'vgpu'

import {
  createImageEditDocumentV3,
  createImageEditEffectLayerV3,
  createImageEditRasterLayerV3,
  compileImageEditRenderPlanV3,
  convertFloat32TileColorDomainV3,
  createBuiltInImageEditRenderNodeRegistry,
  decodeInterleavedRgbaSourceTileV3,
  executeImageEditCpuRenderPlanV3,
  resampleImageEditMaskAffineV3,
  resampleImageEditRgbaAffineV3,
  type ImageEditDocumentV3,
  type ImageEditJsonObjectV3,
} from '@/core/imageEdit/v3'
import { createDefaultVgpuGlowOperationParams } from '@/core/imageEdit/vgpuGlowParams'
import { createDefaultDiffusionOperationParams } from '@/core/imageEdit/diffusionParams'
import type { ImageEditorV3SourceTile } from '@/platform/contracts/imageEditorV3'
import { ImageEditorGpuExportResidualV3 } from './imageEditorGpuExportResidualV3'
import { ImageEditorGpuRasterCompositorV3 } from './imageEditorGpuRasterCompositorV3'
import { compileImageEditorGpuRasterSceneV3 } from './imageEditorGpuRasterSceneCompilerV3'
import { imageEditorGpuSceneTileKeyV3, type ImageEditorGpuSceneExportTilePlanV3 } from './imageEditorGpuSceneProtocolV3'

const WIDTH = 1024
const HEIGHT = 256
const ANALYSIS_WIDTH = 512
const ANALYSIS_HEIGHT = 128
const RESOURCE = `sha256:${'8'.repeat(64)}` as const
let gpu: Gpu
const registry = createBuiltInImageEditRenderNodeRegistry()

beforeAll(async () => { gpu = await init() })
afterAll(() => gpu.dispose())

describe('GPU 多尺度分块导出（真实WebGPU）', () => {
  it.each([
    ['fast-blur', 'image.fast-blur-v3', { radius: 1000, mip: 0 }],
    ['diffusion', 'image.diffusion', { ...createDefaultDiffusionOperationParams(),
      mode: 'glow', strength: 1, glowRange: 1, softness: 1 }],
    ['glow', 'image.vgpu-glow', { ...createDefaultVgpuGlowOperationParams(), intensity: 1,
      radius: 1, chromaticAberration: 1 }],
  ] as const)('最大合法%s在core边界与全图GPU参考SSIM>=0.999且无可测接缝', async (
    label, effectId, parameters,
  ) => {
    const document = createImageEditDocumentV3({ width: WIDTH, height: HEIGHT })
    document.layers = [
      createImageEditRasterLayerV3('source', '源', RESOURCE),
      createImageEditEffectLayerV3(label, label, effectId,
        parameters as unknown as ImageEditJsonObjectV3),
    ]
    const descriptor = [{ resourceRef: RESOURCE, byteLength: WIDTH * HEIGHT * 4,
      mediaType: 'image/png' }]
    const compiled = compileImageEditorGpuRasterSceneV3(document, descriptor)
    expect(compiled.supported).toBe(true)
    if (!compiled.supported) throw new Error(compiled.reason)

    const whole = new ImageEditorGpuRasterCompositorV3(gpu)
    whole.syncScene(compiled.scene)
    whole.updateExportViewport(layout('whole', 0, 0, WIDTH, HEIGHT, WIDTH), [WIDTH, HEIGHT])
    const wholeResources = uploadRequired(whole)
    const reference = await whole.readExportLinearPixels(resolve(wholeResources))
    const cpu = await cpuReference(document)
    expect(ssim(cpu, reference)).toBeGreaterThanOrEqual(0.999)

    const residual = new ImageEditorGpuExportResidualV3(gpu)
    const analysis = new ImageEditorGpuRasterCompositorV3(gpu)
    analysis.syncScene(compiled.scene)
    analysis.updateExportViewport(layout('global', 0, 0, ANALYSIS_WIDTH, ANALYSIS_HEIGHT,
      ANALYSIS_WIDTH))
    const analysisResources = uploadRequired(analysis)
    const globalTarget = await analysis.renderExportTarget(resolve(analysisResources)) as Target
    const global = await residual.clone(globalTarget, 'multiscale-global')
    release(analysisResources)
    analysis.dispose()

    const local = new ImageEditorGpuRasterCompositorV3(gpu)
    local.syncScene(compiled.scene)
    const localResources = new Map<string, ReturnType<typeof local.uploadTile>>()
    const candidate = new Float32Array(WIDTH * HEIGHT * 4)
    const plans: ImageEditorGpuSceneExportTilePlanV3[] = [
      { tileX: 0, tileY: 0, x: 0, y: 0, width: 512, height: HEIGHT,
        renderX: 0, renderY: 0, renderWidth: 768, renderHeight: HEIGHT,
        coreOffsetX: 0, coreOffsetY: 0 },
      { tileX: 1, tileY: 0, x: 512, y: 0, width: 512, height: HEIGHT,
        renderX: 256, renderY: 0, renderWidth: 768, renderHeight: HEIGHT,
        coreOffsetX: 256, coreOffsetY: 0 },
    ]
    const renderOverlapCore = async (plan: ImageEditorGpuSceneExportTilePlanV3) => {
      await residual.beginOverlapAdd(global,
        { x: plan.x, y: plan.y, width: plan.width, height: plan.height }, [WIDTH, HEIGHT])
      for (const patch of plans) {
        local.updateExportViewport(layout(`high-${patch.tileX}`, patch.renderX, patch.renderY,
          patch.renderWidth, patch.renderHeight, WIDTH), [WIDTH, HEIGHT])
        uploadRequired(local, localResources)
        const highTarget = await local.renderExportTarget(resolve(localResources)) as Target
        const high = await residual.clone(highTarget, `high-${patch.tileX}`)
        const lowPlan = scalePlan(patch, ANALYSIS_WIDTH, ANALYSIS_HEIGHT)
        local.updateExportViewport(layout(`low-${patch.tileX}`, lowPlan.renderX, lowPlan.renderY,
          lowPlan.renderWidth, lowPlan.renderHeight, ANALYSIS_WIDTH),
        [ANALYSIS_WIDTH, ANALYSIS_HEIGHT])
        uploadRequired(local, localResources)
        const lowTarget = await local.renderExportTarget(resolve(localResources)) as Target
        const low = await residual.clone(lowTarget, `low-${patch.tileX}`)
        await residual.accumulatePatch(high, low,
          { x: plan.x, y: plan.y, width: plan.width, height: plan.height },
          { x: patch.renderX, y: patch.renderY,
            width: patch.renderWidth, height: patch.renderHeight },
          { x: patch.x, y: patch.y, width: patch.width, height: patch.height },
          [WIDTH, HEIGHT], [512, HEIGHT])
        high.color.destroy()
        low.color.destroy()
      }
      return await residual.readOverlapAdd()
    }
    for (const plan of plans) {
      copyOutput(await renderOverlapCore(plan), candidate, plan)
    }
    const fullPlan = { ...plans[0]!, width: WIDTH, height: HEIGHT,
      renderWidth: WIDTH, renderHeight: HEIGHT }
    const overlapReference = await renderOverlapCore(fullPlan)

    const score = ssim(reference, candidate)
    expect(score).toBeGreaterThanOrEqual(0.999)
    expect(ssim(reference, overlapReference)).toBeGreaterThanOrEqual(0.999)
    expect(maxSeamDelta(overlapReference, candidate, 512)).toBeLessThanOrEqual(1e-4)
    const discontinuity = seamErrorDiscontinuity(overlapReference, candidate, 512)
    expect(discontinuity.maximumExcessOverNeighbors).toBeLessThanOrEqual(1e-4)
    expect(discontinuity.maximum).toBeLessThanOrEqual(discontinuity.maximumWholeImage)
    release(localResources)
    local.dispose()
    global.color.destroy()
    residual.dispose()
    release(wholeResources)
    whole.dispose()
  }, 30_000)
})

function layout(key: string, x: number, y: number, width: number, height: number, outputWidth: number) {
  const scale = outputWidth / WIDTH
  return { stageWidth: width, stageHeight: height, viewportKey: key,
    viewport: { documentX: x / scale, documentY: y / scale, width, height,
      zoom: scale, devicePixelRatio: 1, interacting: false } }
}

function uploadRequired(
  compositor: ImageEditorGpuRasterCompositorV3,
  resources = new Map<string, ReturnType<typeof compositor.uploadTile>>(),
) {
  for (const key of compositor.requiredResourceKeys()) {
    const id = imageEditorGpuSceneTileKeyV3(key)
    if (!resources.has(id)) resources.set(id, compositor.uploadTile(key, sourceTile(key.mip, key.tileX, key.tileY)))
  }
  return resources
}

function sourceTile(mip: number, tileX: number, tileY: number): ImageEditorV3SourceTile {
  const fullWidth = Math.max(1, Math.ceil(WIDTH / 2 ** mip))
  const fullHeight = Math.max(1, Math.ceil(HEIGHT / 2 ** mip))
  const originX = tileX * 512
  const originY = tileY * 512
  const width = Math.min(512, fullWidth - originX)
  const height = Math.min(512, fullHeight - originY)
  const pixels = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const offset = (y * width + x) * 4
    const nx = (originX + x) / fullWidth
    const ny = (originY + y) / fullHeight
    const spot = Math.hypot(nx - 0.5, ny - 0.5) < 0.035 ? 255 : 6
    pixels[offset] = spot
    pixels[offset + 1] = Math.round(spot * 0.72)
    pixels[offset + 2] = Math.round(spot * 0.35)
    pixels[offset + 3] = 255
  }
  return { resourceRef: RESOURCE, mip, tileX, tileY, halo: 0, width, height,
    channels: 4, bitDepth: 8, sampleFormat: 'uint', numericRange: 'unorm8',
    byteOrder: 'little-endian', rowStride: width * 4, colorSpace: 'srgb',
    transferFunction: 'srgb', alphaMode: 'straight', orientationApplied: true,
    originX, originY, pixels: pixels.buffer }
}

function resolve(resources: ReadonlyMap<string, ReturnType<ImageEditorGpuRasterCompositorV3['uploadTile']>>) {
  return (key: Parameters<ImageEditorGpuRasterCompositorV3['uploadTile']>[0]) => (
    resources.get(imageEditorGpuSceneTileKeyV3(key)) ?? null
  )
}

function scalePlan(plan: ImageEditorGpuSceneExportTilePlanV3, width: number, height: number) {
  const x = Math.floor(plan.renderX * width / WIDTH)
  const y = Math.floor(plan.renderY * height / HEIGHT)
  const right = Math.ceil((plan.renderX + plan.renderWidth) * width / WIDTH)
  const bottom = Math.ceil((plan.renderY + plan.renderHeight) * height / HEIGHT)
  return { renderX: x, renderY: y, renderWidth: right - x, renderHeight: bottom - y }
}

function copyOutput(source: Float32Array, output: Float32Array, plan: ImageEditorGpuSceneExportTilePlanV3): void {
  for (let y = 0; y < plan.height; y += 1) {
    const start = y * plan.width * 4
    const target = ((plan.y + y) * WIDTH + plan.x) * 4
    output.set(source.subarray(start, start + plan.width * 4), target)
  }
}

function ssim(left: Float32Array, right: Float32Array): number {
  let ml = 0; let mr = 0
  for (let i = 0; i < left.length; i += 1) { ml += left[i]; mr += right[i] }
  ml /= left.length; mr /= right.length
  let vl = 0; let vr = 0; let covariance = 0
  for (let i = 0; i < left.length; i += 1) {
    const l = left[i] - ml; const r = right[i] - mr
    vl += l * l; vr += r * r; covariance += l * r
  }
  const d = Math.max(1, left.length - 1)
  vl /= d; vr /= d; covariance /= d
  return ((2 * ml * mr + 0.0001) * (2 * covariance + 0.0009))
    / ((ml * ml + mr * mr + 0.0001) * (vl + vr + 0.0009))
}

function maxSeamDelta(reference: Float32Array, candidate: Float32Array, x: number): number {
  let maximum = 0
  for (let y = 0; y < HEIGHT; y += 1) for (const px of [x - 1, x]) {
    for (let channel = 0; channel < 4; channel += 1) {
      const offset = (y * WIDTH + px) * 4 + channel
      maximum = Math.max(maximum, Math.abs(reference[offset] - candidate[offset]))
    }
  }
  return maximum
}

function seamErrorDiscontinuity(
  reference: Float32Array,
  candidate: Float32Array,
  x: number,
): { maximum: number; maximumExcessOverNeighbors: number; maximumWholeImage: number } {
  const errors = new Float32Array(reference.length)
  for (let index = 0; index < errors.length; index += 1) {
    errors[index] = candidate[index]! - reference[index]!
  }
  const seamGradients: number[] = []
  let maximumExcessOverNeighbors = 0
  for (let y = 0; y < HEIGHT; y += 1) for (let channel = 0; channel < 4; channel += 1) {
    const left = (y * WIDTH + x - 1) * 4 + channel
    const right = (y * WIDTH + x) * 4 + channel
    const boundary = Math.abs(errors[right]! - errors[left]!)
    const leftNeighbor = Math.abs(errors[left]! - errors[left - 4]!)
    const rightNeighbor = Math.abs(errors[right + 4]! - errors[right]!)
    seamGradients.push(boundary)
    maximumExcessOverNeighbors = Math.max(maximumExcessOverNeighbors,
      boundary - Math.max(leftNeighbor, rightNeighbor))
  }
  const gradients: number[] = []
  for (let y = 0; y < HEIGHT; y += 1) for (let px = 1; px < WIDTH; px += 1) {
    for (let channel = 0; channel < 4; channel += 1) {
      const left = (y * WIDTH + px - 1) * 4 + channel
      gradients.push(Math.abs(errors[left + 4]! - errors[left]!))
    }
  }
  gradients.sort((left, right) => left - right)
  seamGradients.sort((left, right) => left - right)
  return { maximum: seamGradients.at(-1) ?? 0, maximumExcessOverNeighbors,
    maximumWholeImage: gradients.at(-1) ?? 0 }
}

function release(resources: ReadonlyMap<string, { destroy(): void }>): void {
  for (const resource of resources.values()) resource.destroy()
}

async function cpuReference(document: ImageEditDocumentV3): Promise<Float32Array> {
  const plan = compileImageEditRenderPlanV3(document, registry, 'export')
  const rect = { x: 0, y: 0, width: WIDTH, height: HEIGHT }
  const output = await executeImageEditCpuRenderPlanV3(plan, {
    loadRaster: async () => decodeInterleavedRgbaSourceTileV3(
      fullSourceTile() as Parameters<typeof decodeInterleavedRgbaSourceTileV3>[0],
    ),
    rasterizeAnnotations: async () => { throw new Error('测试不含标注') },
    loadMask: async () => { throw new Error('测试不含蒙版') },
    transformContent: async (tile, transform) => resampleImageEditRgbaAffineV3(
      tile, rect, rect, transform,
    ),
    transformMask: async (tile, transform) => resampleImageEditMaskAffineV3(
      tile, rect, rect, transform,
    ),
  })
  if (!output) throw new Error('CPU RenderPlan无输出')
  return convertFloat32TileColorDomainV3(output, 'linear-light').data
}

function fullSourceTile(): ImageEditorV3SourceTile {
  const pixels = new Uint8Array(WIDTH * HEIGHT * 4)
  for (let tileY = 0; tileY < Math.ceil(HEIGHT / 512); tileY += 1) {
    for (let tileX = 0; tileX < Math.ceil(WIDTH / 512); tileX += 1) {
      const tile = sourceTile(0, tileX, tileY)
      const source = new Uint8Array(tile.pixels)
      for (let y = 0; y < tile.height; y += 1) {
        const sourceStart = y * tile.rowStride
        const targetStart = ((tile.originY + y) * WIDTH + tile.originX) * 4
        pixels.set(source.subarray(sourceStart, sourceStart + tile.width * 4), targetStart)
      }
    }
  }
  return { ...sourceTile(0, 0, 0), width: WIDTH, height: HEIGHT,
    rowStride: WIDTH * 4, originX: 0, originY: 0, pixels: pixels.buffer }
}
