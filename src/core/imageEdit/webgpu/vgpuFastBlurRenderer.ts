import { effect, frame, initFromDevice, sampler, target } from 'vgpu';
import type { Effect, Gpu, Target, Texture } from 'vgpu';
import {
  FAST_BLUR_MAX_PAIRED_TAPS,
  FAST_BLUR_MAX_PYRAMID_LEVELS,
  FAST_BLUR_RECIPE_VERSION,
  type FastBlurRecipe,
} from '../fastBlurRecipe';
import blurShaderSource from '../shaders/vgpuFastBlur.wgsl?raw';
import downsampleShaderSource from '../shaders/vgpuFastBlurDownsample.wgsl?raw';
import linearizeShaderSource from '../shaders/vgpuGlowLinearize.wgsl?raw';
import upsampleShaderSource from '../shaders/vgpuFastBlurUpsample.wgsl?raw';
import type { GpuDevice, GpuTexture } from '../worker/webgpuRuntimeSupport';

interface FastBlurTargets {
  scene: Target;
  levels: Target[];
  horizontal: Target;
  vertical: Target;
  reconstructions: Target[];
}

interface FastBlurEffects {
  linearize: Effect;
  downsample: Effect[];
  horizontal: Effect;
  vertical: Effect;
  upsample: Effect[];
}

const CLEAR = [0, 0, 0, 0] as const;
const UNUSED_SIZE = [1, 1] as const;

/** vGPU 驱动的固定 tap 分离模糊；大半径通过连续 2× 金字塔产生。 */
export class VgpuFastBlurRenderer {
  private readonly input: Texture;
  private readonly targets: FastBlurTargets;
  private readonly effects: FastBlurEffects;
  private readonly linearSampler: ReturnType<typeof sampler>;
  private compiled = false;
  private vgpuError: Error | null = null;
  private destroyed = false;

  private constructor(private readonly gpu: Gpu) {
    this.input = gpu.device.createTexture({
      size: [1, 1],
      format: 'rgba8unorm',
      usage: ['copy_dst', 'texture_binding', 'render_attachment'],
      label: 'image-edit-vgpu-fast-blur-input',
    });
    this.targets = createTargets(gpu);
    this.effects = createEffects(gpu);
    this.linearSampler = sampler(gpu, {
      minFilter: 'linear',
      magFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });
    gpu.onError((error) => {
      this.vgpuError = error instanceof Error ? error : new Error(String(error));
    });
  }

  static async create(device: GpuDevice): Promise<VgpuFastBlurRenderer> {
    const gpu = await initFromDevice(device as unknown as Parameters<typeof initFromDevice>[0]);
    return new VgpuFastBlurRenderer(gpu);
  }

  async render(input: {
    bitmap: ImageBitmap;
    width: number;
    height: number;
    recipe: FastBlurRecipe;
    isCancelled?: () => boolean;
  }): Promise<GpuTexture> {
    assertNotCancelled(input.isCancelled);
    validateRecipe(input.recipe);
    this.resize(input.width, input.height, input.recipe.pyramidLevel);
    this.bind(input.recipe);
    await this.compile();
    this.vgpuError = null;
    this.gpu.gpu.queue.copyExternalImageToTexture(
      { source: input.bitmap },
      { texture: this.input.gpu, premultipliedAlpha: false },
      [input.width, input.height],
    );
    let output = this.targets.scene;
    const submitted = frame(this.gpu, (currentFrame) => {
      currentFrame.pass({ target: this.targets.scene, clear: CLEAR }, this.effects.linearize);
      if (input.recipe.radiusPx <= 0) return;
      output = this.encodeBlur(currentFrame, input.recipe.pyramidLevel);
    });
    await submitted.done;
    await this.gpu.settled();
    assertNotCancelled(input.isCancelled);
    const reportedError = this.vgpuError as Error | null;
    if (reportedError) throw new Error(`VGPU 模糊渲染失败：${reportedError.message}`);
    return output.color.gpu as unknown as GpuTexture;
  }

  trimWorkingSet(): void {
    if (this.destroyed) return;
    this.input.resize(UNUSED_SIZE);
    this.targets.scene.resize(UNUSED_SIZE);
    this.targets.horizontal.resize(UNUSED_SIZE);
    this.targets.vertical.resize(UNUSED_SIZE);
    this.targets.levels.forEach((value) => value.resize(UNUSED_SIZE));
    this.targets.reconstructions.forEach((value) => value.resize(UNUSED_SIZE));
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.input.destroy();
    destroyTarget(this.targets.scene);
    destroyTarget(this.targets.horizontal);
    destroyTarget(this.targets.vertical);
    this.targets.levels.forEach(destroyTarget);
    this.targets.reconstructions.forEach(destroyTarget);
    this.gpu.dispose();
  }

  private resize(width: number, height: number, levelCount: number): void {
    const full = normalizeSize(width, height);
    this.input.resize(full);
    this.targets.scene.resize(full);
    for (let index = 0; index < FAST_BLUR_MAX_PYRAMID_LEVELS; index += 1) {
      const active = index < levelCount;
      this.targets.levels[index].resize(active ? scaleSize(full, 2 ** (index + 1)) : UNUSED_SIZE);
      this.targets.reconstructions[index].resize(active ? scaleSize(full, 2 ** index) : UNUSED_SIZE);
    }
    const convolutionSize = levelCount > 0
      ? this.targets.levels[levelCount - 1].size
      : full;
    this.targets.horizontal.resize(convolutionSize);
    this.targets.vertical.resize(convolutionSize);
  }

