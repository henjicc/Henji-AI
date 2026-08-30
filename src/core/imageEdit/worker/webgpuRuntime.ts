import type { DiffusionRecipe } from '../diffusionRecipe'
import {
  rebaseVgpuGlowRecipeForScale,
  type VgpuGlowRecipe,
} from '../vgpuGlowRecipe'
import type { DiffusionScatterPyramid } from '../webgpu/diffusionRenderer'
import {
  canRenderVgpuGlowInSinglePass,
  rebaseDiffusionRecipeForScale,
  rebaseDiffusionRecipeForTile,
  renderDiffusionExport,
} from '../webgpu/exportRenderer'
import {
  createImageEditExportPlan,
  fitWithinPixelBudget,
  IMAGE_EDIT_PREVIEW_MAX_PIXELS,
} from './exportPrototype'
import type { VgpuGlowGlobalScatter } from '../webgpu/vgpuGlowRenderer'
import type {
  ImageEditExportFormat,
  ImageEditWorkerComposition,
  ImageEditWorkerCapabilities,
  ImageEditWorkerSource,
} from './protocol'
import { drawMarkItems } from '@/features/imageMark/render/drawMarks'
import { createImageEditCanvas } from '@/features/imageMark/render/canvasAdapter'
import { renderOrientedImage } from '@/features/imageMark/render/orientedImage'
import { clampCropRect } from '@/features/imageMark/domain/geometry'
import { decodeSource } from './webgpuRuntimeSupport'
import {
  WorkerWebGpuRuntimeBackend,
  type WorkerWebGpuState,
} from './webgpuRuntimeBackend'

export interface WebGpuExportOptions {
  format: ImageEditExportFormat
  quality?: number
  tileSize?: number
  halo?: number
  globalScatterMaxDimension?: number
  recipe?: DiffusionRecipe
  vgpuGlowRecipe?: VgpuGlowRecipe
  composition?: ImageEditWorkerComposition
  isCancelled: () => boolean
  onProgress: (completedTiles: number, totalTiles: number) => void
}

export class WorkerWebGpuRuntime {
  private readonly backend = new WorkerWebGpuRuntimeBackend()
  private cachedUrlSource: { url: string; bitmap: ImageBitmap } | null = null

  onDeviceLost(handler: (reason: string) => void): void {
    this.backend.onDeviceLost(handler)
  }

  async initialize(): Promise<ImageEditWorkerCapabilities> {
    return await this.backend.initialize()
  }

  async renderPreview(
    source: ImageEditWorkerSource,
    maxPixels = IMAGE_EDIT_PREVIEW_MAX_PIXELS,
    recipe?: DiffusionRecipe,
    vgpuGlowRecipe?: VgpuGlowRecipe,
    composition?: ImageEditWorkerComposition,
    cacheKey?: string,
    isCancelled?: () => boolean
  ): Promise<{ bitmap: ImageBitmap; width: number; height: number }> {
    const state = await this.backend.ensureState()
    if (!vgpuGlowRecipe) this.backend.trimVgpuGlowWorkingSet(state)
    const decoded = await this.acquireSource(source)
    try {
      // 预览的所有 GPU 输入都必须先落在预算内。仅缩小最终 Canvas 会让超大原图仍被
      // 上传为一张全尺寸 source texture，既拖慢调参，也会不必要地占用显存。
      const previewSource = await createPreviewBitmap(decoded.bitmap, maxPixels)
      try {
        const composed = this.applyOrientation(previewSource.bitmap, composition)
        try {
        const sourceCacheKey = `${cacheKey ?? (source.kind === 'url' ? `url:${source.url}` : `blob:${Date.now()}`)}:${orientationCacheKey(composition)}`
        if (vgpuGlowRecipe) {
          const previewRecipe = rebaseVgpuGlowRecipeForScale(
            vgpuGlowRecipe,
            composed.bitmap.width,
            composed.bitmap.height
          )
          const bitmap = await this.backend.renderVgpuGlowBitmap(
            state,
            composed.bitmap,
            composed.bitmap.width,
            composed.bitmap.height,
            previewRecipe,
            isCancelled
          )
          return {
            bitmap,
            width: composed.bitmap.width,
            height: composed.bitmap.height,
          }
        }
        if (recipe) {
          const bitmap = await this.backend.renderDiffusionBitmap(
            state,
            composed.bitmap,
            composed.bitmap.width,
            composed.bitmap.height,
            recipe,
            sourceCacheKey,
            isCancelled
          )
          return {
            bitmap,
            width: composed.bitmap.width,
            height: composed.bitmap.height,
          }
        }
        const bitmap = await this.backend.renderBaselineBitmap(
          state,
          composed.bitmap,
          composed.bitmap.width,
          composed.bitmap.height
        )
        return {
          bitmap,
          width: composed.bitmap.width,
          height: composed.bitmap.height,
        }
        } finally {
          if (composed.owned) composed.bitmap.close()
        }
      } finally {
        if (previewSource.owned) previewSource.bitmap.close()
      }
    } finally {
      if (decoded.owned) decoded.bitmap.close()
    }
  }

