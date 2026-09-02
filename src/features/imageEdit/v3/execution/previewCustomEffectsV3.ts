import {
  DIFFUSION_V4_RECIPE_ADAPTER,
  VGPU_GLOW_V4_RECIPE_ADAPTER,
  applyDiffusionV4,
  applyFastBlurV3,
  applyVgpuGlowV4,
  type Float32MaskTile,
  type Float32PremultipliedRgbaTile,
} from '@/core/imageEdit/v3/effects'
import { compileFastBlurRecipe } from '@/core/imageEdit/fastBlurRecipe'
import {
  convertFloat32TileColorDomainV3,
  mixCustomEffectMaskV3,
} from '@/core/imageEdit/v3/execution'
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

export interface ImageEditorPreviewRuntimeStateV3 {
  status: 'device-lost' | 'gpu-ready' | 'cpu-fallback'
  reason: string | null
  deviceGeneration: number | null
}

export interface ImageEditorPreviewCustomEffectsOptionsV3 {
  onRuntimeState?(state: ImageEditorPreviewRuntimeStateV3): void
}

export class ImageEditorPreviewCustomEffectsV3 {
  private backend: WorkerWebGpuRuntimeBackend
  private runtimeState: ImageEditorPreviewRuntimeStateV3 | null = null

  constructor(private readonly options: ImageEditorPreviewCustomEffectsOptionsV3 = {}) {
    this.backend = this.createBackend()
  }

