import diffusionShaderSource from '../shaders/diffusion.wgsl?raw';
import type { DiffusionRecipe } from '../diffusionRecipe';
import {
  createRenderPipelineChecked,
  createShaderModuleChecked,
} from './deviceManager';
import { renderScatterPyramid } from './scatterPyramidRenderer';
import { ImageEditTexturePool } from './texturePool';
import {
  createUniformBuffer,
  renderPipelinePass,
  type GpuDevice,
  type GpuRenderPipeline,
  type GpuTexture,
} from '../worker/webgpuRuntimeSupport';

const TEXTURE_BINDING = 0x04;
const TEXTURE_RENDER_ATTACHMENT = 0x10;
const DIFFUSION_TEXTURE_USAGE = TEXTURE_BINDING | TEXTURE_RENDER_ATTACHMENT;
interface DiffusionPipelines {
  source: GpuRenderPipeline;
  scatterDownsample: GpuRenderPipeline;
  scatterUpsample: GpuRenderPipeline;
  composite: GpuRenderPipeline;
}

interface DiffusionCache {
  sourceKey: string;
  width: number;
  height: number;
  sourceSignature: string;
  pyramidSignature: string;
  base: GpuTexture;
  source: GpuTexture;
  scales: GpuTexture[];
  pyramidTextures: GpuTexture[];
}

/**
 * 一张可跨块复用的散射金字塔。
 *
 * 分块导出必须让所有块共用同一张散射：块只看得见自己那点内容加 halo，用块内数据
 * 各算各的宽尺度散射，块边界一定对不上（导出图上那圈沿 Tile 网格的矩形亮度台阶）。
 * 散射本身是低频的，按整图降采样后算一次就够，块只负责补全分辨率的底图。
 */
export interface DiffusionScatterPyramid {
  scales: GpuTexture[];
  release: () => void;
}

export interface DiffusionRenderInput {
  sourceKey: string;
  width: number;
  height: number;
  recipe: DiffusionRecipe;
  createLinearBase: () => Promise<GpuTexture>;
  isCancelled?: () => boolean;
  /**
   * 外部提供的全局散射。给了它就不再为本次渲染建金字塔，改为按 `region` 取其中一片。
   * `region` 是本块在整图里的归一化区域 [offsetX, offsetY, scaleX, scaleY]。
   */
  scatter?: {
    pyramid: DiffusionScatterPyramid;
    region: readonly [number, number, number, number];
  };
}

export interface DiffusionRenderOutput {
  texture: GpuTexture;
  release: () => void;
  invalidation: DiffusionInvalidation;
}

export type DiffusionInvalidation = 'source' | 'pyramid' | 'composite' | 'none';

export class WebGpuDiffusionRenderer {
  private cache: DiffusionCache | null = null;

  private constructor(
    private readonly device: GpuDevice,
    private readonly sampler: unknown,
    private readonly pipelines: DiffusionPipelines,
    private readonly texturePool: ImageEditTexturePool
  ) {}

  static async create(
    device: GpuDevice,
    sampler: unknown,
    textureBudgetBytes?: number
  ): Promise<WebGpuDiffusionRenderer> {
    const module = await createShaderModuleChecked(
      device,
      diffusionShaderSource,
      '柔光着色器'
    );
    const shared = {
      layout: 'auto',
      vertex: { module, entryPoint: 'vertex_main' },
      primitive: { topology: 'triangle-list' },
    };
    const create = async (entryPoint: string, label: string): Promise<GpuRenderPipeline> =>
      await createRenderPipelineChecked(device, {
        ...shared,
        fragment: {
          module,
          entryPoint,
          targets: [{ format: 'rgba16float' }],
        },
      }, label);
    const [
      source,
      scatterDownsample,
      scatterUpsample,
      composite,
    ] = await Promise.all([
      create('fragment_source', '柔光源图 Pipeline'),
      create('fragment_scatter_downsample', '柔光散射降采样 Pipeline'),
      create('fragment_scatter_upsample', '柔光散射上采样 Pipeline'),
      create('fragment_composite', '柔光合成 Pipeline'),
    ]);
    return new WebGpuDiffusionRenderer(
      device,
      sampler,
      {
        source,
        scatterDownsample,
        scatterUpsample,
        composite,
      },
      new ImageEditTexturePool(device, textureBudgetBytes)
    );
  }

