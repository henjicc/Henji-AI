import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { init, type Gpu } from 'vgpu/node'
import { VIDEO_EDIT_PRESENT_SHADER, readVideoEditPreciseRow, videoEditGradientLevels, videoEditHalfToFloat, videoEditLayerShader } from './videoEditGpuShaders'

// 任务 2.7 真实设备专项：用合成器正式 WGSL（图层着色器、量化呈现）在 Dawn 上验证高位深合成精度。
// npm run test:gpu 无条件执行，设备初始化失败必须变红。
const TEXTURE_COPY_SRC = 0x01; const TEXTURE_COPY_DST = 0x02; const TEXTURE_BINDING = 0x04; const RENDER_ATTACHMENT = 0x10
const BUFFER_MAP_READ = 0x01; const BUFFER_COPY_DST = 0x08; const BUFFER_UNIFORM = 0x40
const ROWS = 2
type Format = 'rgba8unorm' | 'rgb10a2unorm' | 'rgba16float'

// The raw Dawn device; WebGPU's global types are not part of this project's compilation.
type Device = Gpu['gpu']
type Texture = ReturnType<Device['createTexture']>
let gpu: Gpu
let device: Device
beforeAll(async () => { gpu = await init(); device = gpu.gpu })
afterAll(() => { gpu?.dispose() })

function toHalf(value: number): number {
  const view = new DataView(new ArrayBuffer(4)); view.setFloat32(0, value)
  const bits = view.getUint32(0); const sign = (bits >>> 16) & 0x8000
  const exponent = ((bits >>> 23) & 0xff) - 127 + 15; const mantissa = bits & 0x7fffff
  if (exponent <= 0) return sign // inputs here are 0 or >= 1/1023, far above the half subnormal range
  const half = sign | (exponent << 10) | (mantissa >> 13)
  return mantissa & 0x1000 ? half + 1 : half
}
function texture(width: number, format: Format, usage: number): Texture {
  return device.createTexture({ size: [width, ROWS], format, usage })
}
/** A horizontal grey ramp of `levels` steps (`levels` pixels wide), opaque. */
function ramp(levels: number, format: Format): Texture {
  const source = texture(levels, format, TEXTURE_BINDING | TEXTURE_COPY_DST)
  if (format === 'rgb10a2unorm') {
    // Packed 10:10:10:2, red in the low bits; opaque.
    const packed = new Uint32Array(levels * ROWS)
    for (let row = 0; row < ROWS; row++) for (let x = 0; x < levels; x++) packed[row * levels + x] = (x | x << 10 | x << 20 | 3 << 30) >>> 0
    device.queue.writeTexture({ texture: source }, packed, { bytesPerRow: levels * 4 }, [levels, ROWS])
    return source
  }
  const half = format === 'rgba16float'
  const data = half ? new Uint16Array(levels * 4 * ROWS) : new Uint8Array(levels * 4 * ROWS)
  for (let row = 0; row < ROWS; row++) for (let x = 0; x < levels; x++) {
    const value = x / (levels - 1); const at = (row * levels + x) * 4
    for (let channel = 0; channel < 3; channel++) data[at + channel] = half ? toHalf(value) : x
    data[at + 3] = half ? toHalf(1) : 255
  }
  device.queue.writeTexture({ texture: source }, data, { bytesPerRow: levels * 4 * (half ? 2 : 1) }, [levels, ROWS])
  return source
}
/** One layer drawn with the compositor's image shader over the opaque black clear, as `VideoEditGpuCompositor.draw()`. */
function compose(source: Texture, width: number, format: Format, brightness = 1, opacity = 1): Texture {
  const target = texture(width, format, RENDER_ATTACHMENT | TEXTURE_BINDING | TEXTURE_COPY_SRC)
  const module = device.createShaderModule({ code: videoEditLayerShader(false) })
  const blend = { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } }
  const pipeline = device.createRenderPipeline({ layout: 'auto', vertex: { module, entryPoint: 'vs' }, fragment: { module, entryPoint: 'fs', targets: [{ format, blend }] }, primitive: { topology: 'triangle-list' } })
  const uniform = device.createBuffer({ size: 48, usage: BUFFER_UNIFORM | BUFFER_COPY_DST })
  device.queue.writeBuffer(uniform, 0, new Float32Array([1, 1, 1, 0, 0, 0, brightness, opacity, ROWS / width, width / ROWS, 0, 0]))
  const encoder = device.createCommandEncoder()
  const pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(), clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }] })
  pass.setPipeline(pipeline)
  pass.setBindGroup(0, device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: source.createView() }, { binding: 1, resource: device.createSampler({ magFilter: 'linear', minFilter: 'linear' }) }, { binding: 2, resource: { buffer: uniform } }] }))
  pass.draw(6); pass.end(); device.queue.submit([encoder.finish()])
  return target
}
/** The compositor's final pass: rgba16float composition to an 8-bit canvas format. */
function present(precise: Texture, width: number): Texture {
  const canvas = texture(width, 'rgba8unorm', RENDER_ATTACHMENT | TEXTURE_COPY_SRC)
  const module = device.createShaderModule({ code: VIDEO_EDIT_PRESENT_SHADER })
  const pipeline = device.createRenderPipeline({ layout: 'auto', vertex: { module, entryPoint: 'vs' }, fragment: { module, entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }] }, primitive: { topology: 'triangle-list' } })
  const encoder = device.createCommandEncoder()
  const pass = encoder.beginRenderPass({ colorAttachments: [{ view: canvas.createView(), clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }] })
  pass.setPipeline(pipeline)
  pass.setBindGroup(0, device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: precise.createView() }] }))
  pass.draw(3); pass.end(); device.queue.submit([encoder.finish()])
  return canvas
}
async function read8(source: Texture, width: number, row: number): Promise<Uint8Array> {
  const bytesPerRow = Math.ceil(width * 4 / 256) * 256
  const buffer = device.createBuffer({ size: bytesPerRow, usage: BUFFER_MAP_READ | BUFFER_COPY_DST })
  const encoder = device.createCommandEncoder()
  encoder.copyTextureToBuffer({ texture: source, origin: { x: 0, y: row, z: 0 } }, { buffer, bytesPerRow }, { width, height: 1, depthOrArrayLayers: 1 })
  device.queue.submit([encoder.finish()])
  await buffer.mapAsync(BUFFER_MAP_READ)
  const pixels = new Uint8Array(buffer.getMappedRange().slice(0, width * 4)); buffer.unmap(); buffer.destroy()
  return pixels
}

