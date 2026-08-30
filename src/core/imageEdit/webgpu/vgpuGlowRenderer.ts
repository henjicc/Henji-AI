import { effect, frame, initFromDevice, sampler, target } from 'vgpu';
import type { Effect, Gpu, Target, Texture } from 'vgpu';
import bloomShaderSource from '../shaders/vgpuGlowBloom.wgsl?raw';
import compositeShaderSource from '../shaders/vgpuGlowComposite.wgsl?raw';
import copyShaderSource from '../shaders/vgpuGlowCopy.wgsl?raw';
import linearizeShaderSource from '../shaders/vgpuGlowLinearize.wgsl?raw';
import upsampleShaderSource from '../shaders/vgpuGlowUpsample.wgsl?raw';
import {
  VGPU_GLOW_RECIPE_VERSION,
  effectiveScatterSigmaPx,
  type VgpuGlowRecipe,
} from '../vgpuGlowRecipe';
import type { GpuDevice, GpuTexture } from '../worker/webgpuRuntimeSupport';

interface GlowTargets {
  scene: Target;
  levels: Target[];
  accumulations: Target[];
  globalBloom: Target;
  output: Target;
}

interface GlowEffects {
  linearize: Effect;
  extract: Effect;
  downsample: Effect[];
  upsample: Effect[];
  copy: Effect;
  composite: Effect;
}

/**
 * 超大图分块导出期间保留的一份整图散射。它属于创建它的 renderer，只在 release 前有效。
 */
export interface VgpuGlowGlobalScatter {
  readonly target: Target;
  readonly sourceSize: readonly [number, number];
  release(): void;
}

const MAX_SCATTER_LEVELS = 12;
const CLEAR = [0, 0, 0, 0] as const;
const UNIT_RGB = [1, 1, 1] as const;
const UNUSED_SIZE = [1, 1] as const;

/**
 * VGPU 驱动的连续散射金字塔。
 *
 * 亮源从全分辨率开始逐级 2× 降采样，再从最小层用 tent 核逐级重建并同时累加物理 PSF
 * 权重。所有采样都只访问相邻 texel，半径由层级产生，因此大半径不会出现稀疏采样的
 * 平行复本，也不会在五个固定高斯层之间露出亮度台阶。整条链仍编码进一个 VGPU frame，
 * 只有一次队列提交。
 */
export class VgpuGlowRenderer {
  private readonly input: Texture;
  private readonly targets: GlowTargets;
  private readonly effects: GlowEffects;
  private readonly linearSampler: ReturnType<typeof sampler>;
  private compiledBase = false;
  private compiledLevelCount = 0;
  private vgpuError: Error | null = null;
  private destroyed = false;

  private constructor(private readonly gpu: Gpu) {
    this.input = gpu.device.createTexture({
      size: [1, 1],
      format: 'rgba8unorm',
      usage: ['copy_dst', 'texture_binding', 'render_attachment'],
      label: 'image-edit-vgpu-glow-input',
    });
    this.targets = createTargets(gpu);
    this.linearSampler = sampler(gpu, {
      minFilter: 'linear',
      magFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });
    this.effects = createEffects(gpu);
    gpu.onError((error) => {
      this.vgpuError = error instanceof Error ? error : new Error(String(error));
    });
  }

  static async create(device: GpuDevice): Promise<VgpuGlowRenderer> {
    const gpu = await initFromDevice(
      device as unknown as Parameters<typeof initFromDevice>[0]
    );
    return new VgpuGlowRenderer(gpu);
  }

