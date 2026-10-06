import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { init, type Gpu } from 'vgpu/node'
import type { GpuDevice, GpuTexture } from '@/core/imageEdit/worker/webgpuRuntimeSupport'
import { VideoEditCodeGpu } from './videoEditCodeGpu'

// 任务 4.7d 真实设备专项：智能区域蒙版上传与“只在区域内混入效果”的着色器在 Dawn 上编译并逐像素核对。npm run test:gpu 无条件执行。
const W = 8; const H = 4
const BUFFER_MAP_READ = 0x01; const BUFFER_COPY_DST = 0x08
let gpu: Gpu
let runtime: VideoEditCodeGpu
beforeAll(async () => {
  gpu = await init()
  // 读回结果需要 COPY_SRC：测试里给运行时创建的每张纹理补上这一用途，其余行为不变。
  const device = gpu.gpu
  const readable = new Proxy(device, { get: (target, key) => key === 'createTexture'
    ? (descriptor: { usage: number }) => target.createTexture({ ...descriptor, usage: descriptor.usage | 0x01 } as never)
    : (Reflect.get(target, key) as unknown) instanceof Function ? (Reflect.get(target, key) as (...args: unknown[]) => unknown).bind(target) : Reflect.get(target, key) })
  runtime = new VideoEditCodeGpu(readable as unknown as GpuDevice)
})
afterAll(async () => { await runtime?.dispose(); gpu?.dispose() })

async function read(texture: GpuTexture): Promise<Uint8Array> {
  const device = gpu.gpu
  const bytesPerRow = 256
  const buffer = device.createBuffer({ size: bytesPerRow * H, usage: BUFFER_MAP_READ | BUFFER_COPY_DST })
  const encoder = device.createCommandEncoder()
  encoder.copyTextureToBuffer({ texture: texture as never }, { buffer, bytesPerRow }, { width: W, height: H, depthOrArrayLayers: 1 })
  device.queue.submit([encoder.finish()])
  await buffer.mapAsync(BUFFER_MAP_READ)
  const mapped = new Uint8Array(buffer.getMappedRange()); const pixels = new Uint8Array(W * H * 4)
  for (let y = 0; y < H; y++) pixels.set(mapped.subarray(y * bytesPerRow, y * bytesPerRow + W * 4), y * W * 4)
  buffer.unmap(); buffer.destroy()
  return pixels
}
const pixel = (pixels: Uint8Array, x: number, y: number): number[] => [...pixels.subarray((y * W + x) * 4, (y * W + x) * 4 + 4)]

describe('剪辑智能区域混合（真实设备）', () => {
  it('蒙版上传为预乘白色；区域内按强度混入效果画面，区域外保持原画面', async () => {
    const base = await runtime.uploadMask('base', W, H, new Uint8Array(W * H).fill(255))
    const effected = await runtime.uploadMask('effected', W, H, new Uint8Array(W * H))
    const mask = new Uint8Array(W * H)
    for (let y = 0; y < H; y++) for (let x = 0; x < W / 2; x++) mask[y * W + x] = 255
    const region = await runtime.uploadMask('region', W, H, mask)
    expect(pixel(await read(region.texture), 0, 0)).toEqual([255, 255, 255, 255])
    expect(pixel(await read(region.texture), W - 1, 0)).toEqual([0, 0, 0, 0])
    const full = await read((await runtime.maskedMix('out', base, effected, region, 1)).texture)
    expect(pixel(full, 0, 1)).toEqual([0, 0, 0, 0])
    expect(pixel(full, W - 1, 1)).toEqual([255, 255, 255, 255])
    const half = await read((await runtime.maskedMix('out', base, effected, region, 0.5)).texture)
    expect(pixel(half, 0, 1)[0]).toBeGreaterThanOrEqual(127); expect(pixel(half, 0, 1)[0]).toBeLessThanOrEqual(128)
    expect(pixel(half, W - 1, 1)).toEqual([255, 255, 255, 255])
  }, 30_000)
})
