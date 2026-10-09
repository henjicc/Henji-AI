import { gaussianParameterSchema, resolveGaussianPlan } from './gaussian'
import { executeGaussianCpu } from './cpu/gaussian'

/** 定向诊断：不启动宿主、不触发付费；所有数值来自正式共享计划与 CPU 执行。 */
export function measureGaussianPlans(): object {
  const plans = []
  for (const [width, height] of [[1920, 1080], [3840, 2160]]) for (const sigma_fraction_height of [0.003, 0.03]) for (const quality of ['interactive', 'final'] as const) {
    const plan = resolveGaussianPlan(gaussianParameterSchema.parse({ sigma_fraction_height }), { referenceSize: { width, height }, outputSize: { width, height }, quality })
    plans.push({ width, height, sigma_fraction_height, quality, passes: plan.passes.length, scratchBytes: plan.scratchBytes, intermediateFormat: plan.intermediateFormat, halo: plan.halo, levels: plan.downsampleLevels })
  }
  const impulse = []
  for (const sigma of [1, 3.24, 16, 32.4, 64.8]) {
    const width = 2049; const height = 1; const center = 1024; const data = new Float32Array(width * 4); data.set([1, 1, 1, 1], center * 4)
    const outputs = []
    for (const quality of ['interactive', 'final'] as const) {
      const plan = resolveGaussianPlan(gaussianParameterSchema.parse({ sigma_fraction_height: sigma, axis: 'horizontal', edge_mode: 'transparent' }), { referenceSize: { width, height }, outputSize: { width, height }, quality })
      const output = executeGaussianCpu(plan, { x: 0, y: 0, width, height, data }).data
      outputs.push(output)
      let energy = 0; let moment = 0; let mean = 0; let maxDirectError = 0
      const directWeights = Array.from({ length: width }, (_, x) => Math.exp(-((x - center) ** 2) / (2 * sigma ** 2)))
      const total = directWeights.reduce((sum, value) => sum + value, 0)
      for (let x = 0; x < width; x++) { const value = output[x * 4]; energy += value; moment += (x - center) ** 2 * value; mean += (x - center) * value; maxDirectError = Math.max(maxDirectError, Math.abs(value - directWeights[x] / total)) }
      impulse.push({ sigma, quality, energy, centroid: mean / energy, varianceError: (moment / energy - (mean / energy) ** 2) / (sigma ** 2) - 1, maxDirectError })
    }
    let max = 0; let squared = 0
    for (let i = 0; i < outputs[0].length; i++) { const delta = outputs[0][i] - outputs[1][i]; max = Math.max(max, Math.abs(delta)); squared += delta ** 2 }
    impulse.push({ sigma, comparison: 'interactive-final', max, rmse: Math.sqrt(squared / outputs[0].length) })
  }
  return { plans, impulse }
}