  async render(input: {
    bitmap: ImageBitmap;
    width: number;
    height: number;
    recipe: VgpuGlowRecipe;
    isCancelled?: () => boolean;
    scatter?: {
      global: VgpuGlowGlobalScatter;
      region: readonly [number, number, number, number];
    };
  }): Promise<GpuTexture> {
    assertNotCancelled(input.isCancelled);
    const levelCount = assertScatterLevels(input.recipe);
    if (input.scatter) {
      this.resizeComposite(input.width, input.height);
      this.bindComposite(
        input.recipe,
        input.scatter.global.target,
        input.scatter.region,
        input.scatter.global.sourceSize
      );
    } else {
      this.resize(input.width, input.height, input.recipe);
      this.bind(input.recipe);
    }
    await this.compile(levelCount);
    this.vgpuError = null;
    this.gpu.gpu.queue.copyExternalImageToTexture(
      { source: input.bitmap },
      { texture: this.input.gpu, premultipliedAlpha: false },
      [input.width, input.height]
    );
    const submitted = frame(this.gpu, (currentFrame) => {
      currentFrame.pass({ target: this.targets.scene, clear: CLEAR }, this.effects.linearize);
      if (!input.scatter) this.encodeScatter(currentFrame, levelCount);
      currentFrame.pass({ target: this.targets.output, clear: CLEAR }, this.effects.composite);
    });
    await submitted.done;
    await this.gpu.settled();
    assertNotCancelled(input.isCancelled);
    const reportedError = this.vgpuError as Error | null;
    if (reportedError) throw new Error(`VGPU 辉光渲染失败：${reportedError.message}`);
    return this.targets.output.color.gpu as unknown as GpuTexture;
  }

  /**
   * 在降采样后的完整画面上只计算一次宽尺度散射，供所有导出 Tile 共享。
   *
   * 这不是性能捷径，而是无缝导出的必要条件：每块独立计算只能看到自己的像素与 halo，
   * 半径大于 halo 的能量必然在块边界断开。官方 Target 的 color 在 resize/destroy 前保持
   * 稳定，因此先复制到独立 target，再改变 scene/output 的块尺寸是安全的。
   */
  async buildGlobalScatter(input: {
    bitmap: ImageBitmap;
    width: number;
    height: number;
    recipe: VgpuGlowRecipe;
    isCancelled?: () => boolean;
  }): Promise<VgpuGlowGlobalScatter> {
    assertNotCancelled(input.isCancelled);
    const levelCount = assertScatterLevels(input.recipe);
    this.resize(input.width, input.height, input.recipe);
    this.bind(input.recipe);
    this.targets.globalBloom.resize(this.targets.accumulations[0].size);
    this.effects.copy.set({
      source: this.targets.accumulations[0],
      linearSampler: this.linearSampler,
    });
    await this.compile(levelCount);
    this.vgpuError = null;
    this.gpu.gpu.queue.copyExternalImageToTexture(
      { source: input.bitmap },
      { texture: this.input.gpu, premultipliedAlpha: false },
      [input.width, input.height]
    );
    const submitted = frame(this.gpu, (currentFrame) => {
      currentFrame.pass({ target: this.targets.scene, clear: CLEAR }, this.effects.linearize);
      this.encodeScatter(currentFrame, levelCount);
      currentFrame.pass(
        { target: this.targets.globalBloom, clear: CLEAR },
        this.effects.copy
      );
    });
    await submitted.done;
    await this.gpu.settled();
    assertNotCancelled(input.isCancelled);
    const reportedError = this.vgpuError as Error | null;
    if (reportedError) throw new Error(`VGPU 全局散射渲染失败：${reportedError.message}`);

    let released = false;
    return {
      target: this.targets.globalBloom,
      sourceSize: [input.width, input.height],
      release: () => {
        if (released) return;
        released = true;
        if (this.destroyed) return;
        this.targets.globalBloom.resize(UNUSED_SIZE);
      },
    };
  }

  /**
   * 释放与上一张图片尺寸相关的工作纹理，但保留 effect、pipeline 与 GPU context。
   * Target.resize 会按 VGPU 官方契约重建 attachment，因此下次启用时仍可直接复用。
   */
  trimWorkingSet(): void {
    if (this.destroyed) return;
    this.input.resize(UNUSED_SIZE);
    this.targets.scene.resize(UNUSED_SIZE);
    this.targets.globalBloom.resize(UNUSED_SIZE);
    this.targets.output.resize(UNUSED_SIZE);
    for (const value of this.targets.levels) value.resize(UNUSED_SIZE);
    for (const value of this.targets.accumulations) value.resize(UNUSED_SIZE);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.input.destroy();
    destroyTarget(this.targets.scene);
    destroyTarget(this.targets.globalBloom);
    destroyTarget(this.targets.output);
    for (const value of this.targets.levels) destroyTarget(value);
    for (const value of this.targets.accumulations) destroyTarget(value);
    this.gpu.dispose();
  }