  async exportImage(
    source: ImageEditWorkerSource,
    options: WebGpuExportOptions
  ): Promise<{ bytes: Uint8Array; width: number; height: number }> {
    const state = await this.backend.ensureState()
    if (!options.vgpuGlowRecipe) this.backend.trimVgpuGlowWorkingSet(state)
    const decoded = await this.acquireSource(source)
    try {
      const composed = this.applyOrientation(decoded.bitmap, options.composition)
      try {
        if (options.vgpuGlowRecipe) {
          return await this.exportVgpuGlow(
            state,
            composed.bitmap,
            options,
            options.vgpuGlowRecipe
          )
        }
        const recipe = options.recipe
        if (!recipe) throw new Error('柔光导出请求缺少共享执行配方')
        const exportSourceKey = source.kind === 'url'
          ? `url:${source.url}`
          : `blob-export:${Date.now()}`
        let globalScatter: DiffusionScatterPyramid | null = null
        return await renderDiffusionExport({
        width: composed.bitmap.width,
        height: composed.bitmap.height,
        recipe,
        format: options.format,
        quality: options.quality,
        tileSize: options.tileSize,
        halo: options.halo,
        globalScatterMaxDimension: options.globalScatterMaxDimension,
        maxTextureDimension: this.backend.getMaxTextureDimension(state),
        isCancelled: options.isCancelled,
        onProgress: options.onProgress,
        renderGlobal: async (width, height) => {
          const resized = await createImageBitmap(composed.bitmap, {
            resizeWidth: width,
            resizeHeight: height,
            resizeQuality: 'high',
          })
          try {
            return await this.backend.renderDiffusionBitmap(
              state,
              resized,
              width,
              height,
              recipe,
              `${exportSourceKey}:${orientationCacheKey(options.composition)}:global:${width}x${height}`,
              options.isCancelled
            )
          } finally {
            resized.close()
          }
        },
        buildGlobalScatter: async (width, height) => {
          const resized = await createImageBitmap(composed.bitmap, {
            resizeWidth: width,
            resizeHeight: height,
            resizeQuality: 'high',
          })
          try {
            // 散射尺度按比例定义，所以在降采样后的整图上重新编译一遍配方，
            // 得到的是同一组归一化尺度。
            const pyramid = await this.backend.buildDiffusionScatterPyramid(
              state,
              resized,
              width,
              height,
              rebaseDiffusionRecipeForScale(recipe, width, height),
              options.isCancelled
            )
            globalScatter = pyramid
            return { release: () => { globalScatter = null; pyramid.release() } }
          } finally {
            resized.close()
          }
        },
        renderTile: async (tile) => {
          const tileBitmap = await createImageBitmap(
            composed.bitmap,
            tile.expandedX,
            tile.expandedY,
            tile.expandedWidth,
            tile.expandedHeight
          )
          try {
            return await this.backend.renderDiffusionBitmap(
              state,
              tileBitmap,
              tile.expandedWidth,
              tile.expandedHeight,
              rebaseDiffusionRecipeForTile(
                recipe,
                tile.expandedWidth,
                tile.expandedHeight
              ),
              `${exportSourceKey}:${orientationCacheKey(options.composition)}:tile:${tile.index}`,
              options.isCancelled,
              globalScatter
                ? { pyramid: globalScatter, region: tile.scatterRegion }
                : undefined
            )
          } finally {
            tileBitmap.close()
          }
        },
        postProcess: async (canvas) => this.applyAnnotationsAndCrop(canvas, options.composition),
        })
      } finally {
        if (composed.owned) composed.bitmap.close()
      }
    } finally {
      if (decoded.owned) decoded.bitmap.close()
    }
  }

