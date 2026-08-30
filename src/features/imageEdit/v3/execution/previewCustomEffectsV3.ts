import {
  DIFFUSION_V4_RECIPE_ADAPTER,
  VGPU_GLOW_V4_RECIPE_ADAPTER,
  type Float32MaskTile,
  type Float32PremultipliedRgbaTile,
} from '@/core/imageEdit/v3/effects'
import { mixCustomEffectMaskV3 } from '@/core/imageEdit/v3/execution'
import type { ImageEditRenderPlanNode } from '@/core/imageEdit/v3/renderPlan'
import type { ImageEditRenderQuality } from '@/core/imageEdit/v3/renderNodeDefinition'
import type { ImageEditColorModeV3 } from '@/core/imageEdit/v3/colorTypes'
import { WorkerWebGpuRuntimeBackend } from '@/core/imageEdit/worker/webgpuRuntimeBackend'
import {
  linearPreviewTileToBitmapV3,
  previewBitmapToLinearTileV3,
} from './previewPixelsV3'
import {
  convertPreviewWorkingSpaceToSrgbDisplayV3,
  convertSrgbProxyToPreviewWorkingSpaceV3,
} from './previewColorV3'

export class ImageEditorPreviewUnsupportedEffectErrorV3 extends Error {
  constructor(readonly definitionId: string, detail?: string) {
    super(detail ?? `当前设备无法预览效果：${definitionId}`)
    this.name = 'ImageEditorPreviewUnsupportedEffectErrorV3'
  }
}

export class ImageEditorPreviewCustomEffectsV3 {
  private readonly backend = new WorkerWebGpuRuntimeBackend()

  async execute(
    node: ImageEditRenderPlanNode,
    source: Float32PremultipliedRgbaTile,
    quality: ImageEditRenderQuality,
    color: ImageEditColorModeV3,
    mask?: Float32MaskTile,
  ): Promise<Float32PremultipliedRgbaTile> {
    if (node.definitionId !== 'effect.diffusion' && node.definitionId !== 'effect.vgpu-glow') {
      throw new ImageEditorPreviewUnsupportedEffectErrorV3(node.definitionId)
    }
    if (
      color.hdrMetadata
      || color.transferFunction === 'pq'
      || color.transferFunction === 'hlg'
    ) {
      throw new ImageEditorPreviewUnsupportedEffectErrorV3(
        node.definitionId,
        `${node.definitionId} 的 HDR Worker 执行链尚未提供无损浮点互操作，已保留上一预览帧`,
      )
    }
    const sourceBitmap = await linearPreviewTileToBitmapV3(
      convertPreviewWorkingSpaceToSrgbDisplayV3(source, { ...color, hdrMetadata: null, transferFunction: 'srgb' }),
    )
    let rendered: ImageBitmap | null = null
    try {
      const state = await this.backend.ensureState()
      if (node.definitionId === 'effect.diffusion') {
        const parameters = DIFFUSION_V4_RECIPE_ADAPTER.parseParameters(node.parameters)
        const recipe = DIFFUSION_V4_RECIPE_ADAPTER.compileRecipe(parameters, {
          width: source.width,
          height: source.height,
          quality: quality === 'draft' ? 'realtime' : 'high',
        })
        rendered = await this.backend.renderDiffusionBitmap(
          state,
          sourceBitmap,
          source.width,
          source.height,
          recipe,
          node.subtreeHash,
        )
      } else {
        const parameters = VGPU_GLOW_V4_RECIPE_ADAPTER.parseParameters(node.parameters)
        const recipe = VGPU_GLOW_V4_RECIPE_ADAPTER.compileRecipe(parameters, {
          width: source.width,
          height: source.height,
        })
        rendered = await this.backend.renderVgpuGlowBitmap(
          state,
          sourceBitmap,
          source.width,
          source.height,
          recipe,
        )
      }
      const processed = convertSrgbProxyToPreviewWorkingSpaceV3(
        await previewBitmapToLinearTileV3(rendered),
        color,
      )
      return mixCustomEffectMaskV3(source, processed, mask)
    } catch (error) {
      if (error instanceof ImageEditorPreviewUnsupportedEffectErrorV3) throw error
      const detail = error instanceof Error ? error.message : String(error)
      throw new ImageEditorPreviewUnsupportedEffectErrorV3(
        node.definitionId,
        `${node.definitionId} 无法在当前 Worker/GPU 环境执行：${detail}`,
      )
    } finally {
      rendered?.close()
      sourceBitmap.close()
    }
  }

  dispose(): void {
    this.backend.destroy()
  }
}
