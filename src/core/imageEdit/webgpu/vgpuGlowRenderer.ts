import { effect, frame, initFromDevice, sampler, target } from 'vgpu';
import type { Effect, Gpu, Target, Texture } from 'vgpu';
import bloomShaderSource from '../shaders/vgpuGlowBloom.wgsl?raw';
import compositeShaderSource from '../shaders/vgpuGlowComposite.wgsl?raw';
import linearizeShaderSource from '../shaders/vgpuGlowLinearize.wgsl?raw';
import type { VgpuGlowRecipe } from '../vgpuGlowRecipe';
import type { GpuDevice, GpuTexture } from '../worker/webgpuRuntimeSupport';

interface GlowTargets {
  scene: Target;
  bloom0: Target;
  bloomPing0: Target;
  bloom1: Target;
  bloomPing1: Target;
  bloom2: Target;
  bloomPing2: Target;
  bloom3: Target;
  bloomPing3: Target;
  bloom4: Target;
  bloomPing4: Target;
  output: Target;
}

interface GlowEffects {
  linearize: Effect;
  extract: Effect;
  blurH0: Effect;
  blurV0: Effect;
  down1: Effect;
  blurH1: Effect;
  blurV1: Effect;
  down2: Effect;
  blurH2: Effect;
  blurV2: Effect;
  down3: Effect;
  blurH3: Effect;
  blurV3: Effect;
  down4: Effect;
  blurH4: Effect;
  blurV4: Effect;
  composite: Effect;
}

const CLEAR = [0, 0, 0, 0] as const;

/**
 * VGPU 驱动的独立辉光管线。
 *
 * 它采用已有 Worker 的 GPUDevice，VGPU 只拥有自己的包装层和纹理，销毁时不会碰宿主
 * device。所有后处理 Pass 在同一个 frame 中编码、一次 submit，避免拖动参数时产生十几次
 * 队列提交。
 */