  /**
   * 只建散射金字塔，不做合成。分块导出先按整图降采样算一次，所有块共用。
   *
   * 刻意不写进 `this.cache`：那份缓存服务于常规整图渲染，按 sourceKey 失效，
   * 而全局散射的生命周期由调用方按整轮导出来管。
   */
  async buildScatterPyramid(input: {
    width: number;
    height: number;
    recipe: DiffusionRecipe;
    createLinearBase: () => Promise<GpuTexture>;
    isCancelled?: () => boolean;
  }): Promise<DiffusionScatterPyramid> {
    assertNotCancelled(input.isCancelled);
    const base = await input.createLinearBase();
    const source = this.acquireTexture(input.width, input.height);
    const uniform = createUniformBuffer(this.device, createSourceUniform(input.recipe));
    try {
      renderPipelinePass(
        this.device,
        this.pipelines.source,
        [
          { binding: 0, resource: base.createView() },
          { binding: 1, resource: this.sampler },
          { binding: 2, resource: { buffer: uniform } },
        ],
        source
      );
      await this.device.queue.onSubmittedWorkDone();
      const built = await this.buildPyramidTextures(input, source);
      return {
        scales: built.scales,
        release: () => {
          for (const texture of built.textures) this.texturePool.release(texture);
          this.texturePool.release(source);
        },
      };
    } catch (error) {
      this.texturePool.release(source);
      throw error;
    } finally {
      base.destroy();
      uniform.destroy();
    }
  }

  async render(input: DiffusionRenderInput): Promise<DiffusionRenderOutput> {
    assertNotCancelled(input.isCancelled);
    const invalidation = determineDiffusionInvalidation(this.cache, input);
    if (invalidation === 'source') await this.rebuildSource(input);
    else if (invalidation === 'pyramid') await this.rebuildPyramid(input);
    const cache = this.cache;
    if (!cache) throw new Error('柔光渲染缓存未初始化');
    const scatterScales = input.scatter?.pyramid.scales ?? cache.scales;
    const output = this.acquireTexture(input.width, input.height);
    const uniform = createUniformBuffer(
      this.device,
      createCompositeUniform(input.recipe, input.scatter?.region)
    );
    try {
      assertNotCancelled(input.isCancelled);
      renderPipelinePass(
        this.device,
        this.pipelines.composite,
        [
          { binding: 0, resource: cache.base.createView() },
          { binding: 1, resource: this.sampler },
          { binding: 2, resource: scatterScales[0].createView() },
          { binding: 8, resource: { buffer: uniform } },
          // 未模糊的散射源，能量守恒的扣除项要用它
          { binding: 9, resource: cache.source.createView() },
        ],
        output
      );
      await this.device.queue.onSubmittedWorkDone();
      return {
        texture: output,
        release: () => this.texturePool.release(output),
        invalidation,
      };
    } catch (error) {
      this.texturePool.release(output);
      throw error;
    } finally {
      uniform.destroy();
    }
  }

  destroy(): void {
    this.disposeCache();
    this.texturePool.destroy();
  }

  private async rebuildSource(input: DiffusionRenderInput): Promise<void> {
    assertNotCancelled(input.isCancelled);
    this.disposeCache();
    const base = await input.createLinearBase();
    const source = this.acquireTexture(input.width, input.height);
    const uniform = createUniformBuffer(this.device, createSourceUniform(input.recipe));
    try {
      renderPipelinePass(
        this.device,
        this.pipelines.source,
        [
          { binding: 0, resource: base.createView() },
          { binding: 1, resource: this.sampler },
          { binding: 2, resource: { buffer: uniform } },
        ],
        source
      );
      await this.device.queue.onSubmittedWorkDone();
      assertNotCancelled(input.isCancelled);
      this.cache = {
        sourceKey: input.sourceKey,
        width: input.width,
        height: input.height,
        sourceSignature: createSourceSignature(input.recipe),
        pyramidSignature: '',
        base,
        source,
        scales: [],
        pyramidTextures: [],
      };
      await this.rebuildPyramid(input);
    } catch (error) {
      base.destroy();
      this.texturePool.release(source);
      this.cache = null;
      throw error;
    } finally {
      uniform.destroy();
    }
  }

  private async rebuildPyramid(input: DiffusionRenderInput): Promise<void> {
    const cache = this.cache;
    if (!cache) {
      await this.rebuildSource(input);
      return;
    }
    for (const texture of cache.pyramidTextures) this.texturePool.release(texture);
    cache.scales = [];
    cache.pyramidTextures = [];
    cache.pyramidSignature = createPyramidSignature(input.recipe);
    // 外部已经给了全局散射，本次渲染只需要本块的底图和散射源。
    if (input.scatter) return;
    const built = await this.buildPyramidTextures(input, cache.source);
    cache.scales = built.scales;
    cache.pyramidTextures = built.textures;
  }