  private resize(width: number, height: number, recipe: VgpuGlowRecipe): void {
    const full = normalizeSize(width, height);
    this.resizeComposite(full[0], full[1]);
    for (let index = 0; index < MAX_SCATTER_LEVELS; index += 1) {
      const level = recipe.scatterLevels[index];
      const size = level ? scaleSize(full, level.divisor) : UNUSED_SIZE;
      this.targets.levels[index].resize(size);
      this.targets.accumulations[index].resize(
        level && index < recipe.scatterLevels.length - 1 ? size : UNUSED_SIZE
      );
    }
  }

  private resizeComposite(width: number, height: number): void {
    const full = normalizeSize(width, height);
    this.input.resize(full);
    this.targets.scene.resize(full);
    this.targets.output.resize(full);
  }

  private bind(recipe: VgpuGlowRecipe): void {
    const targets = this.targets;
    const effects = this.effects;
    const levelCount = recipe.scatterLevels.length;
    effects.linearize.set({ source: this.input, linearSampler: this.linearSampler });
    setBloom(effects.extract, targets.scene, recipe, 0, this.linearSampler);
    for (let index = 1; index < levelCount; index += 1) {
      setBloom(
        effects.downsample[index - 1],
        targets.levels[index - 1],
        recipe,
        1,
        this.linearSampler
      );
    }

    let lowAccumulation = targets.levels[levelCount - 1];
    for (let index = levelCount - 2; index >= 0; index -= 1) {
      const firstMerge = index === levelCount - 2;
      effects.upsample[index].set({
        highLevel: targets.levels[index],
        lowAccumulation,
        linearSampler: this.linearSampler,
        accumulate: {
          highWeight: [
            ...recipe.scatterLevels[index].weight,
            recipe.scatterLevels[index].whiteCoreWeight,
          ],
          lowWeight: [
            ...(firstMerge ? recipe.scatterLevels[index + 1].weight : UNIT_RGB),
            firstMerge ? recipe.scatterLevels[index + 1].whiteCoreWeight : 1,
          ],
        },
      });
      lowAccumulation = targets.accumulations[index];
    }

    this.bindComposite(
      recipe,
      targets.accumulations[0],
      [0, 0, 1, 1],
      targets.scene.size
    );
  }

  private bindComposite(
    recipe: VgpuGlowRecipe,
    bloomPyramid: Target,
    scatterRegion: readonly [number, number, number, number],
    scatterSourceSize: readonly [number, number]
  ): void {
    const effects = this.effects;
    const targets = this.targets;
    effects.linearize.set({ source: this.input, linearSampler: this.linearSampler });
    effects.composite.set({
      scene: targets.scene,
      bloomPyramid,
      linearSampler: this.linearSampler,
      composite: {
        params: [recipe.intensity, recipe.responseExposure, 0, 0],
        optics: [
          1 / Math.max(targets.scene.size[0], 1),
          1 / Math.max(targets.scene.size[1], 1),
          recipe.chromaticOffsetPx,
          recipe.chromaticAberration,
        ],
        finish: [recipe.ditherAmount, 0, 0, 0],
        scatterRegion: [...scatterRegion],
        scatterGeometry: [
          scatterSourceSize[0],
          scatterSourceSize[1],
          bloomPyramid.size[0],
          bloomPyramid.size[1],
        ],
      },
    });
  }

  private encodeScatter(currentFrame: ReturnType<typeof frame>, levelCount: number): void {
    currentFrame.pass({ target: this.targets.levels[0], clear: CLEAR }, this.effects.extract);
    for (let index = 1; index < levelCount; index += 1) {
      currentFrame.pass(
        { target: this.targets.levels[index], clear: CLEAR },
        this.effects.downsample[index - 1]
      );
    }
    for (let index = levelCount - 2; index >= 0; index -= 1) {
      currentFrame.pass(
        { target: this.targets.accumulations[index], clear: CLEAR },
        this.effects.upsample[index]
      );
    }
  }