describe('剪辑合成高位深管线（真实设备）', () => {
  it.each(['rgba16float', 'rgb10a2unorm'] as const)('%s 自有帧的十位渐变经 rgba16float 合成后读回保留 1024 级，旧 8 位目标只剩 256 级', async format => {
    const source = ramp(1024, format)
    for (let row = 0; row < ROWS; row++) {
      const precise = await readVideoEditPreciseRow(device, compose(source, 1024, 'rgba16float'), 1024, row)
      expect(videoEditGradientLevels(precise)).toBe(1024)
      for (let x = 0; x < 1024; x++) for (let channel = 0; channel < 3; channel++) expect(Math.abs(videoEditHalfToFloat(precise[x * 4 + channel]) - x / 1023)).toBeLessThanOrEqual(2 ** -11)
      expect(videoEditGradientLevels(await read8(compose(source, 1024, 'rgba8unorm'), 1024, row))).toBe(256)
    }
  }, 30_000)

  it('量化到 8 位画布：每点在一级以内且抖动生效，均值跟随十位值', async () => {
    const source = ramp(1024, 'rgba16float')
    const canvas = await read8(present(compose(source, 1024, 'rgba16float'), 1024), 1024, 0)
    let dithered = 0; let error = 0
    for (let x = 0; x < 1024; x++) {
      const exact = x / 1023 * 255
      for (let channel = 0; channel < 3; channel++) expect(Math.abs(canvas[x * 4 + channel] - exact)).toBeLessThanOrEqual(1)
      if (canvas[x * 4] !== Math.round(exact)) dithered++
      error += canvas[x * 4] - exact
      expect(canvas[x * 4 + 3]).toBe(255)
    }
    expect(dithered).toBeGreaterThan(0)
    expect(Math.abs(error / 1024)).toBeLessThan(0.1)
    // A flat field between two 8-bit levels: plain rounding would show only 100 or 101; the dither mixes them so the
    // average follows the 10-bit value (no band edge).
    for (const level of [100.25, 100.5, 100.75]) {
      const flat = texture(1024, 'rgba16float', TEXTURE_BINDING | TEXTURE_COPY_DST)
      device.queue.writeTexture({ texture: flat }, new Uint16Array(1024 * 4 * ROWS).map((_, index) => toHalf(index % 4 === 3 ? 1 : level / 255)), { bytesPerRow: 1024 * 8 }, [1024, ROWS])
      const output = await read8(present(compose(flat, 1024, 'rgba16float'), 1024), 1024, 0)
      let sum = 0; for (let x = 0; x < 1024; x++) { expect([100, 101]).toContain(output[x * 4]); sum += output[x * 4] }
      expect(Math.abs(sum / 1024 - level)).toBeLessThan(0.1)
    }
  }, 30_000)

  it('8 位画面进入高精度帧：未变换时逐像素不变，带亮度与透明度时差异不超过一级', async () => {
    const source = ramp(256, 'rgba8unorm')
    for (let row = 0; row < ROWS; row++) {
      const direct = await read8(compose(source, 256, 'rgba8unorm'), 256, row)
      const throughPrecise = await read8(present(compose(source, 256, 'rgba16float'), 256), 256, row)
      expect([...throughPrecise]).toEqual([...direct])
    }
    const direct = await read8(compose(source, 256, 'rgba8unorm', 0.8, 0.5), 256, 0)
    const throughPrecise = await read8(present(compose(source, 256, 'rgba16float', 0.8, 0.5), 256), 256, 0)
    for (let index = 0; index < direct.length; index++) expect(Math.abs(throughPrecise[index] - direct[index])).toBeLessThanOrEqual(1)
  }, 30_000)
})