  private async buildPyramidTextures(
    input: {
      width: number;
      height: number;
      recipe: DiffusionRecipe;
      isCancelled?: () => boolean;
    },
    source: GpuTexture
  ): Promise<{ scales: GpuTexture[]; textures: GpuTexture[] }> {
    // 三种模式共用同一条散射构建：mip 链的采样间距恒为输入纹理的 1 texel，
    // 半径由层级累积。柔光此前那条「归一化半径直接乘到稀疏五点核上」的可分离模糊
    // 在每一级都严重欠采样（导出分辨率下第 0 级采样点间隔 49.5 texel），
    // 产出的是五份错位副本而不是模糊，横竖各来一遍就是画面上的方格重影。
    const pyramid = await renderScatterPyramid({
      device: this.device,
      sampler: this.sampler,
      downsamplePipeline: this.pipelines.scatterDownsample,
      upsamplePipeline: this.pipelines.scatterUpsample,
      source,
      width: input.width,
      height: input.height,
      levels: input.recipe.scatterLevels,
      acquireTexture: (width, height) => this.acquireTexture(width, height),
      releaseTexture: (texture) => this.texturePool.release(texture),
      isCancelled: input.isCancelled,
    });
    return { scales: pyramid.scales, textures: pyramid.textures };
  }

  private acquireTexture(width: number, height: number): GpuTexture {
    return this.texturePool.acquire({
      width,
      height,
      format: 'rgba16float',
      usage: DIFFUSION_TEXTURE_USAGE,
    });
  }

  private disposeCache(): void {
    if (!this.cache) return;
    this.cache.base.destroy();
    this.texturePool.release(this.cache.source);
    for (const texture of this.cache.pyramidTextures) this.texturePool.release(texture);
    this.cache = null;
  }
}

export function determineDiffusionInvalidation(
  cache: Pick<DiffusionCache, 'sourceKey' | 'width' | 'height' | 'sourceSignature' | 'pyramidSignature'> | null,
  input: Pick<DiffusionRenderInput, 'sourceKey' | 'width' | 'height' | 'recipe'>
): DiffusionInvalidation {
  if (
    !cache
    || cache.sourceKey !== input.sourceKey
    || cache.width !== input.width
    || cache.height !== input.height
    || cache.sourceSignature !== createSourceSignature(input.recipe)
  ) return 'source';
  if (cache.pyramidSignature !== createPyramidSignature(input.recipe)) return 'pyramid';
  return 'composite';
}

function createSourceSignature(recipe: DiffusionRecipe): string {
  return JSON.stringify([recipe.mode, recipe.source]);
}

function createPyramidSignature(recipe: DiffusionRecipe): string {
  // 金字塔由 scatterLevels 驱动（层数随图片尺寸与模式变），scales 只是它前六级的投影，
  // 单看 scales 会漏掉层数与逐通道权重的变化，缓存就不会失效。
  return JSON.stringify([recipe.quality, recipe.scatterLevels]);
}

function createSourceUniform(recipe: DiffusionRecipe): Float32Array {
  return new Float32Array([
    1, 1, 0, 0,
    recipe.source.thresholdEV,
    recipe.source.softKneeEV,
    recipe.source.power,
    recipe.source.highlightGain,
    recipe.source.scatterFloor,
    recipe.source.highlightRecovery,
    modeToNumber(recipe.mode),
    0,
  ]);
}

function createCompositeUniform(
  recipe: DiffusionRecipe,
  scatterRegion?: readonly [number, number, number, number]
): Float32Array {
  const region = scatterRegion ?? [0, 0, 1, 1];
  return new Float32Array([
    1, 1, 0, 0,
    // 散射金字塔已经在上采样阶段完成逐尺度加权；合成只读 scatter_0。
    1, 0, 0, 0,
    0, 0, 0, 0,
    recipe.energy.scatterFraction,
    recipe.energy.veil,
    recipe.tone.shadowAbsorption,
    recipe.tone.highlightCompression,
    recipe.tone.scatterDesaturation,
    recipe.detail.highFrequencyRetention,
    recipe.detail.midFrequencyRetention,
    modeToNumber(recipe.mode),
    // tint_rgb 是 vec3，WGSL 里对齐到 16 字节；它前面正好凑满 80 字节，所以可以紧接着写。
    recipe.tint.rgb[0], recipe.tint.rgb[1], recipe.tint.rgb[2],
    recipe.tint.amount,
    recipe.tint.gain,
    recipe.glow.exposure,
    recipe.glow.shoulderKnee,
    recipe.glow.bleach,
    recipe.glow.coreWeight,
    recipe.glow.tintCoreWhite,
    // scatter_offset / scatter_scale：整图渲染是恒等变换，分块导出时指向本块在
    // 全局散射里的那片子区域。
    region[0], region[1],
    region[2], region[3],
    // scatter_tint 是 vec3，对齐到 16 字节；前面到这里是 136 字节，先补两个 f32 到 144。
    0, 0,
    recipe.tone.scatterTint[0], recipe.tone.scatterTint[1], recipe.tone.scatterTint[2],
    // 结构体尺寸也要补到 16 字节的整数倍：156 → 160。
    0,
  ]);
}

function modeToNumber(mode: DiffusionRecipe['mode']): number {
  if (mode === 'black_mist') return 0;
  if (mode === 'white_mist') return 1;
  return 2;
}

function assertNotCancelled(isCancelled?: () => boolean): void {
  if (isCancelled?.()) {
    throw new DOMException('图片编辑任务已取消', 'AbortError');
  }
}
