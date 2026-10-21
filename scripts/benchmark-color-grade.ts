/**
 * 全能调色拖参基准（显式专项，不进日常测试）：正式剪辑 GPU 效果渲染器在指定尺寸下，
 * 每组参数先预热，再测 9 轮“连续拖动 10 帧（每帧写参数 → 计划 → 上传 → 提交）→ 等 GPU 完成”的每帧平均耗时（中位数与最大值），
 * 以及计划（CPU）耗时和工序数。单帧等待会把队列往返延迟算进去，连续 10 帧更接近拖动时的真实吞吐。
 * 参数只用 v1/v2 共有的键，脚本可原样复制到旧提交的工作树里取基线。
 *
 * 用法：vite-node scripts/benchmark-color-grade.ts --size=3840x2160
 */
import { init } from 'vgpu/node'
import type { GpuDevice, GpuTexture } from '../src/core/imageEdit/worker/webgpuRuntimeSupport'

const { VideoEditBuiltinEffectsGpu } = await import('../src/features/videoEdit/engine/videoEditBuiltinEffectsGpu')
const { planVideoEditBuiltinEffect } = await import('../src/features/videoEdit/engine/videoEditBuiltinEffectPasses')
const size = process.argv.find(arg => arg.startsWith('--size='))?.slice(7) ?? '3840x2160'
const [width, height] = size.split('x').map(Number)
if (!width || !height) throw new Error('尺寸使用 WIDTHxHEIGHT')
const curve = (points: Array<[number, number]>): string => JSON.stringify(points.map(([x, y]) => ({ x, y })))
const CASES: Record<string, Record<string, number | string>> = {
  曝光: { exposure: .1 },
  基本: { exposure: .1, contrast: 15, highlights: -20, shadows: 15, whites: 5, blacks: -5, saturation: 10, vibrance: 10 },
  全开: { exposure: .1, contrast: 15, highlights: -20, shadows: 15, saturation: 10, faded_film: 10, curve_master_points: curve([[0, 0], [40, 48], [100, 100]]), curve_red_points: curve([[0, 3], [100, 97]]),
    curve_green_points: curve([[0, 0], [50, 52], [100, 100]]), curve_blue_points: curve([[0, 0], [60, 55], [100, 100]]), curve_hue_sat_points: curve([[0, 50], [35, 70], [100, 50]]), curve_hue_luma_points: curve([[0, 50], [60, 40], [100, 50]]),
    curve_luma_sat_points: curve([[0, 50], [50, 60], [100, 50]]), shadow_hue: 220, shadow_strength: 10, midtone_luminance: 5, highlight_hue: 40, highlight_strength: 8, vignette_amount: -20 },
}
const percentile = (values: number[], q: number): number => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * q))]
const gpu = await init(); const device = gpu.gpu
const allocate = (w: number, h: number) => device.createTexture({ size: [w, h], format: 'rgba16float', usage: 1 | 2 | 4 | 16 })
const source = allocate(width, height); const output = allocate(width, height)
const pixels = new Uint16Array(width * height * 4)
for (let i = 0; i < pixels.length; i += 4) pixels.set([0x3400 + (i & 255), 0x3800, 0x3a00 - (i & 127), 0x3c00], i)
device.queue.writeTexture({ texture: source }, pixels, { bytesPerRow: width * 8, rowsPerImage: height }, [width, height])
const renderer = new VideoEditBuiltinEffectsGpu(device as unknown as GpuDevice, device.createSampler({ minFilter: 'linear', magFilter: 'linear' }), { allocate: (w: number, h: number) => allocate(w, h) as unknown as GpuTexture, release: (texture: { destroy(): void }) => texture.destroy() })
const report: Record<string, unknown> = { size, at: new Date().toISOString() }
try {
  for (const [name, params] of Object.entries(CASES)) {
    const render = async (exposure: number): Promise<void> => {
      await renderer.render({ id: 'color_grade', params: { ...params, exposure } }, { texture: source as unknown as GpuTexture, width, height, format: 'rgba16float' }, output as unknown as GpuTexture, 0)
      // The program renderer sweeps idle lookups once per frame; mirror it so retained resources behave as in playback.
      renderer.releaseIdle?.()
    }
    for (let i = 0; i < 10; i++) await render(.05 * i)
    await device.queue.onSubmittedWorkDone()
    const gpuTimes: number[] = []; const planTimes: number[] = []
    for (let round = 0; round < 9; round++) {
      const start = performance.now()
      for (let i = 0; i < 10; i++) await render(.2 + (round * 10 + i) / 1000)
      await device.queue.onSubmittedWorkDone()
      gpuTimes.push((performance.now() - start) / 10)
      const planStart = performance.now(); const plan = planVideoEditBuiltinEffect({ id: 'color_grade', params: { ...params, exposure: .3 + round / 100 } }, { width, height, frame: 0 }); planTimes.push(performance.now() - planStart)
      report[`${name}.passes`] = plan.passes.length
    }
    report[`${name}.medianMs`] = Number(percentile(gpuTimes, .5).toFixed(2)); report[`${name}.maxMs`] = Number(Math.max(...gpuTimes).toFixed(2))
    report[`${name}.planMedianMs`] = Number(percentile(planTimes, .5).toFixed(3))
  }
} finally { renderer.dispose(); source.destroy(); output.destroy(); gpu.dispose() }
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