export class VgpuGlowRenderer {
  private readonly input: Texture;
  private readonly targets: GlowTargets;
  private readonly effects: GlowEffects;
  private readonly linearSampler: ReturnType<typeof sampler>;
  private compiled = false;
  private vgpuError: Error | null = null;

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
  }): Promise<GpuTexture> {
    assertNotCancelled(input.isCancelled);
    this.resize(input.width, input.height);
    this.bind(input.recipe);
    if (!this.compiled) {
      await this.compile();
      this.compiled = true;
    }
    this.vgpuError = null;
    this.gpu.gpu.queue.copyExternalImageToTexture(
      { source: input.bitmap },
      { texture: this.input.gpu },
      [input.width, input.height]
    );
    const submitted = frame(this.gpu, (currentFrame) => {
      currentFrame.pass({ target: this.targets.scene, clear: CLEAR }, this.effects.linearize);
      currentFrame.pass({ target: this.targets.bloom0, clear: CLEAR }, this.effects.extract);
      currentFrame.pass({ target: this.targets.bloom1, clear: CLEAR }, this.effects.down1);
      currentFrame.pass({ target: this.targets.bloom2, clear: CLEAR }, this.effects.down2);
      currentFrame.pass({ target: this.targets.bloom3, clear: CLEAR }, this.effects.down3);
      currentFrame.pass({ target: this.targets.bloom4, clear: CLEAR }, this.effects.down4);
      currentFrame.pass({ target: this.targets.bloomPing0, clear: CLEAR }, this.effects.blurH0);
      currentFrame.pass({ target: this.targets.bloom0, clear: CLEAR }, this.effects.blurV0);
      currentFrame.pass({ target: this.targets.bloomPing1, clear: CLEAR }, this.effects.blurH1);
      currentFrame.pass({ target: this.targets.bloom1, clear: CLEAR }, this.effects.blurV1);
      currentFrame.pass({ target: this.targets.bloomPing2, clear: CLEAR }, this.effects.blurH2);
      currentFrame.pass({ target: this.targets.bloom2, clear: CLEAR }, this.effects.blurV2);
      currentFrame.pass({ target: this.targets.bloomPing3, clear: CLEAR }, this.effects.blurH3);
      currentFrame.pass({ target: this.targets.bloom3, clear: CLEAR }, this.effects.blurV3);
      currentFrame.pass({ target: this.targets.bloomPing4, clear: CLEAR }, this.effects.blurH4);
      currentFrame.pass({ target: this.targets.bloom4, clear: CLEAR }, this.effects.blurV4);
      currentFrame.pass({ target: this.targets.output, clear: CLEAR }, this.effects.composite);
    });
    await submitted.done;
    await this.gpu.settled();
    assertNotCancelled(input.isCancelled);
    const reportedError = this.vgpuError as Error | null;
    if (reportedError) throw new Error(`VGPU 辉光渲染失败：${reportedError.message}`);
    return this.targets.output.color.gpu as unknown as GpuTexture;
  }

  destroy(): void {
    this.input.destroy();
    for (const value of Object.values(this.targets)) destroyTarget(value);
    this.gpu.dispose();
  }

  private resize(width: number, height: number): void {
    const full = normalizeSize(width, height);
    const half = scaleSize(full, 2);
    const quarter = scaleSize(full, 4);
    const eighth = scaleSize(full, 8);
    const sixteenth = scaleSize(full, 16);
    const thirtySecond = scaleSize(full, 32);
    this.input.resize(full);
    this.targets.scene.resize(full);
    this.targets.output.resize(full);
    this.targets.bloom0.resize(half);
    this.targets.bloomPing0.resize(half);
    this.targets.bloom1.resize(quarter);
    this.targets.bloomPing1.resize(quarter);
    this.targets.bloom2.resize(eighth);
    this.targets.bloomPing2.resize(eighth);
    this.targets.bloom3.resize(sixteenth);
    this.targets.bloomPing3.resize(sixteenth);
    this.targets.bloom4.resize(thirtySecond);
    this.targets.bloomPing4.resize(thirtySecond);
  }

  private bind(recipe: VgpuGlowRecipe): void {
    const t = this.targets;
    const e = this.effects;
    e.linearize.set({ source: this.input, linearSampler: this.linearSampler });
    setBloom(e.extract, t.scene, t.scene.size, [0, 0], recipe, 0, this.linearSampler);
    // 先建立未模糊的亮源金字塔，再分别模糊各层。这样每层都代表同一个高光种子的
    // 独立散射尺度，不会把上一层的模糊反复卷进下一层，避免光晕发灰、发糊。
    setBloom(e.down1, t.bloom0, t.bloom0.size, [0, 0], recipe, 1, this.linearSampler);
    setBloom(e.down2, t.bloom1, t.bloom1.size, [0, 0], recipe, 1, this.linearSampler);
    setBloom(e.down3, t.bloom2, t.bloom2.size, [0, 0], recipe, 1, this.linearSampler);
    setBloom(e.down4, t.bloom3, t.bloom3.size, [0, 0], recipe, 1, this.linearSampler);
    setBloom(e.blurH0, t.bloom0, t.bloom0.size, [1, 0], recipe, 2, this.linearSampler);
    setBloom(e.blurV0, t.bloomPing0, t.bloom0.size, [0, 1], recipe, 2, this.linearSampler);
    setBloom(e.blurH1, t.bloom1, t.bloom1.size, [1, 0], recipe, 2, this.linearSampler);
    setBloom(e.blurV1, t.bloomPing1, t.bloom1.size, [0, 1], recipe, 2, this.linearSampler);
    setBloom(e.blurH2, t.bloom2, t.bloom2.size, [1, 0], recipe, 2, this.linearSampler);
    setBloom(e.blurV2, t.bloomPing2, t.bloom2.size, [0, 1], recipe, 2, this.linearSampler);
    setBloom(e.blurH3, t.bloom3, t.bloom3.size, [1, 0], recipe, 2, this.linearSampler);
    setBloom(e.blurV3, t.bloomPing3, t.bloom3.size, [0, 1], recipe, 2, this.linearSampler);
    setBloom(e.blurH4, t.bloom4, t.bloom4.size, [1, 0], recipe, 2, this.linearSampler);
    setBloom(e.blurV4, t.bloomPing4, t.bloom4.size, [0, 1], recipe, 2, this.linearSampler);
    e.composite.set({
      scene: t.scene,
      bloomNear: t.bloom0,
      bloomMedium: t.bloom1,
      bloomFar: t.bloom2,
      bloomWide: t.bloom3,
      bloomAtmosphere: t.bloom4,
      linearSampler: this.linearSampler,
      composite: {
        params: [recipe.intensity, recipe.bloomExposure, recipe.bloomGamma, recipe.whiteHeat],
        weights: recipe.levelWeights.slice(0, 4),
        tail: [recipe.levelWeights[4], recipe.coreGain, 0, 0],
        tint: [...recipe.tintLinear, recipe.tintEnabled ? 1 : 0],
        optics: [
          1 / Math.max(t.scene.size[0], 1),
          1 / Math.max(t.scene.size[1], 1),
          recipe.chromaticOffsetPx,
          recipe.chromaticAberration,
        ],
        source: [recipe.threshold, recipe.knee, recipe.hdrBoost, 0],
      },
    });
  }

  private async compile(): Promise<void> {
    const t = this.targets;
    const e = this.effects;
    await Promise.all([
      e.linearize.compile(t.scene),
      e.extract.compile(t.bloom0),
      e.blurH0.compile(t.bloomPing0),
      e.blurV0.compile(t.bloom0),
      e.down1.compile(t.bloom1),
      e.blurH1.compile(t.bloomPing1),
      e.blurV1.compile(t.bloom1),
      e.down2.compile(t.bloom2),
      e.blurH2.compile(t.bloomPing2),
      e.blurV2.compile(t.bloom2),
      e.down3.compile(t.bloom3),
      e.blurH3.compile(t.bloomPing3),
      e.blurV3.compile(t.bloom3),
      e.down4.compile(t.bloom4),
      e.blurH4.compile(t.bloomPing4),
      e.blurV4.compile(t.bloom4),
      e.composite.compile(t.output),
    ]);
  }
}

