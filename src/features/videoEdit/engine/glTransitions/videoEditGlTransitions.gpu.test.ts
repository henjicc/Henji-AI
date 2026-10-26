import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type Gpu } from 'vgpu/node'
import { initShaderGraphTestGpu } from '../shaderEngines/shaderGraphGpu.testing'
import type { GpuDevice, GpuTexture } from '@/core/imageEdit/worker/webgpuRuntimeSupport'
import { GL_TRANSITION_KINDS, type GlTransitionKind } from '@/core/videoEdit/glTransitions/transitions'
import { resolveVideoEditTransitionParams } from '@/core/videoEdit/transitionParams'
import { VideoEditGlTransitionsGpu } from './videoEditGlTransitionsGpu'

// gl-transitions 转场真实设备专项：全部收录转场在 Dawn 上编译；用带图案的两段画面逐像素核对两端（进度 0 是前一段、1 是后一段）
// 与单侧过渡的透明一侧，再抽查高精度输出。中间帧对照 GLSL 参考渲染的核验在收录时做（scripts/verify-gl-transitions.mjs）。
const TEXTURE_COPY_SRC = 0x01; const TEXTURE_COPY_DST = 0x02; const TEXTURE_BINDING = 0x04; const RENDER_ATTACHMENT = 0x10
const BUFFER_MAP_READ = 0x01; const BUFFER_COPY_DST = 0x08
const W = 64; const H = 36
type Device = Gpu['gpu']
let gpu: Gpu
let device: Device
let runtime: VideoEditGlTransitionsGpu
let outgoing: GpuTexture; let incoming: GpuTexture; let transparent: GpuTexture
let from: Uint8Array; let to: Uint8Array

function pattern(seed: number): Uint8Array {
  const data = new Uint8Array(W * H * 4)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const at = (y * W + x) * 4
    data.set([(x * 4 + seed * 40) & 255, (y * 7 + seed * 90) & 255, ((x ^ y) * 9 + seed * 30) & 255, 255], at)
  }
  return data
}
function upload(data: Uint8Array, width = W, height = H): GpuTexture {
  const texture = device.createTexture({ size: [width, height], format: 'rgba8unorm', usage: TEXTURE_BINDING | TEXTURE_COPY_DST })
  device.queue.writeTexture({ texture }, data, { bytesPerRow: width * 4 }, [width, height])
  return texture as unknown as GpuTexture
}
async function read(texture: GpuTexture, bytesPerPixel = 4): Promise<Uint8Array> {
  const bytesPerRow = Math.ceil(W * bytesPerPixel / 256) * 256
  const buffer = device.createBuffer({ size: bytesPerRow * H, usage: BUFFER_MAP_READ | BUFFER_COPY_DST })
  const encoder = device.createCommandEncoder()
  encoder.copyTextureToBuffer({ texture: texture as never }, { buffer, bytesPerRow }, { width: W, height: H, depthOrArrayLayers: 1 })
  device.queue.submit([encoder.finish()])
  await buffer.mapAsync(BUFFER_MAP_READ)
  const mapped = new Uint8Array(buffer.getMappedRange()); const pixels = new Uint8Array(W * H * bytesPerPixel)
  for (let y = 0; y < H; y++) pixels.set(mapped.subarray(y * bytesPerRow, y * bytesPerRow + W * bytesPerPixel), y * W * bytesPerPixel)
  buffer.unmap(); buffer.destroy()
  return pixels
}
async function run(kind: GlTransitionKind, progress: number, single?: 'in' | 'out', format = 'rgba8unorm'): Promise<Uint8Array> {
  const output = device.createTexture({ size: [W, H], format: format as 'rgba8unorm', usage: TEXTURE_BINDING | RENDER_ATTACHMENT | TEXTURE_COPY_SRC }) as unknown as GpuTexture
  await runtime.render({ kind, params: resolveVideoEditTransitionParams(kind, undefined), progress, ...(single === 'in' ? { emptyOutgoing: true } : single === 'out' ? { emptyIncoming: true } : {}) }, outgoing, incoming, output, { width: W, height: H, format }, () => transparent)
  const pixels = await read(output, format === 'rgba16float' ? 8 : 4)
  output.destroy()
  return pixels
}
const maxDifference = (a: Uint8Array, b: Uint8Array): number => a.reduce((max, value, index) => Math.max(max, Math.abs(value - b[index])), 0)

beforeAll(async () => {
  gpu = await initShaderGraphTestGpu(); device = gpu.gpu
  runtime = new VideoEditGlTransitionsGpu(device as unknown as GpuDevice, device.createSampler({ magFilter: 'linear', minFilter: 'linear' }))
  from = pattern(1); to = pattern(2)
  outgoing = upload(from); incoming = upload(to); transparent = upload(new Uint8Array(4), 1, 1)
})
afterAll(() => { runtime?.dispose(); outgoing?.destroy(); incoming?.destroy(); transparent?.destroy(); gpu?.dispose() })

describe('gl-transitions 转场（真实设备）', () => {
  it('全部转场编译通过；进度 0 逐像素等于前一段、进度 1 逐像素等于后一段', async () => {
    const failures: string[] = []
    for (const kind of GL_TRANSITION_KINDS) {
      const start = maxDifference(await run(kind, 0), from); const end = maxDifference(await run(kind, 1), to)
      if (start > 0 || end > 0) failures.push(`${kind}: 进度 0 差 ${start}，进度 1 差 ${end}`)
    }
    expect(failures).toEqual([])
  }, 120_000)
  it('单侧过渡空着的一侧是透明：入点从全透明开始，出点结束于全透明', async () => {
    const failures: string[] = []
    for (const kind of GL_TRANSITION_KINDS) {
      const start = await run(kind, 0, 'in'); const end = await run(kind, 1, 'out')
      if (start.some(value => value !== 0) || end.some(value => value !== 0)) failures.push(kind)
      if (maxDifference(await run(kind, 1, 'in'), to) > 0 || maxDifference(await run(kind, 0, 'out'), from) > 0) failures.push(`${kind}（有画面一侧）`)
    }
    expect(failures).toEqual([])
  }, 120_000)
  it('过渡中途有既不是前一段也不是后一段的画面；高精度输出可用', async () => {
    // 有的转场在恰好一半时已整屏换成后一段（如星形擦除），所以取三处进度，至少一帧与两端都不同。
    const still: string[] = []
    for (const kind of GL_TRANSITION_KINDS) {
      let moving = false
      for (const progress of [0.25, 0.5, 0.75]) {
        const middle = await run(kind, progress)
        if (maxDifference(middle, from) > 0 && maxDifference(middle, to) > 0) { moving = true; break }
      }
      if (!moving) still.push(kind)
    }
    expect(still).toEqual([])
    for (const kind of ['gl.Cube', 'gl.StarWipe', 'gl.GlitchFlicker'] as const) expect((await run(kind, 0.5, undefined, 'rgba16float')).some(value => value !== 0), kind).toBe(true)
  }, 120_000)
})