  private async compile(levelCount: number): Promise<void> {
    const jobs: Array<Promise<Effect>> = [];
    if (!this.compiledBase) {
      jobs.push(
        this.effects.linearize.compile(this.targets.scene),
        this.effects.extract.compile(this.targets.levels[0]),
        this.effects.copy.compile(this.targets.globalBloom),
        this.effects.composite.compile(this.targets.output)
      );
    }
    const firstUncompiledEdge = Math.max(0, this.compiledLevelCount - 1);
    for (let index = firstUncompiledEdge; index < levelCount - 1; index += 1) {
      jobs.push(
        this.effects.downsample[index].compile(this.targets.levels[index + 1]),
        this.effects.upsample[index].compile(this.targets.accumulations[index])
      );
    }
    if (jobs.length > 0) await Promise.all(jobs);
    this.compiledBase = true;
    this.compiledLevelCount = Math.max(this.compiledLevelCount, levelCount);
  }
}

function createTargets(gpu: Gpu): GlowTargets {
  const make = (): Target => target(gpu, { size: [1, 1], format: 'rgba16float' });
  return {
    scene: make(),
    levels: Array.from({ length: MAX_SCATTER_LEVELS }, make),
    accumulations: Array.from({ length: MAX_SCATTER_LEVELS }, make),
    globalBloom: make(),
    output: make(),
  };
}

function createEffects(gpu: Gpu): GlowEffects {
  return {
    linearize: effect(gpu, linearizeShaderSource, { label: '辉光 Pro 线性化' }),
    extract: effect(gpu, bloomShaderSource, { label: '辉光 Pro 亮源提取' }),
    downsample: Array.from({ length: MAX_SCATTER_LEVELS - 1 }, (_, index) =>
      effect(gpu, bloomShaderSource, { label: `辉光 Pro 散射降采样 ${index + 1}` })
    ),
    upsample: Array.from({ length: MAX_SCATTER_LEVELS - 1 }, (_, index) =>
      effect(gpu, upsampleShaderSource, { label: `辉光 Pro 散射重建 ${index + 1}` })
    ),
    copy: effect(gpu, copyShaderSource, { label: '辉光 Pro 全局散射保留' }),
    composite: effect(gpu, compositeShaderSource, { label: '辉光 Pro 光学合成' }),
  };
}

function setBloom(
  pass: Effect,
  source: Target,
  recipe: VgpuGlowRecipe,
  mode: 0 | 1,
  linearSampler: ReturnType<typeof sampler>
): void {
  pass.set({
    source,
    linearSampler,
    bloom: {
      params: [
        recipe.sourceThresholdDisplay,
        recipe.sourceKneeDisplay,
        recipe.sourceMaximumRadiance,
        mode === 0 ? recipe.sourceGain : -1,
      ],
      optics: [recipe.whiteHeat, 0, 0, 0],
      tint: [...recipe.tintLinear, recipe.tintEnabled ? 1 : 0],
    },
  });
}

function assertScatterLevels(recipe: VgpuGlowRecipe): number {
  if (recipe.schemaVersion !== VGPU_GLOW_RECIPE_VERSION) {
    throw new Error(`VGPU 辉光配方版本无效：${recipe.schemaVersion}`);
  }
  const count = recipe.scatterLevels.length;
  if (count < 2 || count > MAX_SCATTER_LEVELS) {
    throw new Error(`VGPU 辉光散射层数无效：${count}`);
  }
  for (let index = 0; index < count; index += 1) {
    const expectedDivisor = 2 ** (index + 1);
    if (recipe.scatterLevels[index].divisor !== expectedDivisor) {
      throw new Error(`VGPU 辉光散射层 ${index} 必须使用连续 2× mip`);
    }
    const expectedSigma = effectiveScatterSigmaPx(expectedDivisor);
    if (Math.abs(recipe.scatterLevels[index].effectiveSigmaPx - expectedSigma) > 0.0001) {
      throw new Error(`VGPU 辉光散射层 ${index} 的核尺度无效`);
    }
  }
  return count;
}

function normalizeSize(width: number, height: number): readonly [number, number] {
  return [Math.max(1, Math.floor(width)), Math.max(1, Math.floor(height))];
}

function scaleSize(size: readonly [number, number], divisor: number): readonly [number, number] {
  return [Math.max(1, Math.ceil(size[0] / divisor)), Math.max(1, Math.ceil(size[1] / divisor))];
}

function destroyTarget(value: Target): void {
  (value as Target & { destroy(): void }).destroy();
}

function assertNotCancelled(isCancelled?: () => boolean): void {
  if (isCancelled?.()) throw new DOMException('图片编辑任务已取消', 'AbortError');
}