  private bind(recipe: FastBlurRecipe): void {
    const targets = this.targets;
    this.effects.linearize.set({ source: this.input, linearSampler: this.linearSampler });
    let previous = targets.scene;
    for (let index = 0; index < recipe.pyramidLevel; index += 1) {
      this.effects.downsample[index].set({ source: previous, linearSampler: this.linearSampler });
      previous = targets.levels[index];
    }
    const texelSize = [1 / previous.size[0], 1 / previous.size[1]] as const;
    const taps = Array.from({ length: FAST_BLUR_MAX_PAIRED_TAPS }, (_, index) => {
      const tap = recipe.pairedTaps[index];
      return tap ? [tap.offset, tap.weight, 0, 0] : [0, 0, 0, 0];
    });
    const params = {
      texelSize,
      taps,
      centerWeight: recipe.centerWeight,
      tapCount: recipe.pairedTaps.length,
    };
    this.effects.horizontal.set({
      source: previous,
      linearSampler: this.linearSampler,
      params: { ...params, direction: [texelSize[0], 0] },
    });
    this.effects.vertical.set({
      source: targets.horizontal,
      linearSampler: this.linearSampler,
      params: { ...params, direction: [0, texelSize[1]] },
    });
    previous = targets.vertical;
    for (let index = recipe.pyramidLevel - 1; index >= 0; index -= 1) {
      this.effects.upsample[index].set({ source: previous, linearSampler: this.linearSampler });
      previous = targets.reconstructions[index];
    }
  }

  private encodeBlur(
    currentFrame: ReturnType<typeof frame>,
    levelCount: number,
  ): Target {
    for (let index = 0; index < levelCount; index += 1) {
      currentFrame.pass(
        { target: this.targets.levels[index], clear: CLEAR },
        this.effects.downsample[index],
      );
    }
    currentFrame.pass({ target: this.targets.horizontal, clear: CLEAR }, this.effects.horizontal);
    currentFrame.pass({ target: this.targets.vertical, clear: CLEAR }, this.effects.vertical);
    let output = this.targets.vertical;
    for (let index = levelCount - 1; index >= 0; index -= 1) {
      output = this.targets.reconstructions[index];
      currentFrame.pass({ target: output, clear: CLEAR }, this.effects.upsample[index]);
    }
    return output;
  }

  private async compile(): Promise<void> {
    if (this.compiled) return;
    await Promise.all([
      this.effects.linearize.compile(this.targets.scene),
      this.effects.horizontal.compile(this.targets.horizontal),
      this.effects.vertical.compile(this.targets.vertical),
      ...this.effects.downsample.map((value, index) => value.compile(this.targets.levels[index])),
      ...this.effects.upsample.map((value, index) => value.compile(this.targets.reconstructions[index])),
    ]);
    this.compiled = true;
  }
}

function createTargets(gpu: Gpu): FastBlurTargets {
  const make = (): Target => target(gpu, { size: [1, 1], format: 'rgba16float' });
  return {
    scene: make(),
    levels: Array.from({ length: FAST_BLUR_MAX_PYRAMID_LEVELS }, make),
    horizontal: make(),
    vertical: make(),
    reconstructions: Array.from({ length: FAST_BLUR_MAX_PYRAMID_LEVELS }, make),
  };
}

function createEffects(gpu: Gpu): FastBlurEffects {
  return {
    linearize: effect(gpu, linearizeShaderSource, { label: '模糊线性化' }),
    downsample: Array.from({ length: FAST_BLUR_MAX_PYRAMID_LEVELS }, (_, index) => (
      effect(gpu, downsampleShaderSource, { label: `模糊降采样 ${index + 1}` })
    )),
    horizontal: effect(gpu, blurShaderSource, { label: '模糊横向卷积' }),
    vertical: effect(gpu, blurShaderSource, { label: '模糊纵向卷积' }),
    upsample: Array.from({ length: FAST_BLUR_MAX_PYRAMID_LEVELS }, (_, index) => (
      effect(gpu, upsampleShaderSource, { label: `模糊重建 ${index + 1}` })
    )),
  };
}

function validateRecipe(recipe: FastBlurRecipe): void {
  if (recipe.schemaVersion !== FAST_BLUR_RECIPE_VERSION) throw new Error('VGPU 模糊配方版本无效');
  if (!Number.isInteger(recipe.pyramidLevel)
    || recipe.pyramidLevel < 0
    || recipe.pyramidLevel > FAST_BLUR_MAX_PYRAMID_LEVELS) {
    throw new Error(`VGPU 模糊金字塔层数无效：${recipe.pyramidLevel}`);
  }
  if (recipe.pairedTaps.length > FAST_BLUR_MAX_PAIRED_TAPS) {
    throw new Error(`VGPU 模糊采样数量无效：${recipe.pairedTaps.length}`);
  }
}

function normalizeSize(width: number, height: number): readonly [number, number] {
  if (!Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0) {
    throw new Error(`VGPU 模糊尺寸无效：${width}×${height}`);
  }
  return [width, height];
}

function scaleSize(size: readonly [number, number], divisor: number): readonly [number, number] {
  return [Math.max(1, Math.ceil(size[0] / divisor)), Math.max(1, Math.ceil(size[1] / divisor))];
}

function destroyTarget(value: Target): void {
  value.color.destroy();
}

function assertNotCancelled(isCancelled?: () => boolean): void {
  if (!isCancelled?.()) return;
  const error = new Error('VGPU 模糊渲染已取消');
  error.name = 'AbortError';
  throw error;
}
