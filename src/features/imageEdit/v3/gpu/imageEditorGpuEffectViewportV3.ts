import { colorGradeSpatialSupport } from '@/core/imaging/adjustments/plan'
import { resolveFastBlurV3Geometry } from '@/core/imageEdit/v3/effects/fastBlur'
import { resolveGaussianBlurV2Geometry } from '@/core/imageEdit/v3/effects/gaussianBlur'
import { resolveImageEditOutputGeometryV3 } from '@/core/imageEdit/v3/outputGeometry'
import type { ImageEditorViewportLayoutV3 } from '../editor/useImageEditorViewportLayoutV3'
import type { ImageEditorGpuRasterSceneV3 } from './imageEditorGpuRasterSceneCompilerV3'
import { planImageEditorGpuGaussianRegionsV3, usesImageEditorGpuGaussianRegionsV3 } from './imageEditorGpuGaussianRegionsV3'
import type { GaussianRegion } from '@/core/imaging/effects/cpu/gaussian'

export interface ImageEditorGpuEffectViewportV3 {
  readonly layout: ImageEditorViewportLayoutV3
  readonly cropOffset: readonly [number, number]
  readonly expanded: boolean
}

/** 先扩展效果求值域，帧末裁回原视口；全局散射在当前缩放下覆盖完整文档。 */
export function resolveImageEditorGpuEffectViewportV3(
  scene: ImageEditorGpuRasterSceneV3,
  layout: ImageEditorViewportLayoutV3,
  retainedInput?: GaussianRegion,
  outputSize?: readonly [number, number],
): ImageEditorGpuEffectViewportV3 {
  if (!scene.requiresRenderGraph) return { layout, cropOffset: [0, 0], expanded: false }
  const effects = scene.graph.filter((node) => node.kind === 'effect')
  const grades = scene.graph.flatMap(node => node.kind === 'adjustment' ? node.adjustments.filter(adjustment => adjustment.definitionId === 'adjustment.color-grade') : [])
  if (effects.length === 0 && grades.length === 0) return { layout, cropOffset: [0, 0], expanded: false }
  const viewport = layout.viewport
  if (usesImageEditorGpuGaussianRegionsV3(scene)) {
    const region = planImageEditorGpuGaussianRegionsV3(scene, layout, outputSize)
    const scale = viewport.zoom * viewport.devicePixelRatio
    const required = region.input
    const x = Math.min(required.x, retainedInput?.x ?? required.x), y = Math.min(required.y, retainedInput?.y ?? required.y)
    const input = { x, y, width: Math.max(required.x + required.width, retainedInput ? retainedInput.x + retainedInput.width : required.x + required.width) - x,
      height: Math.max(required.y + required.height, retainedInput ? retainedInput.y + retainedInput.height : required.y + required.height) - y }
    const offset = [region.origin[0] - input.x, region.origin[1] - input.y] as const
    const working: ImageEditorViewportLayoutV3 = { ...layout,
      stageWidth: input.width / viewport.devicePixelRatio, stageHeight: input.height / viewport.devicePixelRatio,
      viewportKey: `${layout.viewportKey}:gaussian-region:${input.x}:${input.y}:${input.width}:${input.height}`,
      viewport: { ...viewport, documentX: input.x / scale, documentY: input.y / scale,
        width: input.width / viewport.devicePixelRatio, height: input.height / viewport.devicePixelRatio } }
    return { layout: working, cropOffset: offset, expanded: input.width !== Math.ceil(viewport.width * viewport.devicePixelRatio)
      || input.height !== Math.ceil(viewport.height * viewport.devicePixelRatio) || offset[0] !== 0 || offset[1] !== 0 }
  }
  // 混合其他空间核时保留其完整分析域；不能拿 Gaussian 的 halo 代替它的 support。
  if (effects.some(node => node.definitionId === 'effect.gaussian_blur')) {
    const scale = viewport.zoom * viewport.devicePixelRatio
    const width = Math.max(1, Math.ceil(scene.width * scale))
    const height = Math.max(1, Math.ceil(scene.height * scale))
    return { expanded: true, cropOffset: [Math.round(viewport.documentX * scale), Math.round(viewport.documentY * scale)],
      layout: { ...layout, stageWidth: width / viewport.devicePixelRatio, stageHeight: height / viewport.devicePixelRatio,
        viewportKey: `${layout.viewportKey}:gaussian-global:${width}:${height}`,
        viewport: { ...viewport, documentX: 0, documentY: 0, width: width / viewport.devicePixelRatio, height: height / viewport.devicePixelRatio } } }
  }
  const scale = viewport.zoom * viewport.devicePixelRatio
  const output = resolveImageEditOutputGeometryV3(scene.geometry)
  const endX = viewport.documentX + viewport.width / viewport.zoom
  const endY = viewport.documentY + viewport.height / viewport.zoom
  // Shared grade pyramids evaluate on the complete oriented source grid: no ROI phase drift,
  // including neighbors outside non-destructive crops. The existing GPU budget still governs residency.
  const gradeNeighbors = grades.some(grade => colorGradeSpatialSupport(grade.parameters, scene.geometry.height * scale) > 0)
  const hasGlobal = gradeNeighbors || effects.some((node) => {
    if (node.definitionId === 'effect.diffusion' || node.definitionId === 'effect.vgpu-glow') return true
    if (node.definitionId === 'effect.blur-v1') {
      return gaussianSupport(node, scale) > 256
    }
    if (node.definitionId !== 'effect.fast-blur') return false
    return resolveFastBlurV3Geometry({ radius: finiteParameter(node.parameters.radius) * scale,
      mip: finiteParameter(node.parameters.mip) }).requiresGlobalAnalysis
  })
  let left: number; let top: number; let right: number; let bottom: number
  if (hasGlobal) {
    left = Math.max(0, Math.round((viewport.documentX - Math.min(viewport.documentX, gradeNeighbors ? -output.cropX : 0)) * scale))
    top = Math.max(0, Math.round((viewport.documentY - Math.min(viewport.documentY, gradeNeighbors ? -output.cropY : 0)) * scale))
    right = Math.max(0, Math.round((Math.max(endX, gradeNeighbors ? (output.rotate === 90 || output.rotate === 270 ? output.sourceHeight : output.sourceWidth) - output.cropX : output.outputWidth) - endX) * scale))
    bottom = Math.max(0, Math.round((Math.max(endY, gradeNeighbors ? (output.rotate === 90 || output.rotate === 270 ? output.sourceWidth : output.sourceHeight) - output.cropY : output.outputHeight) - endY) * scale))
  } else {
    const halo = effects.reduce((sum, node) => {
      if (node.definitionId === 'effect.blur-v1') {
        return sum + gaussianSupport(node, scale)
      }
      if (node.definitionId !== 'effect.fast-blur') return sum
      const radius = finiteParameter(node.parameters.radius)
      const mip = finiteParameter(node.parameters.mip)
      return sum + resolveFastBlurV3Geometry({ radius: radius * scale, mip }).supportAtMip
    }, 0)
    left = Math.min(halo, Math.max(0, Math.floor(viewport.documentX * scale)))
    top = Math.min(halo, Math.max(0, Math.floor(viewport.documentY * scale)))
    right = Math.min(halo, Math.max(0, Math.floor((output.outputWidth - endX) * scale)))
    bottom = Math.min(halo, Math.max(0, Math.floor((output.outputHeight - endY) * scale)))
  }
  if (left + top + right + bottom === 0) return { layout, cropOffset: [0, 0], expanded: false }
  const expandedLayout: ImageEditorViewportLayoutV3 = {
    stageWidth: layout.stageWidth + (left + right) / viewport.devicePixelRatio,
    stageHeight: layout.stageHeight + (top + bottom) / viewport.devicePixelRatio,
    viewportKey: `${layout.viewportKey}:effect:${left}:${top}:${right}:${bottom}`,
    viewport: {
      ...viewport,
      documentX: viewport.documentX - left / scale,
      documentY: viewport.documentY - top / scale,
      width: viewport.width + (left + right) / viewport.devicePixelRatio,
      height: viewport.height + (top + bottom) / viewport.devicePixelRatio,
    },
  }
  return { layout: expandedLayout, cropOffset: [left, top], expanded: true }
}

function gaussianSupport(
  node: Extract<ImageEditorGpuRasterSceneV3['graph'][number], { kind: 'effect' }>,
  scale: number,
): number {
  const legacy = node.definitionId === 'effect.blur-v1'
  const radius = finiteParameter(node.parameters[legacy ? 'radiusPixels' : 'radius']) * scale
  const mip = legacy ? 0 : finiteParameter(node.parameters.mip)
  return resolveGaussianBlurV2Geometry({ radius, mip }).haloAtMip
}

function finiteParameter(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0
}
