import { planColorGrade, isNeutralAdjustmentPlan } from '@/core/imaging/adjustments/plan'
import { imageColorGradeRuntimeParams } from '@/core/imaging/adjustments/schema'
import {
  DIFFUSION_V4_RECIPE_ADAPTER,
  VGPU_GLOW_V4_RECIPE_ADAPTER,
} from '@/core/imageEdit/v3/effects'
import { resolveGaussianPixelPlan } from '@/core/imageEdit/v3/effects/gaussianBlur'
import type {
  ImageEditorGpuGraphEffectNodeV3,
  ImageEditorGpuRasterSceneV3,
} from './imageEditorGpuRasterSceneCompilerV3'

const LINEAR_BYTES_PER_PIXEL = 8
const PRESENT_BYTES_PER_PIXEL = 4
const MASK_BYTES_PER_PIXEL = 1

/** 按 renderer 真正常驻的全尺寸与金字塔尺寸计费，避免把每层都误算为全尺寸。 */
export function estimateImageEditorGpuGraphResidentBytesV3(
  scene: ImageEditorGpuRasterSceneV3,
  size: readonly [number, number],
): number {
  const fullLinearBytes = pixels(size) * LINEAR_BYTES_PER_PIXEL
  const semanticTargets = scene.graph.filter((node) => (
    node.kind !== 'source' && node.kind !== 'alias' && node.kind !== 'effect'
  )).length
  const sourceScratchTargets = scene.graph.some((node) => node.kind === 'source') ? 1 : 0
  const masks = new Set<string>()
  let adjustmentScratchBytes = 0
  const effectNodes: ImageEditorGpuGraphEffectNodeV3[] = []
  for (const node of scene.graph) {
    if (node.kind === 'composite' && node.mask) masks.add(node.mask.maskId)
    if (node.kind === 'adjustment') {
      for (const adjustment of node.adjustments) {
        if (adjustment.mask) masks.add(adjustment.mask.maskId)
        if (adjustment.definitionId === 'adjustment.color-grade') {
          const { opacity: _opacity, blendMode: _blendMode, transform: _transform, referenceWidth: _width, referenceHeight: _height, ...value } = adjustment.parameters
          const plan = planColorGrade(imageColorGradeRuntimeParams(value), size[0], size[1])
          if (!isNeutralAdjustmentPlan(plan)) adjustmentScratchBytes += 3 * fullLinearBytes
            + plan.scratch.reduce((sum, surface) => sum + surface.width * surface.height * LINEAR_BYTES_PER_PIXEL, 0)
          // Cube parsing is bounded by the shared 65³ lattice; reserve decoded lookup bytes, not a layer count.
          adjustmentScratchBytes += [value.input_lut, value.look_lut].filter(ref => !!ref).length * 65 ** 3 * 16
          adjustmentScratchBytes += plan.passes.filter(pass => pass.lookup?.kind === 'curve').reduce((sum, pass) => sum + (pass.lookup?.kind === 'curve' ? pass.lookup.data.byteLength * 4 : 0), 0)
        }
      }
    }
    if (node.kind !== 'effect') continue
    if (node.mask) masks.add(node.mask.maskId)
    effectNodes.push(node)
  }
  return pixels(size) * PRESENT_BYTES_PER_PIXEL
    + (semanticTargets + sourceScratchTargets) * fullLinearBytes
    + masks.size * pixels(size) * MASK_BYTES_PER_PIXEL
    + estimateEffectsBytes(effectNodes, size) + adjustmentScratchBytes
}

function estimateEffectsBytes(
  nodes: readonly ImageEditorGpuGraphEffectNodeV3[],
  size: readonly [number, number],
): number {
  if (nodes.length === 0) return 0
  const fullBytes = pixels(size) * LINEAR_BYTES_PER_PIXEL
  let scratchTargets = 0
  let maximumPyramidBytes = 0
  let gaussianScratchBytes = 0
  for (const node of nodes) {
    if (node.definitionId === 'effect.blur-v1' || node.definitionId === 'effect.gaussian-blur') {
      const radiusKey = node.definitionId === 'effect.blur-v1' ? 'radiusPixels' : 'radius'
      const rawRadius = node.parameters[radiusKey]
      const rawMip = node.definitionId === 'effect.blur-v1' ? 0 : node.parameters.mip
      const radius = typeof rawRadius === 'number' && Number.isFinite(rawRadius)
        ? Math.max(0, rawRadius)
        : 0
      const mip = typeof rawMip === 'number' && Number.isFinite(rawMip) ? Math.max(0, rawMip) : 0
      // final 的 fp32 中间窗口归各 Gaussian renderer 持有，不能按共享 fp16 金字塔估算。
      gaussianScratchBytes += resolveGaussianPixelPlan({ radius: radius / (2 ** mip), mip: 0 }, size[0], size[1]).scratchBytes
    }
    if (node.definitionId === 'effect.fast-blur') scratchTargets = Math.max(scratchTargets, 2)
    if (node.definitionId === 'effect.diffusion') {
      scratchTargets = Math.max(scratchTargets, 1)
      const recipe = DIFFUSION_V4_RECIPE_ADAPTER.compileRecipe(
        DIFFUSION_V4_RECIPE_ADAPTER.parseParameters(node.parameters),
        { width: size[0], height: size[1], quality: 'high' },
      )
      maximumPyramidBytes = Math.max(maximumPyramidBytes,
        pyramidBytes(size, recipe.scatterLevels))
    }
    if (node.definitionId === 'effect.vgpu-glow') {
      scratchTargets = Math.max(scratchTargets, 2)
      const recipe = VGPU_GLOW_V4_RECIPE_ADAPTER.compileRecipe(
        VGPU_GLOW_V4_RECIPE_ADAPTER.parseParameters(node.parameters),
        { width: size[0], height: size[1] },
      )
      maximumPyramidBytes = Math.max(maximumPyramidBytes,
        pyramidBytes(size, recipe.scatterLevels))
    }
    if (node.opacity !== 1 || node.blendMode !== 'normal' || node.mask !== null) {
      scratchTargets = Math.max(scratchTargets, 3)
    }
  }
  return (nodes.length + scratchTargets) * fullBytes + maximumPyramidBytes + gaussianScratchBytes
}

function pyramidBytes(
  size: readonly [number, number],
  levels: readonly { divisor: number }[],
): number {
  return levels.reduce((total, level, index) => {
    const levelBytes = pixels(scaled(size, level.divisor)) * LINEAR_BYTES_PER_PIXEL
    return total + levelBytes * (index < levels.length - 1 ? 2 : 1)
  }, 0)
}

function pixels(size: readonly [number, number]): number {
  return Math.max(1, Math.ceil(size[0])) * Math.max(1, Math.ceil(size[1]))
}

function scaled(
  size: readonly [number, number],
  divisor: number,
): readonly [number, number] {
  return [Math.max(1, Math.ceil(size[0] / divisor)), Math.max(1, Math.ceil(size[1] / divisor))]
}
