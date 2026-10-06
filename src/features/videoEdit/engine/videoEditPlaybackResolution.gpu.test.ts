import { afterAll, beforeAll, expect, it } from 'vitest'
import { init, type Gpu } from 'vgpu/node'
import { videoEditDownscaleCopyShader } from './videoEditGpuShaders'

// 任务 4.9 真实设备专项：回放分辨率的缩小复制着色器在 Dawn 上编译，并按已知像素核对盒式平均（含预乘 alpha 与边缘夹取）。
// npm run test:gpu 无条件执行，设备初始化失败必须变红。
const TEXTURE_COPY_SRC = 0x01; const TEXTURE_COPY_DST = 0x02; const TEXTURE_BINDING = 0x04; const RENDER_ATTACHMENT = 0x10
const BUFFER_MAP_READ = 0x01; const BUFFER_COPY_DST = 0x08
type Device = Gpu['gpu']
type Texture = ReturnType<Device['createTexture']>
let gpu: Gpu
let device: Device
beforeAll(async () => { gpu = await init(); device = gpu.gpu })
afterAll(() => { gpu?.dispose() })

/** `pixels` rows of RGBA bytes. */
function source(pixels: number[][][]): Texture {
  const height = pixels.length; const width = pixels[0].length
  const texture = device.createTexture({ size: [width, height], format: 'rgba8unorm', usage: TEXTURE_BINDING | TEXTURE_COPY_DST })
  device.queue.writeTexture({ texture }, new Uint8Array(pixels.flat(2)), { bytesPerRow: width * 4 }, [width, height])
  return texture
}
async function run(step: 2 | 4 | 8, entryPoint: 'rgba' | 'y' | 'uv', input: Texture, width: number, height: number): Promise<number[][]> {
  const format = entryPoint === 'y' ? 'r8unorm' : entryPoint === 'uv' ? 'rg8unorm' : 'rgba8unorm'
  const channels = entryPoint === 'y' ? 1 : entryPoint === 'uv' ? 2 : 4
  const module = device.createShaderModule({ code: videoEditDownscaleCopyShader(step, 'texture') })
  const pipeline = device.createRenderPipeline({ layout: 'auto', vertex: { module, entryPoint: 'vs' }, fragment: { module, entryPoint, targets: [{ format }] }, primitive: { topology: 'triangle-list' } })
  const target = device.createTexture({ size: [width, height], format, usage: RENDER_ATTACHMENT | TEXTURE_COPY_SRC })
  const bytesPerRow = 256
  const buffer = device.createBuffer({ size: bytesPerRow * height, usage: BUFFER_MAP_READ | BUFFER_COPY_DST })
  const encoder = device.createCommandEncoder()
  const pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(), clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store' }] })
  pass.setPipeline(pipeline)
  pass.setBindGroup(0, device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: input.createView() }] }))
  pass.draw(3); pass.end()
  encoder.copyTextureToBuffer({ texture: target }, { buffer, bytesPerRow }, [width, height])
  device.queue.submit([encoder.finish()])
  await buffer.mapAsync(BUFFER_MAP_READ)
  const bytes = new Uint8Array(buffer.getMappedRange().slice(0))
  buffer.unmap(); buffer.destroy(); target.destroy()
  return Array.from({ length: height * width }, (_, index) => {
    const row = Math.floor(index / width); const column = index % width
    return Array.from(bytes.subarray(row * bytesPerRow + column * channels, row * bytesPerRow + (column + 1) * channels))
  })
}

it('解码帧版本的三个缩小复制入口在 1/2、1/4、1/8 下都能编译成管线', async () => {
  for (const step of [2, 4, 8] as const) {
    device.pushErrorScope('validation')
    const module = device.createShaderModule({ code: videoEditDownscaleCopyShader(step) })
    for (const [entryPoint, format] of [['rgba', 'rgba8unorm'], ['rgba', 'rgb10a2unorm'], ['rgba', 'rgba16float'], ['y', 'r8unorm'], ['uv', 'rg8unorm']] as const) {
      device.createRenderPipeline({ layout: 'auto', vertex: { module, entryPoint: 'vs' }, fragment: { module, entryPoint, targets: [{ format }] }, primitive: { topology: 'triangle-list' } })
    }
    expect(await device.popErrorScope()).toBeNull()
  }
})

it('1/2 复制取每 2×2 像素的平均：颜色按预乘 alpha 平均，透明像素不把颜色拉黑', async () => {
  const red = [255, 0, 0, 255]; const blue = [0, 0, 255, 255]; const clear = [0, 0, 0, 0]; const white = [255, 255, 255, 255]
  const input = source([
    [red, red, white, blue],
    [red, clear, white, blue],
  ])
  const [left, right] = await run(2, 'rgba', input, 2, 1)
  // 左格：三个红一个透明 → 颜色仍是红，alpha 3/4。
  expect(left[0]).toBe(255); expect(left[1]).toBe(0); expect(left[2]).toBe(0); expect(Math.abs(left[3] - 191)).toBeLessThanOrEqual(1)
  // 右格：两白两蓝 → (128,128,255)，不透明。
  expect(Math.abs(right[0] - 128)).toBeLessThanOrEqual(1); expect(Math.abs(right[1] - 128)).toBeLessThanOrEqual(1); expect(right[2]).toBe(255); expect(right[3]).toBe(255)
  input.destroy()
})

it('4:2:0 平面：亮度按 1/2 盒平均，色度按 1/4（2×step）盒平均；越过边缘的取样夹到最后一个像素', async () => {
  const grey = (value: number): number[] => [value, value, value, 255]
  // 3×2 的源：1/2 后是 2×1，右边那格只覆盖一列，越界部分夹到最后一列。
  const input = source([
    [grey(0), grey(255), grey(100)],
    [grey(0), grey(255), grey(100)],
  ])
  const luma = await run(2, 'y', input, 2, 1)
  expect(Math.abs(luma[0][0] - 128)).toBeLessThanOrEqual(1)
  expect(Math.abs(luma[1][0] - 100)).toBeLessThanOrEqual(1)
  const chroma = await run(2, 'uv', input, 1, 1)
  // 灰色没有色度：两通道都在 0.5。
  expect(Math.abs(chroma[0][0] - 128)).toBeLessThanOrEqual(1); expect(Math.abs(chroma[0][1] - 128)).toBeLessThanOrEqual(1)
  input.destroy()
})

it('1/8 复制整格平均一个 8×8 棋盘，得到均匀的中灰而不是取到某一个格子', async () => {
  const pixels = Array.from({ length: 8 }, (_, y) => Array.from({ length: 8 }, (_, x) => (x + y) % 2 ? [255, 255, 255, 255] : [0, 0, 0, 255]))
  const input = source(pixels)
  const [cell] = await run(8, 'rgba', input, 1, 1)
  for (const channel of [0, 1, 2]) expect(Math.abs(cell[channel] - 128)).toBeLessThanOrEqual(1)
  expect(cell[3]).toBe(255)
  input.destroy()
})
