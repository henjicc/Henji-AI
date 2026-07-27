import diffusionShaderSource from '../shaders/diffusion.wgsl?raw';
import type { DiffusionRecipe } from '../diffusionRecipe';
import {
  createRenderPipelineChecked,
  createShaderModuleChecked,
} from './deviceManager';
import { ImageEditTexturePool } from './texturePool';
import {
  createUniformBuffer,
  renderPipelinePass,
  type GpuBuffer,
  type GpuDevice,
  type GpuRenderPipeline,
  type GpuTexture,
} from '../worker/webgpuRuntimeSupport';

const TEXTURE_BINDING = 0x04;
const TEXTURE_RENDER_ATTACHMENT = 0x10;
const DIFFUSION_TEXTURE_USAGE = TEXTURE_BINDING | TEXTURE_RENDER_ATTACHMENT;
const SCALE_DIVISORS = [1, 2, 4, 8, 16, 32] as const;

interface DiffusionPipelines {
  source: GpuRenderPipeline;
  blurHorizontal: GpuRenderPipeline;
  blurVertical: GpuRenderPipeline;
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
}

export interface DiffusionRenderInput {
  sourceKey: string;
  width: number;
  height: number;
  recipe: DiffusionRecipe;
  createLinearBase: () => Promise<GpuTexture>;
  isCancelled?: () => boolean;
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
    const [source, blurHorizontal, blurVertical, composite] = await Promise.all([
      create('fragment_source', '柔光源图 Pipeline'),
      create('fragment_blur_horizontal', '柔光横向模糊 Pipeline'),
      create('fragment_blur_vertical', '柔光纵向模糊 Pipeline'),
      create('fragment_composite', '柔光合成 Pipeline'),
    ]);
    return new WebGpuDiffusionRenderer(
      device,
      sampler,
      { source, blurHorizontal, blurVertical, composite },
      new ImageEditTexturePool(device, textureBudgetBytes)
    );
  }

  async render(input: DiffusionRenderInput): Promise<DiffusionRenderOutput> {
    assertNotCancelled(input.isCancelled);
    const invalidation = determineDiffusionInvalidation(this.cache, input);
    if (invalidation === 'source') await this.rebuildSource(input);
    else if (invalidation === 'pyramid') await this.rebuildPyramid(input);
    const cache = this.cache;
    if (!cache) throw new Error('柔光渲染缓存未初始化');
    const output = this.acquireTexture(input.width, input.height);
    const uniform = createUniformBuffer(
      this.device,
      createCompositeUniform(input.recipe)
    );
    try {
      assertNotCancelled(input.isCancelled);
      renderPipelinePass(
        this.device,
        this.pipelines.composite,
        [
          { binding: 0, resource: cache.base.createView() },
          { binding: 1, resource: this.sampler },
          ...cache.scales.map((texture, index) => ({
            binding: index + 2,
            resource: texture.createView(),
          })),
          { binding: 8, resource: { buffer: uniform } },
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
    for (const texture of cache.scales) this.texturePool.release(texture);
    cache.scales = [];
    const scratch: GpuTexture[] = [];
    const uniforms: GpuBuffer[] = [];
    try {
      for (let index = 0; index < input.recipe.scales.length; index += 1) {
        assertNotCancelled(input.isCancelled);
        const divisor = input.recipe.quality === 'high'
          ? SCALE_DIVISORS[index]
          : Math.min(32, SCALE_DIVISORS[index] * (index >= 3 ? 2 : 1));
        const width = Math.max(1, Math.ceil(input.width / divisor));
        const height = Math.max(1, Math.ceil(input.height / divisor));
        const horizontal = this.acquireTexture(width, height);
        const vertical = this.acquireTexture(width, height);
        scratch.push(horizontal);
        const horizontalUniform = createUniformBuffer(
          this.device,
          createBlurUniform(input.recipe, index, 0)
        );
        const verticalUniform = createUniformBuffer(
          this.device,
          createBlurUniform(input.recipe, index, 1)
        );
        uniforms.push(horizontalUniform, verticalUniform);
        renderPipelinePass(
          this.device,
          this.pipelines.blurHorizontal,
          [
            { binding: 0, resource: cache.source.createView() },
            { binding: 1, resource: this.sampler },
            { binding: 2, resource: { buffer: horizontalUniform } },
          ],
          horizontal
        );
        renderPipelinePass(
          this.device,
          this.pipelines.blurVertical,
          [
            { binding: 0, resource: horizontal.createView() },
            { binding: 1, resource: this.sampler },
            { binding: 2, resource: { buffer: verticalUniform } },
          ],
          vertical
        );
        cache.scales.push(vertical);
      }
      await this.device.queue.onSubmittedWorkDone();
      assertNotCancelled(input.isCancelled);
      cache.pyramidSignature = createPyramidSignature(input.recipe);
    } catch (error) {
      await this.device.queue.onSubmittedWorkDone().catch(() => undefined);
      for (const texture of cache.scales) this.texturePool.release(texture);
      cache.scales = [];
      throw error;
    } finally {
      for (const buffer of uniforms) buffer.destroy();
      for (const texture of scratch) this.texturePool.release(texture);
    }
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
    for (const texture of this.cache.scales) this.texturePool.release(texture);
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
  return JSON.stringify([recipe.mode, recipe.source, recipe.optics.positionVariation]);
}

function createPyramidSignature(recipe: DiffusionRecipe): string {
  return JSON.stringify([
    recipe.quality,
    recipe.scales,
    recipe.optics.anisotropy,
    recipe.optics.angleRadians,
  ]);
}

function createSourceUniform(recipe: DiffusionRecipe): Float32Array {
  return new Float32Array([
    1, 1, 0, 0,
    recipe.source.thresholdLinear,
    recipe.source.softKneeLinear,
    recipe.source.power,
    recipe.source.highlightGain,
    recipe.source.microGain,
    recipe.source.highlightRecovery,
    modeToNumber(recipe.mode),
    recipe.optics.positionVariation,
  ]);
}

function createBlurUniform(
  recipe: DiffusionRecipe,
  scaleIndex: number,
  axis: 0 | 1
): Float32Array {
  return new Float32Array([
    1, 1, 0, 0,
    recipe.image.aspectCorrection[0],
    recipe.image.aspectCorrection[1],
    recipe.scales[scaleIndex].radius,
    axis,
    recipe.optics.anisotropy,
    recipe.optics.angleRadians,
    0,
    0,
  ]);
}

function createCompositeUniform(recipe: DiffusionRecipe): Float32Array {
  const weights = recipe.scales.map((scale) => scale.weight);
  return new Float32Array([
    1, 1, 0, 0,
    weights[0], weights[1], weights[2], weights[3],
    weights[4], weights[5], 0, 0,
    recipe.strength,
    recipe.energy.scatterFraction,
    recipe.energy.directRetention,
    recipe.energy.veil,
    recipe.tone.blackRetention,
    recipe.tone.highlightCompression,
    recipe.tone.scatterDesaturation,
    recipe.detail.highFrequencyRetention,
    recipe.detail.midFrequencyRetention,
    modeToNumber(recipe.mode),
    recipe.optics.chromaticSpread,
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
