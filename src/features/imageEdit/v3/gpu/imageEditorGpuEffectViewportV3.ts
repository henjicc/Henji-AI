import { resolveFastBlurV3Geometry } from '@/core/imageEdit/v3/effects/fastBlur'
import { resolveGaussianBlurV2Geometry } from '@/core/imageEdit/v3/effects/gaussianBlur'
import { resolveImageEditOutputGeometryV3 } from '@/core/imageEdit/v3/outputGeometry'
import type { ImageEditorViewportLayoutV3 } from '../editor/useImageEditorViewportLayoutV3'
import type { ImageEditorGpuRasterSceneV3 } from './imageEditorGpuRasterSceneCompilerV3'

export interface ImageEditorGpuEffectViewportV3 {
  readonly layout: ImageEditorViewportLayoutV3
  readonly cropOffset: readonly [number, number]
  readonly expanded: boolean
}

/** 先扩展效果求值域，帧末裁回原视口；全局散射在当前缩放下覆盖完整文档。 */
export function resolveImageEditorGpuEffectViewportV3(
  scene: ImageEditorGpuRasterSceneV3,
  layout: ImageEditorViewportLayoutV3,
): ImageEditorGpuEffectViewportV3 {
  if (!scene.requiresRenderGraph) return { layout, cropOffset: [0, 0], expanded: false }
  const effects = scene.graph.filter((node) => node.kind === 'effect')
  if (effects.length === 0) return { layout, cropOffset: [0, 0], expanded: false }
  const viewport = layout.viewport
  const scale = viewport.zoom * viewport.devicePixelRatio
  const output = resolveImageEditOutputGeometryV3(scene.geometry)
  const endX = viewport.documentX + viewport.width / viewport.zoom
  const endY = viewport.documentY + viewport.height / viewport.zoom
  const hasGlobal = effects.some((node) => {
    if (node.definitionId === 'effect.diffusion' || node.definitionId === 'effect.vgpu-glow') return true
    if (node.definitionId === 'effect.blur-v1' || node.definitionId === 'effect.gaussian-blur') {
      return gaussianSupport(node, scale) > 256
    }
    if (node.definitionId !== 'effect.fast-blur') return false
    return resolveFastBlurV3Geometry({ radius: finiteParameter(node.parameters.radius) * scale,
      mip: finiteParameter(node.parameters.mip) }).requiresGlobalAnalysis
  })
  let left: number; let top: number; let right: number; let bottom: number
  if (hasGlobal) {
    left = Math.max(0, Math.round((viewport.documentX - Math.min(viewport.documentX, 0)) * scale))
    top = Math.max(0, Math.round((viewport.documentY - Math.min(viewport.documentY, 0)) * scale))
    right = Math.max(0, Math.round((Math.max(endX, output.outputWidth) - endX) * scale))
    bottom = Math.max(0, Math.round((Math.max(endY, output.outputHeight) - endY) * scale))
  } else {
    const halo = effects.reduce((sum, node) => {
      if (node.definitionId === 'effect.blur-v1' || node.definitionId === 'effect.gaussian-blur') {
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
  return resolveGaussianBlurV2Geometry({ radius: legacy ? Math.min(120, radius) : radius, mip }).haloAtMip
}

function finiteParameter(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0
}