function createTargets(gpu: Gpu): GlowTargets {
  const make = (): Target => target(gpu, { size: [1, 1], format: 'rgba16float' });
  return {
    scene: make(),
    bloom0: make(),
    bloomPing0: make(),
    bloom1: make(),
    bloomPing1: make(),
    bloom2: make(),
    bloomPing2: make(),
    bloom3: make(),
    bloomPing3: make(),
    bloom4: make(),
    bloomPing4: make(),
    output: make(),
  };
}

function createEffects(gpu: Gpu): GlowEffects {
  return {
    linearize: effect(gpu, linearizeShaderSource, { label: '辉光 Pro 线性化' }),
    extract: effect(gpu, bloomShaderSource, { label: '辉光 Pro 亮源重建' }),
    blurH0: effect(gpu, bloomShaderSource, { label: '辉光 Pro 近场水平' }),
    blurV0: effect(gpu, bloomShaderSource, { label: '辉光 Pro 近场垂直' }),
    down1: effect(gpu, bloomShaderSource, { label: '辉光 Pro 中场降采样' }),
    blurH1: effect(gpu, bloomShaderSource, { label: '辉光 Pro 中场水平' }),
    blurV1: effect(gpu, bloomShaderSource, { label: '辉光 Pro 中场垂直' }),
    down2: effect(gpu, bloomShaderSource, { label: '辉光 Pro 远场降采样' }),
    blurH2: effect(gpu, bloomShaderSource, { label: '辉光 Pro 远场水平' }),
    blurV2: effect(gpu, bloomShaderSource, { label: '辉光 Pro 远场垂直' }),
    down3: effect(gpu, bloomShaderSource, { label: '辉光 Pro 宽场降采样' }),
    blurH3: effect(gpu, bloomShaderSource, { label: '辉光 Pro 宽场水平' }),
    blurV3: effect(gpu, bloomShaderSource, { label: '辉光 Pro 宽场垂直' }),
    down4: effect(gpu, bloomShaderSource, { label: '辉光 Pro 空气层降采样' }),
    blurH4: effect(gpu, bloomShaderSource, { label: '辉光 Pro 空气层水平' }),
    blurV4: effect(gpu, bloomShaderSource, { label: '辉光 Pro 空气层垂直' }),
    composite: effect(gpu, compositeShaderSource, { label: '辉光 Pro 合成' }),
  };
}

function setBloom(
  pass: Effect,
  source: Target,
  sourceSize: readonly [number, number],
  direction: readonly [number, number],
  recipe: VgpuGlowRecipe,
  mode: 0 | 1 | 2,
  linearSampler: ReturnType<typeof sampler>
): void {
  pass.set({
    source,
    linearSampler,
    bloom: {
      sourceSize,
      direction,
      params: [recipe.threshold, recipe.knee, recipe.sigma, mode],
      glow: [recipe.hdrBoost, 0, 0, recipe.blurStep],
    },
  });
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
