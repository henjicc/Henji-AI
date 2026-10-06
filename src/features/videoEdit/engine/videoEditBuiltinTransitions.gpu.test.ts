import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { init, type Gpu } from 'vgpu/node'
import type { GpuDevice, GpuTexture } from '@/core/imageEdit/worker/webgpuRuntimeSupport'
import { BLACK_HEX } from '@/core/theme/colorTokens'
import { resolveVideoEditTransitionParams, VIDEO_EDIT_BUILTIN_TRANSITION_KINDS, type VideoEditBuiltinTransitionKind } from '@/core/videoEdit/transitionParams'
import type { VideoEditBuiltinTransitionInput } from '@/core/videoEdit/transitions'
import { VideoEditBuiltinEffectsGpu } from './videoEditBuiltinEffectsGpu'

// 任务 4.7 视频过渡真实设备专项：过渡着色器在 Dawn 上编译，逐像素核对两端、中点与单侧过渡。npm run test:gpu 无条件执行。
const TEXTURE_COPY_SRC = 0x01; const TEXTURE_COPY_DST = 0x02; const TEXTURE_BINDING = 0x04; const RENDER_ATTACHMENT = 0x10
const BUFFER_MAP_READ = 0x01; const BUFFER_COPY_DST = 0x08
const W = 64; const H = 36
const RED = [255, 0, 0, 255]; const BLUE = [0, 0, 255, 255]
type Device = Gpu['gpu']
let gpu: Gpu
let device: Device
let effects: VideoEditBuiltinEffectsGpu
beforeAll(async () => {
  gpu = await init(); device = gpu.gpu
  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' })
  effects = new VideoEditBuiltinEffectsGpu(device as unknown as GpuDevice, sampler, {
    allocate: (width, height, format) => device.createTexture({ size: [width, height], format: format as 'rgba8unorm', usage: TEXTURE_BINDING | RENDER_ATTACHMENT | TEXTURE_COPY_DST }) as unknown as GpuTexture,
    release: texture => texture.destroy(),
  })
})
afterAll(() => { effects?.dispose(); gpu?.dispose() })

function solid(color: number[]): GpuTexture {
  const texture = device.createTexture({ size: [W, H], format: 'rgba8unorm', usage: TEXTURE_BINDING | TEXTURE_COPY_DST | TEXTURE_COPY_SRC })
  const data = new Uint8Array(W * H * 4)
  for (let at = 0; at < data.length; at += 4) data.set(color, at)
  device.queue.writeTexture({ texture }, data, { bytesPerRow: W * 4 }, [W, H])
  return texture as unknown as GpuTexture
}
async function read(texture: GpuTexture): Promise<Uint8Array> {
  const bytesPerRow = Math.ceil(W * 4 / 256) * 256
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
async function run(kind: VideoEditBuiltinTransitionKind, progress: number, params: Record<string, unknown> = {}, single?: 'in' | 'out'): Promise<Uint8Array> {
  const outgoing = solid(RED); const incoming = single ? outgoing : solid(BLUE)
  const output = device.createTexture({ size: [W, H], format: 'rgba8unorm', usage: TEXTURE_BINDING | RENDER_ATTACHMENT | TEXTURE_COPY_SRC }) as unknown as GpuTexture
  const input: VideoEditBuiltinTransitionInput = { kind, params: resolveVideoEditTransitionParams(kind, params), progress, ...(single === 'in' ? { emptyOutgoing: true } : single === 'out' ? { emptyIncoming: true } : {}) }
  await effects.renderTransition(input, outgoing, incoming, output, { width: W, height: H, format: 'rgba8unorm' })
  return read(output)
}
const pixel = (pixels: Uint8Array, x: number, y: number): number[] => [...pixels.subarray((y * W + x) * 4, (y * W + x) * 4 + 4)]
const near = (actual: number[], expected: number[], tolerance = 3): void => { actual.forEach((value, index) => expect(Math.abs(value - expected[index]), `${actual} ≈ ${expected}`).toBeLessThanOrEqual(tolerance)) }

describe('剪辑视频过渡（真实设备）', () => {
  it('全部过渡在设备上编译；默认参数下进度 0 是前一段、进度 1 是后一段', async () => {
    for (const kind of VIDEO_EDIT_BUILTIN_TRANSITION_KINDS) {
      for (const [x, y] of [[1, 1], [W / 2, H / 2], [W - 2, H - 2]]) {
        near(pixel(await run(kind, 0), x, y), RED); near(pixel(await run(kind, 1), x, y), BLUE)
      }
    }
  }, 60_000)
  it('中点：擦除按方向分两半、推动与滑动从指定侧进入、圆形划像中心先露出、闪光整屏变闪光色、模糊与缩放两段各半', async () => {
    const wipe = await run('wipe', 0.5, { feather: 0 })
    near(pixel(wipe, 4, 18), BLUE); near(pixel(wipe, W - 5, 18), RED)
    const down = await run('wipe', 0.5, { direction: 'from_top', feather: 0 })
    near(pixel(down, 32, 3), BLUE); near(pixel(down, 32, H - 4), RED)
    const bordered = await run('wipe', 0.5, { feather: 0, border: 100 })
    near(pixel(bordered, W / 2, 18), [255, 255, 255, 255], 30)
    for (const kind of ['push', 'slide'] as const) {
      const moved = await run(kind, 0.5, { direction: 'from_right', smooth: false })
      near(pixel(moved, 4, 18), RED); near(pixel(moved, W - 5, 18), BLUE)
    }
    const iris = await run('iris_round', 0.5, { feather: 0 })
    near(pixel(iris, W / 2, H / 2), BLUE); near(pixel(iris, 0, 0), RED)
    const closing = await run('iris_round', 0.5, { feather: 0, mode: 'close' })
    near(pixel(closing, W / 2, H / 2), RED); near(pixel(closing, 0, 0), BLUE)
    near(pixel(await run('flash', 0.5), W / 2, H / 2), [255, 255, 255, 255])
    near(pixel(await run('flash', 0.5, { color: BLACK_HEX, intensity: 100 }), W / 2, H / 2), [0, 0, 0, 255])
    near(pixel(await run('blur_dissolve', 0.5), W / 2, H / 2), [128, 0, 128, 255], 4)
    near(pixel(await run('cross_zoom', 0.5), W / 2, H / 2), [128, 0, 128, 255], 4)
  }, 60_000)
  it('单侧过渡空着的一侧是透明：入点从透明开始，出点结束于透明', async () => {
    for (const kind of VIDEO_EDIT_BUILTIN_TRANSITION_KINDS) {
      expect(pixel(await run(kind, 0, {}, 'in'), W / 2, H / 2)[3], kind).toBe(0)
      near(pixel(await run(kind, 1, {}, 'in'), W / 2, H / 2), RED)
      near(pixel(await run(kind, 0, {}, 'out'), W / 2, H / 2), RED)
      expect(pixel(await run(kind, 1, {}, 'out'), W / 2, H / 2)[3], kind).toBe(0)
    }
  }, 60_000)
})
