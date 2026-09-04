import {
  DIFFUSION_V4_RECIPE_ADAPTER,
  VGPU_GLOW_V4_RECIPE_ADAPTER,
  resolveFastBlurV3Geometry,
  type ImageEditRenderPlan,
} from '@/core/imageEdit/v3'
import type { ImageEditorGpuSceneExportTilePlanV3 } from '../gpu/imageEditorGpuSceneProtocolV3'

export interface ImageEditorGpuExportPlanV3 {
  readonly halo: number
  readonly tiles: readonly ImageEditorGpuSceneExportTilePlanV3[]
  readonly multiscaleAnalysis?: { readonly width: number; readonly height: number; readonly localHalo: number }
}

const IMAGE_EDITOR_GPU_EXPORT_LOCAL_HALO_V3 = 256
const IMAGE_EDITOR_GPU_EXPORT_ANALYSIS_MAX_DIMENSION_V3 = 2048

/**
 * 对最深 divisor=d 的连续 2× 金字塔，down 每级的线性采样支撑为
 * `(kernelRadius + 0.5) * (1 + 2 + ... + d/2)`；upsample 的 3×3 tent
 * 从 d 到 2 逐级重建，支撑为 `1.5 * (4 + 8 + ... + d)`。最后再留 1px
 * 给 level-0 的线性采样。这个式子直接对应正式 WGSL 的采样点，不是经验半径。
 */
export function imageEditorGpuScatterSupportV3(
  deepestDivisor: number,
  downsampleKernelRadius: 1 | 2,
): number {
  if (deepestDivisor < 2) return 0
  const downsample = (downsampleKernelRadius + 0.5) * (deepestDivisor - 1)
  const upsample = 1.5 * Math.max(0, 2 * deepestDivisor - 4)
  return Math.ceil(downsample + upsample + 1)
}

export function resolveImageEditorGpuExportHaloV3(
  plan: ImageEditRenderPlan,
  width: number,
  height: number,
): number {
  let halo = 0
  for (const node of plan.nodes) {
    if (node.definitionId === 'effect.fast-blur') {
      const radius = finite(node.parameters.radius)
      const mip = finite(node.parameters.mip)
      halo += Math.ceil(resolveFastBlurV3Geometry({ radius, mip }).supportAtMip * (2 ** mip))
      continue
    }
    if (node.definitionId === 'effect.diffusion') {
      const recipe = DIFFUSION_V4_RECIPE_ADAPTER.compileRecipe(
        DIFFUSION_V4_RECIPE_ADAPTER.parseParameters(node.parameters),
        { width, height, quality: 'high' },
      )
      const deepest = [...recipe.scatterLevels].reverse().find((level) => (
        level.weight.some((weight) => weight > 0)
      ))
      halo += imageEditorGpuScatterSupportV3(deepest?.divisor ?? 0, 1)
      continue
    }
    if (node.definitionId === 'effect.vgpu-glow') {
      const recipe = VGPU_GLOW_V4_RECIPE_ADAPTER.compileRecipe(
        VGPU_GLOW_V4_RECIPE_ADAPTER.parseParameters(node.parameters),
        { width, height },
      )
      const deepest = [...recipe.scatterLevels].reverse().find((level) => (
        level.whiteCoreWeight > 0 || level.weight.some((weight) => weight > 0)
      ))
      halo += imageEditorGpuScatterSupportV3(deepest?.divisor ?? 0, 2)
        + Math.ceil(Math.abs(recipe.chromaticOffsetPx)) + 1
    }
  }
  return halo
}

export function createImageEditorGpuExportPlanV3(options: {
  plan: ImageEditRenderPlan
  width: number
  height: number
  tileSize: number
}): ImageEditorGpuExportPlanV3 {
  const halo = resolveImageEditorGpuExportHaloV3(options.plan, options.width, options.height)
  const multiscale = halo > IMAGE_EDITOR_GPU_EXPORT_LOCAL_HALO_V3
  const executionHalo = multiscale ? IMAGE_EDITOR_GPU_EXPORT_LOCAL_HALO_V3 : halo
  const columns = Math.ceil(options.width / options.tileSize)
  const rows = Math.ceil(options.height / options.tileSize)
  const tiles: ImageEditorGpuSceneExportTilePlanV3[] = []
  for (let tileY = 0; tileY < rows; tileY += 1) {
    for (let tileX = 0; tileX < columns; tileX += 1) {
      const x = tileX * options.tileSize
      const y = tileY * options.tileSize
      const width = Math.min(options.tileSize, options.width - x)
      const height = Math.min(options.tileSize, options.height - y)
      const renderX = Math.max(0, x - executionHalo)
      const renderY = Math.max(0, y - executionHalo)
      const renderRight = Math.min(options.width, x + width + executionHalo)
      const renderBottom = Math.min(options.height, y + height + executionHalo)
      tiles.push({
        tileX, tileY, x, y, width, height,
        renderX, renderY,
        renderWidth: renderRight - renderX,
        renderHeight: renderBottom - renderY,
        coreOffsetX: x - renderX,
        coreOffsetY: y - renderY,
      })
    }
  }
  if (!multiscale) return { halo, tiles }
  const scale = Math.min(1, IMAGE_EDITOR_GPU_EXPORT_ANALYSIS_MAX_DIMENSION_V3
    / Math.max(options.width, options.height))
  return {
    halo,
    tiles,
    multiscaleAnalysis: {
      width: Math.max(1, Math.round(options.width * scale)),
      height: Math.max(1, Math.round(options.height * scale)),
      localHalo: executionHalo,
    },
  }
}

function finite(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0
}
