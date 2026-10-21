import { afterAll, beforeAll, expect, it } from 'vitest'
import { init, type Gpu } from 'vgpu/node'
import { VIDEO_EDIT_FRAME_BLEND_SHADER } from './videoEditGpuShaders'

// 时间重映射帧混合的真实设备专项：同一着色器逐平面混合紧凑帧的 Y（r8unorm）、UV（rg8unorm）与完整 RGBA 帧。
// npm run test:gpu 无条件执行，设备初始化失败必须变红。
const TEXTURE_COPY_SRC = 0x01; const TEXTURE_COPY_DST = 0x02; const TEXTURE_BINDING = 0x04; const RENDER_ATTACHMENT = 0x10
const BUFFER_MAP_READ = 0x01; const BUFFER_COPY_DST = 0x08; const UNIFORM = 0x40
type Device = Gpu['gpu']
let gpu: Gpu
let device: Device
beforeAll(async () => { gpu = await init(); device = gpu.gpu })
afterAll(() => { gpu?.dispose() })

async function blend(format: 'r8unorm' | 'rg8unorm' | 'rgba8unorm', a: number[], b: number[], weight: number): Promise<number[]> {
  const channels = format === 'r8unorm' ? 1 : format === 'rg8unorm' ? 2 : 4
  const width = 4; const height = 2
  const texture = (values: number[]) => {
    const texture = device.createTexture({ size: [width, height], format, usage: TEXTURE_BINDING | TEXTURE_COPY_DST })
    device.queue.writeTexture({ texture }, new Uint8Array(Array.from({ length: width * height }, () => values).flat()), { bytesPerRow: width * channels }, [width, height])
    return texture
  }
  const module = device.createShaderModule({ code: VIDEO_EDIT_FRAME_BLEND_SHADER })
  const pipeline = device.createRenderPipeline({ layout: 'auto', vertex: { module, entryPoint: 'vs' }, fragment: { module, entryPoint: 'fs', targets: [{ format }] }, primitive: { topology: 'triangle-list' } })
  const uniform = device.createBuffer({ size: 16, usage: UNIFORM | BUFFER_COPY_DST })
  device.queue.writeBuffer(uniform, 0, new Float32Array([weight, 0, 0, 0]))
  const target = device.createTexture({ size: [width, height], format, usage: RENDER_ATTACHMENT | TEXTURE_COPY_SRC })
  const buffer = device.createBuffer({ size: 256 * height, usage: BUFFER_MAP_READ | BUFFER_COPY_DST })
  const encoder = device.createCommandEncoder()
  const pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(), clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store' }] })
  pass.setPipeline(pipeline)
  pass.setBindGroup(0, device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: texture(a).createView() }, { binding: 1, resource: texture(b).createView() }, { binding: 2, resource: { buffer: uniform } }] }))
  pass.draw(3); pass.end()
  encoder.copyTextureToBuffer({ texture: target }, { buffer, bytesPerRow: 256 }, [width, height])
  device.queue.submit([encoder.finish()])
  await buffer.mapAsync(BUFFER_MAP_READ)
  const bytes = new Uint8Array(buffer.getMappedRange().slice(0))
  buffer.unmap()
  // 每个像素都一样：取右下角，证明整幅都写到了。
  return Array.from(bytes.subarray(256 + (width - 1) * channels, 256 + width * channels))
}

it('Y、UV 与 RGBA 平面按权重线性混合（权重 0 与 1 原样返回端点）', async () => {
  device.pushErrorScope('validation')
  expect(await blend('r8unorm', [40], [200], .25)).toEqual([80])
  expect(await blend('rg8unorm', [100, 60], [20, 220], .5)).toEqual([60, 140])
  expect(await blend('rgba8unorm', [255, 0, 0, 255], [0, 0, 255, 255], .75)).toEqual([64, 0, 191, 255])
  expect(await blend('rgba8unorm', [10, 20, 30, 255], [200, 210, 220, 255], 0)).toEqual([10, 20, 30, 255])
  expect(await blend('rgba8unorm', [10, 20, 30, 255], [200, 210, 220, 255], 1)).toEqual([200, 210, 220, 255])
  expect(await device.popErrorScope()).toBeNull()
})
