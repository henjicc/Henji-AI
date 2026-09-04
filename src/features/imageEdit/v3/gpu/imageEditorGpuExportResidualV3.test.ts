import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { effect, frame, target, type Gpu, type Target } from 'vgpu'
import { init } from 'vgpu/node'

import { ImageEditorGpuExportResidualV3 } from './imageEditorGpuExportResidualV3'

const FILL = `
struct Params { color: vec4f }
@group(0) @binding(0) var<uniform> params: Params;
@vertex fn vs_main(@builtin(vertex_index) vi:u32)->@builtin(position) vec4f {
  let p=array<vec2f,3>(vec2f(-1),vec2f(3,-1),vec2f(-1,3)); return vec4f(p[vi],0,1);
}
@fragment fn fs_main()->@location(0) vec4f { return params.color; }`

let gpu: Gpu
beforeAll(async () => { gpu = await init() })
afterAll(() => gpu.dispose())

async function filled(size: readonly [number, number], color: readonly [number, number, number, number]): Promise<Target> {
  const output = target(gpu, { size, format: 'rgba16float', clearColor: [0, 0, 0, 0] })
  const fill = effect(gpu, FILL)
  fill.set({ params: { color: [...color] } })
  await fill.compile(output)
  await frame(gpu, (current) => current.pass({ target: output }, fill)).done
  return output
}

describe('ImageEditorGpuExportResidualV3（真实WebGPU）', () => {
  it('在GPU内合并高分辨率局部结果与全局低频差，只执行最终一次readFloats', async () => {
    const localFull = await filled([4, 2], [0.2, 0.1, 0.05, 1])
    const globalLow = await filled([2, 1], [0.6, 0.3, 0.15, 1])
    const localLow = await filled([1, 1], [0.1, 0.05, 0.025, 1])
    const residual = new ImageEditorGpuExportResidualV3(gpu)
    try {
      const pixels = await residual.read(localFull, globalLow, localLow, [0, 0, 1, 1])
      expect(pixels).toHaveLength(4 * 2 * 4)
      for (let offset = 0; offset < pixels.length; offset += 4) {
        expect(Math.abs(pixels[offset] - 0.7)).toBeLessThanOrEqual(1e-3)
        expect(Math.abs(pixels[offset + 1] - 0.35)).toBeLessThanOrEqual(1e-3)
        expect(Math.abs(pixels[offset + 2] - 0.175)).toBeLessThanOrEqual(1e-3)
        expect(Math.abs(pixels[offset + 3] - 1)).toBeLessThanOrEqual(1e-3)
      }
    } finally {
      residual.dispose()
      localFull.color.destroy()
      globalLow.color.destroy()
      localLow.color.destroy()
    }
  })

  it('保留透明alpha和HDR负值/>1的Float16 canonical范围', async () => {
    const localFull = await filled([2, 1], [-0.25, 1.5, 0.125, 0.5])
    const globalLow = await filled([1, 1], [0.125, 0.25, 1.25, 0.25])
    const localLow = await filled([1, 1], [0.25, 0.5, 0.25, 0.125])
    const residual = new ImageEditorGpuExportResidualV3(gpu)
    try {
      const pixels = await residual.read(localFull, globalLow, localLow, [0, 0, 1, 1])
      const expected = [-0.375, 1.25, 1.125, 0.625]
      for (let offset = 0; offset < pixels.length; offset += 4) {
        for (let channel = 0; channel < 4; channel += 1) {
          expect(Math.abs(pixels[offset + channel]! - expected[channel]!)).toBeLessThanOrEqual(1e-3)
        }
      }
    } finally {
      residual.dispose()
      localFull.color.destroy()
      globalLow.color.destroy()
      localLow.color.destroy()
    }
  })
})
