import type { ResolvedGaussianPlan, ResolvedGaussianPass } from '../gaussian'

export interface GaussianRegion { x: number; y: number; width: number; height: number }
/** 坐标是完整输出网格中的像素坐标；数据为 linear-light 预乘 RGBA。 */
export interface GaussianPixelWindow extends GaussianRegion { data: Float32Array }

function intersect(region: GaussianRegion, width: number, height: number): GaussianRegion {
  const x = Math.max(0, region.x); const y = Math.max(0, region.y)
  return { x, y, width: Math.max(0, Math.min(width, region.x + region.width) - x), height: Math.max(0, Math.min(height, region.y + region.height) - y) }
}
function sourceRegion(pass: ResolvedGaussianPass, target: GaussianRegion): GaussianRegion {
  const step = pass.operation
  const radiusX = step.kind === 'blur' && step.axis === 'x' ? step.radius : 0
  const radiusY = step.kind === 'blur' && step.axis === 'y' ? step.radius : 0
  const x = Math.floor((target.x + 0.5) * pass.sampleScale[0] - 0.5) - radiusX
  const y = Math.floor((target.y + 0.5) * pass.sampleScale[1] - 0.5) - radiusY
  const endX = Math.ceil((target.x + target.width - 0.5) * pass.sampleScale[0] - 0.5) + radiusX + 1
  const endY = Math.ceil((target.y + target.height - 0.5) * pass.sampleScale[1] - 0.5) + radiusY + 1
  return intersect({ x, y, width: endX - x, height: endY - y }, step.sourceWidth, step.sourceHeight)
}

/** 反向传播真实取样 support；接缝从全局网格读邻域，不把 tile 当画面边界。 */
export function gaussianExecutionWindows(plan: ResolvedGaussianPlan, output: GaussianRegion = { x: 0, y: 0, ...plan.outputSize }): GaussianRegion[] {
  if (![output.x, output.y, output.width, output.height].every(Number.isSafeInteger) || output.x < 0 || output.y < 0 || output.width < 1 || output.height < 1 || output.x + output.width > plan.outputSize.width || output.y + output.height > plan.outputSize.height) throw new Error('高斯输出区域必须位于完整画面中')
  const windows: GaussianRegion[] = Array.from({ length: plan.passes.length + 1 })
  windows[plan.passes.length] = output
  for (let index = plan.passes.length - 1; index >= 0; index--) windows[index] = sourceRegion(plan.passes[index], windows[index + 1])
  return windows
}

export function executeGaussianCpu(plan: ResolvedGaussianPlan, input: GaussianPixelWindow, output?: GaussianRegion): GaussianPixelWindow {
  if (input.data.length !== input.width * input.height * 4) throw new Error('高斯输入尺寸与 RGBA 数据不一致')
  const windows = gaussianExecutionWindows(plan, output)
  let current = input
  for (const [index, pass] of plan.passes.entries()) {
    const step = pass.operation; const region = windows[index + 1]
    const data = new Float32Array(region.width * region.height * 4)
    const repeat = plan.parameters.edge_mode === 'clamp'
    const load = (x: number, y: number, channel: number): number => {
      if (x < 0 || y < 0 || x >= step.sourceWidth || y >= step.sourceHeight) {
        if (!repeat) return 0
        x = Math.max(0, Math.min(step.sourceWidth - 1, x)); y = Math.max(0, Math.min(step.sourceHeight - 1, y))
      }
      if (x < current.x || y < current.y || x >= current.x + current.width || y >= current.y + current.height) throw new Error('高斯输入缺少共享计划要求的真实 halo')
      const offset = ((y - current.y) * current.width + x - current.x) * 4
      return current.data[offset + 3] === 0 ? 0 : current.data[offset + channel]
    }
    const sample = (x: number, y: number, channel: number): number => {
      const x0 = Math.floor(x); const y0 = Math.floor(y); const fx = x - x0; const fy = y - y0
      // 不读权重为零的邻点，否则直接核会被错误要求额外 halo。
      const top = fx === 0 ? load(x0, y0, channel) : load(x0, y0, channel) * (1 - fx) + load(x0 + 1, y0, channel) * fx
      if (fy === 0) return top
      const bottom = fx === 0 ? load(x0, y0 + 1, channel) : load(x0, y0 + 1, channel) * (1 - fx) + load(x0 + 1, y0 + 1, channel) * fx
      return top * (1 - fy) + bottom * fy
    }
    const radius = step.kind === 'blur' ? step.radius : 0
    const weights = Array.from({ length: radius * 2 + 1 }, (_, tap) => step.kind === 'blur' ? Math.exp(-((tap - radius) ** 2) / (2 * step.sigma ** 2)) : 1)
    const total = weights.reduce((sum, value) => sum + value, 0)
    for (let y = 0; y < region.height; y++) for (let x = 0; x < region.width; x++) {
      const sx = (region.x + x + 0.5) * pass.sampleScale[0] - 0.5
      const sy = (region.y + y + 0.5) * pass.sampleScale[1] - 0.5
      for (let channel = 0; channel < 4; channel++) {
        let sum = 0
        for (let tap = -radius; tap <= radius; tap++) sum += sample(sx + (step.kind === 'blur' && step.axis === 'x' ? tap : 0), sy + (step.kind === 'blur' && step.axis === 'y' ? tap : 0), channel) * weights[tap + radius]
        data[(y * region.width + x) * 4 + channel] = sum / total
      }
    }
    current = { ...region, data }
  }
  return current
}
