import type { ResolvedGaussianPlan } from '@/core/imaging/effects/gaussian'
import type { GaussianRegion } from '@/core/imaging/effects/cpu/gaussian'

/** interactive 金字塔尺寸缩小后提升存储精度，阻止多个 fp16 写入的有向量化误差累积。 */
export function imageEditorGpuGaussianStorageV3(plan: ResolvedGaussianPlan, passIndex: number): 'rgba16float' | 'rgba32float' {
  const pass = plan.passes[passIndex].operation
  return plan.quality === 'interactive' && (pass.width < plan.outputSize.width || pass.height < plan.outputSize.height)
    ? 'rgba32float' : plan.intermediateFormat
}

/** 工作窗口是逻辑范围；物理中间纹理允许少量尾部余量，避免拖参数时每一像素都重建资源。 */
export function imageEditorGpuGaussianAllocationSizeV3(width: number, height: number): readonly [number, number] {
  return [Math.ceil(width / 32) * 32, Math.ceil(height / 32) * 32]
}

export interface ImageEditorGpuGaussianAllocationV3 {
  readonly key: string
  readonly size: readonly [number, number]
  readonly format: 'rgba16float' | 'rgba32float'
}

/** 每个网格只需交替的两个中间纹理；不能 resize 尚待同帧消费的输入。 */
export function imageEditorGpuGaussianAllocationsV3(plan: ResolvedGaussianPlan, windows: readonly GaussianRegion[]): readonly ImageEditorGpuGaussianAllocationV3[] {
  const groups = new Map<string, [number, number]>()
  const passes = plan.passes.slice(0, -1).map((pass, index) => {
    const format = imageEditorGpuGaussianStorageV3(plan, index)
    const group = `${pass.operation.width}:${pass.operation.height}:${format}`
    const window = windows[index + 1], size = groups.get(group) ?? [0, 0]
    size[0] = Math.max(size[0], window.width); size[1] = Math.max(size[1], window.height); groups.set(group, size)
    return { group, format }
  })
  let previousGroup = '', previousSlot = 1
  return passes.map(({ group, format }) => {
    const slot = group === previousGroup ? 1 - previousSlot : 0
    previousGroup = group; previousSlot = slot
    return { key: `${group}:${slot}`, format, size: imageEditorGpuGaussianAllocationSizeV3(...groups.get(group)!) }
  })
}

export function imageEditorGpuGaussianScratchBytesV3(plan: ResolvedGaussianPlan, windows: readonly GaussianRegion[]): number {
  const unique = new Map(imageEditorGpuGaussianAllocationsV3(plan, windows).map(allocation => [allocation.key, allocation]))
  return [...unique.values()].reduce((sum, allocation) => sum + allocation.size[0] * allocation.size[1] * (allocation.format === 'rgba32float' ? 16 : 8), 0)
}
