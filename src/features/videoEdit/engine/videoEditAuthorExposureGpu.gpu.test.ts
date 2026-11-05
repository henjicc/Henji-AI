import { afterAll, beforeAll, expect, it } from 'vitest'
import { init, type Gpu } from 'vgpu/node'
import type { GpuDevice, GpuTexture } from '@/core/imageEdit/worker/webgpuRuntimeSupport'
import { VideoEditAuthorExposureGpu } from './videoEditAuthorExposureGpu'

const WIDTH = 96, HEIGHT = 8, RANGE = 512
let device: GpuDevice
let exposure: VideoEditAuthorExposureGpu
let gpu: Gpu | undefined

const allocator = {
  allocate: (width: number, height: number, format: string): GpuTexture => device.createTexture({ size: [width, height], format, usage: 0x01 | 0x02 | 0x04 | 0x10 }),
  release: (value: GpuTexture): void => value.destroy(),
}

/** 一块 16 像素宽的白块：运动的沿 x 走 `path` 像素。 */
async function gather(path: number, moving: (x: number) => boolean | number, width = WIDTH, at = 40): Promise<Float32Array> {
  const color = allocator.allocate(width, HEIGHT, 'rgba8unorm'), velocity = allocator.allocate(width, HEIGHT, 'rgba16float'), target = allocator.allocate(width, HEIGHT, 'rgba8unorm')
  const queue = device.queue as unknown as { writeTexture(...args: unknown[]): void }
  const pixels = new Uint8Array(width * HEIGHT * 4), speeds = new Float32Array(width * HEIGHT * 4)
  for (let y = 0; y < HEIGHT; y++) for (let x = at; x < at + 16; x++) {
    pixels.fill(255, (y * width + x) * 4, (y * width + x) * 4 + 4)
    const speed = moving(x)
    speeds.set([(speed === true ? path : speed === false ? 0 : speed) / RANGE + .5, .5, 0, 1], (y * width + x) * 4)
  }
  const half = new Uint16Array(speeds.length)
  const toHalf = (value: number): number => { if (!value) return 0; const exponent = Math.floor(Math.log2(value)); return ((exponent + 15) << 10) | Math.round((value / 2 ** exponent - 1) * 1024) }
  speeds.forEach((value, index) => { half[index] = toHalf(value) })
  queue.writeTexture({ texture: color }, pixels, { bytesPerRow: width * 4 }, [width, HEIGHT])
  queue.writeTexture({ texture: velocity }, half, { bytesPerRow: width * 8 }, [width, HEIGHT])
  const stride = Math.ceil(width * 4 / 256) * 256
  const encoder = device.createCommandEncoder()
  await exposure.encode(encoder, color, velocity, target, { width: width, height: HEIGHT }, RANGE, Math.abs(path), 63, 1)
  const read = device.createBuffer({ size: stride * HEIGHT, usage: 0x01 | 0x08 }) as unknown as { mapAsync(mode: number): Promise<void>; getMappedRange(): ArrayBuffer; destroy(): void }
  (encoder as unknown as { copyTextureToBuffer(...args: unknown[]): void }).copyTextureToBuffer({ texture: target }, { buffer: read, bytesPerRow: stride }, [width, HEIGHT])
  device.queue.submit([encoder.finish()])
  await read.mapAsync(1)
  const bytes = new Uint8Array(read.getMappedRange()).slice(), row = new Float32Array(width)
  for (let x = 0; x < width; x++) row[x] = bytes[4 * stride + x * 4 + 3] / 255
  read.destroy(); exposure.release(); [color, velocity, target].forEach(value => value.destroy())
  return row
}
const sum = (row: Float32Array): number => row.reduce((total, value) => total + value, 0)

beforeAll(async () => {
  gpu = await init()
  device = gpu.gpu as unknown as GpuDevice
  exposure = new VideoEditAuthorExposureGpu(device, allocator)
})
afterAll(() => { exposure.dispose(); gpu?.dispose() })

it('不动的内容原样不变', async () => {
  const row = await gather(0, () => false)
  expect(row[39]).toBe(0)
  expect(row[48]).toBe(1)
  expect(row[56]).toBe(0)
})

it('拖影只留在运动方向的身后，走多远拖多长，亮度守恒', async () => {
  const row = await gather(16, () => true)
  expect(sum(row)).toBeGreaterThan(15.2)
  expect(sum(row)).toBeLessThan(16.8)
  // 块在 40–56，往右走 16：上一刻在 24–40，身后渐隐，前面干净。
  expect(row[40]).toBeGreaterThan(.9)
  expect(row[32]).toBeGreaterThan(.35)
  expect(row[32]).toBeLessThan(.65)
  expect(row[21]).toBe(0)
  expect(row[58]).toBe(0)
  const back = await gather(-16, () => true)
  expect(back[62]).toBeGreaterThan(.2)
  expect(back[36]).toBe(0)
})

it('旁边有更快的内容时，慢的内容不会被它带着朝别的方向糊', async () => {
  const row = await gather(16, x => x >= 48)
  // 左半块不动，仍然实；右半块的拖影只往左，压在左半块上的部分叠不出更亮。
  expect(row[42]).toBeGreaterThan(.95)
  expect(sum(row)).toBeGreaterThan(11.5)
  expect(sum(row)).toBeLessThan(17)
})

it('反向运动的内容拖影都在自己身后，亮度守恒', async () => {
  const row = await gather(24, x => x < 48 ? 24 : -16)
  expect(row[20]).toBeGreaterThan(0)
  expect(row[60]).toBeGreaterThan(0)
  expect(sum(row)).toBeGreaterThan(14)
  expect(sum(row)).toBeLessThan(18)
})

it('很慢的内容在很快的内容旁边不会变成隔开的两个副本', async () => {
  const row = await gather(200, x => x < 48 ? 200 : 1.5, 512, 40)
  expect(row[50]).toBeGreaterThan(.9)
})

it('路径比邻域大很多时也没有硬边', async () => {
  const row = await gather(200, () => true, 512, 248)
  const middle = row[150]
  expect(middle).toBeGreaterThan(0)
  for (let x = 70; x < 240; x++) expect(row[x]).toBeGreaterThan(middle * .5)
  expect(row[270]).toBe(0)
})

it('速度再快样本数也封顶，亮度依然守恒', async () => {
  const row = await gather(60, () => true, WIDTH, 70)
  expect(sum(row)).toBeGreaterThan(15)
  expect(sum(row)).toBeLessThan(17)
  expect(Math.max(...row)).toBeLessThan(.6)
})
