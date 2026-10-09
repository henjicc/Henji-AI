import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { effect, frame, target, type Target } from 'vgpu'
import { writeFileSync } from 'node:fs'
import { init, type Gpu } from 'vgpu/node'
import { gaussianParameterSchema, resolveGaussianPlan } from '@/core/imaging/effects/gaussian'
import { executeGaussianCpu, gaussianExecutionWindows, type GaussianRegion } from '@/core/imaging/effects/cpu/gaussian'
import type { GpuDevice, GpuTexture } from '@/core/imageEdit/worker/webgpuRuntimeSupport'
import { ImageEditorGpuGaussianBlurRendererV3 } from '../../imageEdit/v3/gpu/imageEditorGpuGaussianBlurRendererV3'
import { ImageEditorGpuEffectTargetPoolV3 } from '../../imageEdit/v3/gpu/imageEditorGpuEffectTargetPoolV3'
import { float32ToFloat16 } from '../../imageEdit/v3/gpu/imageEditorGpuTileAtlasV3'
import { VideoEditBuiltinEffectsGpu } from './videoEditBuiltinEffectsGpu'

let gpu: Gpu
const gpuErrors: string[] = []
beforeAll(async () => { gpu = await init(); gpu.onError(error => gpuErrors.push(String(error))) })
beforeEach(() => { gpuErrors.length = 0; gpu.gpu.pushErrorScope('validation') })
afterEach(async () => { await gpu.settled(); expect(await gpu.gpu.popErrorScope()).toBeNull(); expect(gpuErrors).toEqual([]) })
afterAll(() => gpu?.dispose())
const decode = (value: number): number => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
const encode = (value: number): number => value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055
async function upload(output: Target, data: Float32Array): Promise<void> {
  // VGPU Target 只支持 RenderAttachment/TextureBinding/CopySrc；上传到独立 CopyDst，再正式 pass 复制。
  const staging = gpu.device.createTexture({ size: output.size, format: 'rgba16float', usage: ['copy_dst', 'texture_binding'] })
  try {
    gpu.gpu.queue.writeTexture({ texture: staging.gpu }, Uint16Array.from(data, float32ToFloat16), { bytesPerRow: output.size[0] * 8 }, { width: output.size[0], height: output.size[1], depthOrArrayLayers: 1 })
    const copy = effect(gpu, '@group(0) @binding(0) var source: texture_2d<f32>; @fragment fn fs_main(@builtin(position) p: vec4f) -> @location(0) vec4f { return textureLoad(source, vec2i(p.xy), 0); }')
    copy.set({ source: staging }); await copy.compile(output)
    await frame(gpu, current => current.pass({ target: output }, copy)).done
    const uploaded = await output.readFloats()
    expect(uploaded.some(value => value !== 0)).toBe(true)
    compare(uploaded, data, 0.001, 0.0005)
  } finally { staging.destroy() }
}
function compare(actual: Float32Array, expected: Float32Array, maxBudget = 0.002, rmseBudget = 0.0005): void {
  let max = 0; let sum = 0; let maxIndex = 0
  for (let i = 0; i < actual.length; i++) { const delta = actual[i] - expected[i]; if (Math.abs(delta) > max) { max = Math.abs(delta); maxIndex = i } sum += delta ** 2 }
  expect(max, JSON.stringify({ max, maxIndex, actual: actual[maxIndex], expected: expected[maxIndex] })).toBeLessThan(maxBudget)
  expect(Math.sqrt(sum / actual.length)).toBeLessThan(rmseBudget)
}
describe('两宿主高斯真实设备符合性', () => {
  // 性能测量只在本机显式开启（HENJI_GPU_MEASURE=1）；CI 软件渲染器下 4K 测量会超时且数字无意义。
  it.skipIf(!process.env.HENJI_GPU_MEASURE)('1080p/4K interactive/final 热执行定向测量（非产品数量限制）', async () => {
    const measurements = []
    for (const [width, height] of [[1920, 1080], [3840, 2160]]) {
      const source = target(gpu, { size: [width, height], format: 'rgba16float' })
      const output = target(gpu, { size: [width, height], format: 'rgba16float' })
      const constant = effect(gpu, '@fragment fn fs_main() -> @location(0) vec4f { return vec4f(0.4, 0.2, 0.1, 1.0); }')
      const pool = new ImageEditorGpuEffectTargetPoolV3(gpu)
      const renderer = new ImageEditorGpuGaussianBlurRendererV3(gpu, pool, () => undefined)
      try {
        await constant.compile(source)
        await frame(gpu, current => current.pass({ target: source }, constant)).done
        for (const fraction of [0.003, 0.03]) for (const quality of ['interactive', 'final'] as const) {
          const plan = resolveGaussianPlan(gaussianParameterSchema.parse({ sigma_fraction_height: fraction }), { referenceSize: { width, height }, outputSize: { width, height }, quality })
          renderer.prepareResolved(source, plan, output)
          const compilationStart = performance.now(); await renderer.compile(); const prepareMs = performance.now() - compilationStart
          await frame(gpu, current => renderer.encode(current)).done
          const runs = []
          for (let repeat = 0; repeat < 5; repeat++) {
            const start = performance.now(); await frame(gpu, current => renderer.encode(current)).done
            runs.push(performance.now() - start)
          }
          runs.sort((a, b) => a - b)
          measurements.push({ width, height, fraction, quality, prepareMs, p50Ms: runs[2], p95Ms: runs[4], passes: plan.passes.length, scratchBytes: plan.scratchBytes, intermediateFormat: plan.intermediateFormat })
        }
      } finally { renderer.dispose(); pool.dispose(); source.color.destroy(); output.color.destroy() }
    }
    if (process.env.HENJI_GAUSSIAN_MEASUREMENTS) writeFileSync(process.env.HENJI_GAUSSIAN_MEASUREMENTS, JSON.stringify(measurements, null, 2))
  }, 60_000)
  it.each(['interactive', 'final'] as const)('%s：奇数尺寸、透明边、宽尺度两宿主与CPU参考一致；tile全局窗口一致', async quality => {
    const width = 129; const height = 131
    for (const fraction of [0.0019, 0.025, 0.25]) {
      const encoded = new Float32Array(width * height * 4); const linear = new Float32Array(encoded.length)
      for (let y = 8; y < height - 8; y++) for (let x = 7; x < width - 7; x++) {
        const alpha = (x + y) % 3 === 0 ? 0.5 : 1
        const color = [(x % 17) / 16, (y % 13) / 12, 0.25]
        encoded.set([...color.map(value => value * alpha), alpha], (y * width + x) * 4)
        linear.set([...color.map(value => decode(value) * alpha), alpha], (y * width + x) * 4)
      }
      const parameters = gaussianParameterSchema.parse({ sigma_fraction_height: fraction, edge_mode: 'transparent' })
      const plan = resolveGaussianPlan(parameters, { referenceSize: { width, height }, outputSize: { width, height }, quality })
      const source = target(gpu, { size: [width, height], format: 'rgba16float' })
      const encodedSource = target(gpu, { size: [width, height], format: 'rgba16float' })
      const imageOutput = target(gpu, { size: [width, height], format: 'rgba16float' })
      const videoOutput = target(gpu, { size: [width, height], format: 'rgba16float' })
      const pool = new ImageEditorGpuEffectTargetPoolV3(gpu)
      const image = new ImageEditorGpuGaussianBlurRendererV3(gpu, pool, () => undefined)
      const video = new VideoEditBuiltinEffectsGpu(gpu.gpu as unknown as GpuDevice, gpu.gpu.createSampler({ magFilter: 'linear', minFilter: 'linear' }), {
        allocate: (w, h, format) => gpu.gpu.createTexture({ size: [w, h], format: format as 'rgba16float', usage: 4 | 16 }) as unknown as GpuTexture,
        release: texture => texture.destroy(),
      })
      try {
        await upload(encodedSource, encoded)
        // 从实际量化后的同一编码输入解码，避免把不同 fp16 夹具误当作同输入。
        const encodedPixels = await encodedSource.readFloats()
        for (let at = 0; at < linear.length; at += 4) {
          const alpha = encodedPixels[at + 3]
          for (let channel = 0; channel < 3; channel++) linear[at + channel] = alpha > 0 ? decode(encodedPixels[at + channel] / alpha) * alpha : 0
          linear[at + 3] = alpha
        }
        await upload(source, linear)
        image.prepareResolved(source, plan, imageOutput); await image.compile()
        await frame(gpu, current => image.encode(current)).done
        const imagePixels = await imageOutput.readFloats()
        const reference = executeGaussianCpu(plan, { x: 0, y: 0, width, height, data: await source.readFloats() }).data
        compare(imagePixels, reference)
        await video.render({ id: 'gaussian_blur', params: parameters }, { texture: encodedSource.color.gpu as unknown as GpuTexture, width, height, format: 'rgba16float' }, videoOutput.color.gpu as unknown as GpuTexture, 0, 1, [], quality, { width, height })
        const encodedImage = new Float32Array(imagePixels)
        for (let i = 0; i < encodedImage.length; i += 4) for (let c = 0; c < 3; c++) encodedImage[i + c] = imagePixels[i + 3] > 0 ? encode(imagePixels[i + c] / imagePixels[i + 3]) * imagePixels[i + 3] : 0
        compare(await videoOutput.readFloats(), encodedImage)
        const region: GaussianRegion = { x: 43, y: 47, width: 49, height: 53 }
        const halo = gaussianExecutionWindows(plan, region)[0]
        const haloData = new Float32Array(halo.width * halo.height * 4)
        for (let y = 0; y < halo.height; y++) haloData.set(linear.subarray(((y + halo.y) * width + halo.x) * 4, ((y + halo.y) * width + halo.x + halo.width) * 4), y * halo.width * 4)
        const tileInput = target(gpu, { size: [halo.width, halo.height], format: 'rgba16float' })
        const tileOutput = target(gpu, { size: [region.width, region.height], format: 'rgba16float' })
        try {
          await upload(tileInput, haloData)
          image.prepareResolved(tileInput, plan, tileOutput, halo, region); await image.compile()
          await frame(gpu, current => image.encode(current)).done
          const expected = new Float32Array(region.width * region.height * 4)
          for (let y = 0; y < region.height; y++) expected.set(imagePixels.subarray(((y + region.y) * width + region.x) * 4, ((y + region.y) * width + region.x + region.width) * 4), y * region.width * 4)
          compare(await tileOutput.readFloats(), expected, 0.00001, 0.000001)
        } finally { tileInput.color.destroy(); tileOutput.color.destroy() }
      } finally {
        image.dispose(); video.dispose(); pool.dispose()
        source.color.destroy(); encodedSource.color.destroy(); imageOutput.color.destroy(); videoOutput.color.destroy()
      }
    }
  }, 60_000)
})