  async execute(
    node: ImageEditRenderPlanNode,
    source: Float32PremultipliedRgbaTile,
    quality: ImageEditRenderQuality,
    color: ImageEditColorModeV3,
    mask?: Float32MaskTile,
    observeFastBlur?: (backend: 'vgpu' | 'cpu', fallbackReason?: string) => void,
  ): Promise<Float32PremultipliedRgbaTile> {
    if (!['effect.fast-blur', 'effect.diffusion', 'effect.vgpu-glow'].includes(node.definitionId)) {
      throw new ImageEditorPreviewUnsupportedEffectErrorV3(node.definitionId)
    }
    const fastBlurRadius = numberParameter(node, 'radius', 0)
      / (2 ** numberParameter(node, 'mip', 0))
    if (node.definitionId === 'effect.fast-blur' && fastBlurRadius <= 0) {
      observeFastBlur?.('cpu', 'radius-zero-bypass')
      return source
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
    const glowRecipe = node.definitionId === 'effect.vgpu-glow'
      ? VGPU_GLOW_V4_RECIPE_ADAPTER.compileRecipe(
          VGPU_GLOW_V4_RECIPE_ADAPTER.parseParameters(node.parameters),
          { width: source.width, height: source.height },
        )
      : null
    if (
      color.hdrMetadata
      || color.transferFunction === 'pq'
      || color.transferFunction === 'hlg'
    ) {
      this.publishCpuFallback('hdr-linear-reference')
      if (node.definitionId === 'effect.fast-blur') {
        observeFastBlur?.('cpu', 'hdr-float-interoperability')
        return applyFastBlurV3(
          convertFloat32TileColorDomainV3(source, 'linear-light'),
          { radius: fastBlurRadius, mip: 0 },
          { mask },
        )
      }
      if (diffusionRecipe) return applyDiffusionV4(source, diffusionRecipe, { mask })
      if (glowRecipe) return applyVgpuGlowV4(
        convertFloat32TileColorDomainV3(source, 'linear-light'), glowRecipe, { mask },
      )
    }
    if (node.definitionId === 'effect.fast-blur'
      && (typeof navigator === 'undefined' || !('gpu' in navigator))) {
      this.publishCpuFallback('webgpu-unavailable')
      observeFastBlur?.('cpu', 'webgpu-unavailable')
      return applyFastBlurV3(
        convertFloat32TileColorDomainV3(source, 'linear-light'),
        { radius: fastBlurRadius, mip: 0 },
        { mask },
      )
    }
    if (diffusionRecipe && (typeof navigator === 'undefined' || !('gpu' in navigator))) {
      this.publishCpuFallback('webgpu-unavailable')
      return applyDiffusionV4(source, diffusionRecipe, { mask })
    }
    if (glowRecipe && (typeof navigator === 'undefined' || !('gpu' in navigator))) {
      this.publishCpuFallback('webgpu-unavailable')
      return applyVgpuGlowV4(
        convertFloat32TileColorDomainV3(source, 'linear-light'), glowRecipe, { mask },
      )
    }
    const sourceBitmap = await linearPreviewTileToBitmapV3(
      convertPreviewWorkingSpaceToSrgbDisplayV3(source, { ...color, hdrMetadata: null, transferFunction: 'srgb' }),
    )
    let rendered: ImageBitmap | null = null
    try {
      const state = await this.backend.ensureState()
      this.publishRuntime({
        status: 'gpu-ready',
        reason: null,
        deviceGeneration: state.generation,
      })
      if (node.definitionId === 'effect.fast-blur') {
        rendered = await this.backend.renderVgpuFastBlurBitmap(
          state,
          sourceBitmap,
          source.width,
          source.height,
          compileFastBlurRecipe(fastBlurRadius, source.width, source.height),
        )
      } else if (node.definitionId === 'effect.diffusion') {
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
        if (!glowRecipe) throw new Error('辉光 Pro 缺少已编译 recipe')
        rendered = await this.backend.renderVgpuGlowBitmap(
          state,
          sourceBitmap,
          source.width,
          source.height,
          glowRecipe,
        )
      }
      const processed = convertSrgbProxyToPreviewWorkingSpaceV3(
        await previewBitmapToLinearTileV3(rendered),
        color,
      )
      if (node.definitionId === 'effect.vgpu-glow'
        && !isPlausibleVgpuGlowPreviewV3(source, processed)) {
        this.resetBackend()
        throw new ImageEditorPreviewUnsupportedEffectErrorV3(
          node.definitionId,
          '辉光 Pro 返回了无效暗帧，已保留上一预览并重置 GPU 工作集',
        )
      }
      if (node.definitionId === 'effect.fast-blur'
        && !isPlausibleVgpuFastBlurPreviewV3(source, processed)) {
        this.resetBackend()
        throw new Error('模糊返回了无效暗帧，已重置 GPU 工作集')
      }
      if (node.definitionId === 'effect.fast-blur') observeFastBlur?.('vgpu')
      return mixCustomEffectMaskV3(source, processed, mask)
    } catch (error) {
      this.publishCpuFallback(error instanceof Error ? error.message : String(error))
      if (node.definitionId === 'effect.fast-blur') {
        observeFastBlur?.(
          'cpu',
          `vgpu-error:${error instanceof Error ? error.message : String(error)}`,
        )
        return applyFastBlurV3(
          convertFloat32TileColorDomainV3(source, 'linear-light'),
          { radius: fastBlurRadius, mip: 0 },
          { mask },
        )
      }
      if (diffusionRecipe) return applyDiffusionV4(source, diffusionRecipe, { mask })
      if (glowRecipe) return applyVgpuGlowV4(
        convertFloat32TileColorDomainV3(source, 'linear-light'), glowRecipe, { mask },
      )
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

  private publishCpuFallback(reason: string): void {
    this.publishRuntime({ status: 'cpu-fallback', reason, deviceGeneration: null })
  }

  private publishRuntime(state: ImageEditorPreviewRuntimeStateV3): void {
    if (this.runtimeState?.status === state.status
      && this.runtimeState.deviceGeneration === state.deviceGeneration
      && this.runtimeState.reason === state.reason) return
    this.runtimeState = state
    this.options.onRuntimeState?.(state)
  }

  private createBackend(): WorkerWebGpuRuntimeBackend {
    const backend = new WorkerWebGpuRuntimeBackend()
    backend.onDeviceLost((reason) => this.publishRuntime({
      status: 'device-lost',
      reason,
      deviceGeneration: null,
    }))
    return backend
  }

  private resetBackend(): void {
    this.backend.destroy()
    this.backend = this.createBackend()
  }
}

function numberParameter(
  node: ImageEditRenderPlanNode,
  key: string,
  fallback: number,
): number {
  const value = node.parameters[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
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

/** 模糊会保留覆盖率与整体信号；非空源变成透明或纯黑暗帧一定是失效的 GPU 结果。 */
export function isPlausibleVgpuFastBlurPreviewV3(
  source: Float32PremultipliedRgbaTile,
  processed: Float32PremultipliedRgbaTile,
): boolean {
  if (source.width !== processed.width || source.height !== processed.height) return false
  const pixelCount = source.width * source.height
  const stride = Math.max(1, Math.floor(pixelCount / 4_096))
  let sourceAlpha = 0
  let processedAlpha = 0
  let sourceSignal = 0
  let processedSignal = 0
  for (let pixel = 0; pixel < pixelCount; pixel += stride) {
    const alphaOffset = pixel * 4 + 3
    const processedSample = processed.data[alphaOffset]
    if (!Number.isFinite(processedSample)
      || !Number.isFinite(processed.data[alphaOffset - 1])
      || !Number.isFinite(processed.data[alphaOffset - 2])
      || !Number.isFinite(processed.data[alphaOffset - 3])) {
      return false
    }
    sourceAlpha = Math.max(sourceAlpha, source.data[alphaOffset])
    processedAlpha = Math.max(processedAlpha, processedSample)
    sourceSignal = Math.max(
      sourceSignal,
      source.data[alphaOffset - 1],
      source.data[alphaOffset - 2],
      source.data[alphaOffset - 3],
    )
    processedSignal = Math.max(
      processedSignal,
      processed.data[alphaOffset - 1],
      processed.data[alphaOffset - 2],
      processed.data[alphaOffset - 3],
    )
  }
  const preservesCoverage = sourceAlpha <= 1e-5 || processedAlpha >= sourceAlpha * 0.05
  const preservesSignal = sourceSignal <= 1e-5 || processedSignal >= sourceSignal * 0.001
  return preservesCoverage && preservesSignal
}
