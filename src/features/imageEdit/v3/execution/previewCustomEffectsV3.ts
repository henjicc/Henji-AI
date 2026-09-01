import {
  DIFFUSION_V4_RECIPE_ADAPTER,
  VGPU_GLOW_V4_RECIPE_ADAPTER,
  applyDiffusionV4,
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
  private backend = new WorkerWebGpuRuntimeBackend()

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
    const diffusionRecipe = node.definitionId === 'effect.diffusion'
      ? DIFFUSION_V4_RECIPE_ADAPTER.compileRecipe(
          DIFFUSION_V4_RECIPE_ADAPTER.parseParameters(node.parameters),
          {
            width: source.width,
            height: source.height,
            quality: quality === 'draft' ? 'realtime' : 'high',
          },
        )
      : null
    if (diffusionRecipe && (typeof navigator === 'undefined' || !('gpu' in navigator))) {
      return applyDiffusionV4(source, diffusionRecipe, { mask })
    }
    const sourceBitmap = await linearPreviewTileToBitmapV3(
      convertPreviewWorkingSpaceToSrgbDisplayV3(source, { ...color, hdrMetadata: null, transferFunction: 'srgb' }),
    )
    let rendered: ImageBitmap | null = null
    try {
      const state = await this.backend.ensureState()
      if (node.definitionId === 'effect.diffusion') {
        if (!diffusionRecipe) throw new Error('柔光效果缺少已编译 recipe')
        rendered = await this.backend.renderDiffusionBitmap(
          state,
          sourceBitmap,
          source.width,
          source.height,
          diffusionRecipe,
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
      if (node.definitionId === 'effect.vgpu-glow'
        && !isPlausibleVgpuGlowPreviewV3(source, processed)) {
        this.backend.destroy()
        this.backend = new WorkerWebGpuRuntimeBackend()
        throw new ImageEditorPreviewUnsupportedEffectErrorV3(
          node.definitionId,
          '辉光 Pro 返回了无效暗帧，已保留上一预览并重置 GPU 工作集',
        )
      }
      return mixCustomEffectMaskV3(source, processed, mask)
    } catch (error) {
      if (diffusionRecipe) return applyDiffusionV4(source, diffusionRecipe, { mask })
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

/** 辉光合成必须保留原始 scene；非黑源变成近零或出现非有限值一定是 GPU 暗帧。 */
export function isPlausibleVgpuGlowPreviewV3(
  source: Float32PremultipliedRgbaTile,
  processed: Float32PremultipliedRgbaTile,
): boolean {
  if (source.width !== processed.width || source.height !== processed.height) return false
  const pixelCount = source.width * source.height
  const stride = Math.max(1, Math.floor(pixelCount / 4_096))
  let sourceSignal = 0
  let processedSignal = 0
  for (let pixel = 0; pixel < pixelCount; pixel += stride) {
    const offset = pixel * 4
    const sourceSample = Math.max(
      source.data[offset],
      source.data[offset + 1],
      source.data[offset + 2],
    )
    const processedSample = Math.max(
      processed.data[offset],
      processed.data[offset + 1],
      processed.data[offset + 2],
    )
    if (!Number.isFinite(processedSample) || !Number.isFinite(processed.data[offset + 3])) {
      return false
    }
    sourceSignal = Math.max(sourceSignal, sourceSample)
    processedSignal = Math.max(processedSignal, processedSample)
  }
  return sourceSignal <= 1e-5 || processedSignal >= sourceSignal * 0.05
}
