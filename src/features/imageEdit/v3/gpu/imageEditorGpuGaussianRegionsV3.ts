import { gaussianParametersFromNodeV3 } from '@/core/imageEdit/v3/builtInRenderNodes'
import { colorGradeSpatialSupport } from '@/core/imaging/adjustments/plan'
import { resolveImageGaussianPlan } from '@/core/imageEdit/v3/effects/gaussianBlur'
import { gaussianExecutionWindows, type GaussianRegion } from '@/core/imaging/effects/cpu/gaussian'
import type { ResolvedGaussianPlan } from '@/core/imaging/effects/gaussian'
import type { ImageEditorViewportLayoutV3 } from '../editor/useImageEditorViewportLayoutV3'
import type { ImageEditorGpuRasterSceneV3 } from './imageEditorGpuRasterSceneCompilerV3'

export interface ImageEditorGpuGaussianRegionV3 {
  readonly plan: ResolvedGaussianPlan
  readonly output: GaussianRegion
  readonly windows: readonly GaussianRegion[]
}
export interface ImageEditorGpuGaussianRegionsV3 {
  readonly effects: ReadonlyMap<string, ImageEditorGpuGaussianRegionV3>
  readonly input: GaussianRegion
  readonly origin: readonly [number, number]
  readonly outputSize: readonly [number, number]
}

/** 其他邻域核仍采用各自既有分析/overscan，不能用 Gaussian 的 support 推测它们。 */
export function usesImageEditorGpuGaussianRegionsV3(scene: ImageEditorGpuRasterSceneV3): boolean {
  return scene.graph.some(node => node.kind === 'effect' && node.definitionId === 'effect.gaussian_blur')
    && scene.graph.every(node => node.kind !== 'effect' || node.definitionId === 'effect.gaussian_blur')
    && scene.graph.every(node => node.kind !== 'adjustment' || node.adjustments.every(adjustment => adjustment.definitionId !== 'adjustment.color-grade'
      || colorGradeSpatialSupport(adjustment.parameters, scene.height) === 0))
}

/** 从图的输出反传需求，分支取并集。同一完整网格计划贯穿 halo、执行及预算。 */
export function planImageEditorGpuGaussianRegionsV3(scene: ImageEditorGpuRasterSceneV3, layout: ImageEditorViewportLayoutV3, outputSize?: readonly [number, number]): ImageEditorGpuGaussianRegionsV3 {
  const scale = layout.viewport.zoom * layout.viewport.devicePixelRatio
  const width = outputSize?.[0] ?? Math.max(1, Math.ceil(scene.width * scale)), height = outputSize?.[1] ?? Math.max(1, Math.ceil(scene.height * scale))
  const x = Math.round(layout.viewport.documentX * scale), y = Math.round(layout.viewport.documentY * scale)
  const viewport = { x, y, width: Math.max(1, Math.ceil(layout.viewport.width * layout.viewport.devicePixelRatio)), height: Math.max(1, Math.ceil(layout.viewport.height * layout.viewport.devicePixelRatio)) }
  const requested = intersect(viewport, width, height)
  const needs = new Map<string, GaussianRegion>()
  const effects = new Map<string, ImageEditorGpuGaussianRegionV3>()
  let input = viewport
  const add = (id: string, region: GaussianRegion): void => { needs.set(id, union(needs.get(id), region)); input = union(input, region) }
  if (scene.outputNodeId && requested.width && requested.height) add(scene.outputNodeId, requested)
  for (const node of [...scene.graph].reverse()) {
    const output = needs.get(node.nodeId)
    if (!output || node.kind === 'source') continue
    if (node.kind === 'composite') {
      add(node.contentNodeId, output)
      if (node.backdropNodeId) add(node.backdropNodeId, output)
    } else if (node.kind === 'effect' && node.definitionId === 'effect.gaussian_blur') {
      const plan = resolveImageGaussianPlan(gaussianParametersFromNodeV3(node.parameters), { referenceSize: { width: scene.width, height: scene.height }, outputSize: { width, height }, quality: node.parameters.effectQuality === 'final' ? 'final' : 'interactive' })
      const windows = gaussianExecutionWindows(plan, output)
      effects.set(node.nodeId, { plan, output, windows })
      add(node.inputNodeId, windows[0])
      // 蒙版/混合还需原输入中的输出区域；windows[0] 本身覆盖它。
    } else add(node.inputNodeId, output)
  }
  return { effects, input, origin: [x, y], outputSize: [width, height] }
}

function intersect(region: GaussianRegion, width: number, height: number): GaussianRegion {
  const x = Math.max(0, Math.min(width, region.x)), y = Math.max(0, Math.min(height, region.y))
  return { x, y, width: Math.max(0, Math.min(width, region.x + region.width) - x), height: Math.max(0, Math.min(height, region.y + region.height) - y) }
}
function union(left: GaussianRegion | undefined, right: GaussianRegion): GaussianRegion {
  if (!left) return right
  const x = Math.min(left.x, right.x), y = Math.min(left.y, right.y)
  return { x, y, width: Math.max(left.x + left.width, right.x + right.width) - x, height: Math.max(left.y + left.height, right.y + right.height) - y }
}