  private applyOrientation(
    bitmap: ImageBitmap,
    composition: ImageEditWorkerComposition | undefined
  ): { bitmap: ImageBitmap; owned: boolean } {
    const orientation = composition?.orientation
    if (!orientation || (orientation.rotate === 0 && !orientation.mirrored)) {
      return { bitmap, owned: false }
    }
    const canvas = renderOrientedImage(bitmap, orientation, 'offscreen') as OffscreenCanvas
    return { bitmap: canvas.transferToImageBitmap(), owned: true }
  }

  private async applyAnnotationsAndCrop(
    canvas: OffscreenCanvas,
    composition: ImageEditWorkerComposition | undefined
  ): Promise<OffscreenCanvas> {
    if (composition?.annotations?.items.length) {
      const context = canvas.getContext('2d')
      if (!context) throw new Error('OffscreenCanvas 2D context 不可用')
      drawMarkItems(context, composition.annotations.items, canvas.width, canvas.height, {
        baseCanvas: canvas,
        canvasKind: 'offscreen',
      })
    }
    if (!composition?.crop?.rect) return canvas
    const crop = clampCropRect(composition.crop.rect, canvas.width, canvas.height)
    const { canvas: cropped, context } = createImageEditCanvas(crop.width, crop.height, 'offscreen')
    context.drawImage(canvas, crop.x, crop.y, crop.width, crop.height, 0, 0, cropped.width, cropped.height)
    return cropped as OffscreenCanvas
  }

  destroy(): void {
    this.backend.destroy()
    this.cachedUrlSource?.bitmap.close()
    this.cachedUrlSource = null
  }

  private async acquireSource(
    source: ImageEditWorkerSource
  ): Promise<{ bitmap: ImageBitmap; owned: boolean }> {
    if (source.kind === 'blob') {
      return { bitmap: await decodeSource(source), owned: true }
    }
    if (this.cachedUrlSource?.url === source.url) {
      return { bitmap: this.cachedUrlSource.bitmap, owned: false }
    }
    const bitmap = await decodeSource(source)
    this.cachedUrlSource?.bitmap.close()
    this.cachedUrlSource = { url: source.url, bitmap }
    return { bitmap, owned: false }
  }

  private async exportVgpuGlow(
    state: WorkerWebGpuState,
    bitmap: ImageBitmap,
    options: WebGpuExportOptions,
    recipe: VgpuGlowRecipe
  ): Promise<{ bytes: Uint8Array; width: number; height: number }> {
    const width = bitmap.width
    const height = bitmap.height
    const plan = createImageEditExportPlan(width, height, {
      tileSize: options.tileSize,
      halo: options.halo,
      globalScatterMaxDimension: options.globalScatterMaxDimension,
    })
    const canvas = new OffscreenCanvas(width, height)
    const context = canvas.getContext('2d')
    if (!context) throw new Error('OffscreenCanvas 2D context 不可用')
    try {
      const textureLimit = this.backend.getMaxTextureDimension(state)
      const singlePass = canRenderVgpuGlowInSinglePass(width, height, textureLimit)
      if (singlePass) {
        const rendered = await this.backend.renderVgpuGlowBitmap(
          state,
          bitmap,
          width,
          height,
          recipe,
          options.isCancelled
        )
        try {
          context.drawImage(rendered, 0, 0)
        } finally {
          rendered.close()
        }
        options.onProgress(plan.totalTiles, plan.totalTiles)
      } else {
        const globalBitmap = await createImageBitmap(bitmap, {
          resizeWidth: plan.globalScatterWidth,
          resizeHeight: plan.globalScatterHeight,
          resizeQuality: 'high',
        })
        let globalScatter: VgpuGlowGlobalScatter | null = null
        try {
          globalScatter = await this.backend.buildVgpuGlowGlobalScatter(
            state,
            globalBitmap,
            plan.globalScatterWidth,
            plan.globalScatterHeight,
            rebaseVgpuGlowRecipeForScale(
              recipe,
              plan.globalScatterWidth,
              plan.globalScatterHeight
            ),
            options.isCancelled
          )
          for (const tile of plan.tiles) {
            assertNotCancelled(options.isCancelled)
            const tileBitmap = await createImageBitmap(
              bitmap,
              tile.expandedX,
              tile.expandedY,
              tile.expandedWidth,
              tile.expandedHeight
            )
            try {
              const rendered = await this.backend.renderVgpuGlowBitmap(
                state,
                tileBitmap,
                tile.expandedWidth,
                tile.expandedHeight,
                recipe,
                options.isCancelled,
                {
                  global: globalScatter,
                  region: [
                    tile.expandedX / width,
                    tile.expandedY / height,
                    tile.expandedWidth / width,
                    tile.expandedHeight / height,
                  ],
                }
              )
              try {
                context.drawImage(
                  rendered,
                  tile.cropX,
                  tile.cropY,
                  tile.width,
                  tile.height,
                  tile.x,
                  tile.y,
                  tile.width,
                  tile.height
                )
              } finally {
                rendered.close()
              }
            } finally {
              tileBitmap.close()
            }
            options.onProgress(tile.index + 1, plan.totalTiles)
          }
        } finally {
          try {
            globalScatter?.release()
          } finally {
            globalBitmap.close()
          }
        }
      }
    } finally {
      this.backend.trimVgpuGlowWorkingSet(state)
    }
    assertNotCancelled(options.isCancelled)
    const finalOutput = await this.applyAnnotationsAndCrop(canvas, options.composition)
    assertNotCancelled(options.isCancelled)
    const blob = await finalOutput.convertToBlob({
      type: options.format,
      quality: options.quality,
    })
    assertNotCancelled(options.isCancelled)
    const bytes = new Uint8Array(await blob.arrayBuffer())
    assertNotCancelled(options.isCancelled)
    return {
      bytes,
      width: finalOutput.width,
      height: finalOutput.height,
    }
  }
}

function orientationCacheKey(composition: ImageEditWorkerComposition | undefined): string {
  const orientation = composition?.orientation
  return orientation ? `${orientation.rotate}:${orientation.mirrored ? 'm' : 'n'}` : '0:n'
}

function assertNotCancelled(isCancelled: () => boolean): void {
  if (isCancelled()) throw new DOMException('图片编辑任务已取消', 'AbortError')
}

async function createPreviewBitmap(
  bitmap: ImageBitmap,
  maxPixels: number
): Promise<{ bitmap: ImageBitmap; owned: boolean }> {
  const size = fitWithinPixelBudget(bitmap.width, bitmap.height, maxPixels)
  if (size.width === bitmap.width && size.height === bitmap.height) {
    return { bitmap, owned: false }
  }
  return {
    bitmap: await createImageBitmap(bitmap, {
      resizeWidth: size.width,
      resizeHeight: size.height,
      resizeQuality: 'high',
    }),
    owned: true,
  }
}
