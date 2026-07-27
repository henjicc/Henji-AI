import type { DiffusionScaleRecipe } from '../diffusionRecipe';
import {
  createUniformBuffer,
  renderPipelinePass,
  type GpuBuffer,
  type GpuDevice,
  type GpuRenderPipeline,
  type GpuTexture,
} from '../worker/webgpuRuntimeSupport';

const BLOOM_SCALE_DIVISORS = [2, 4, 8, 16, 32, 64] as const;

export interface BloomPyramidRenderOptions {
  device: GpuDevice;
  sampler: unknown;
  downsamplePipeline: GpuRenderPipeline;
  upsamplePipeline: GpuRenderPipeline;
  source: GpuTexture;
  width: number;
  height: number;
  scales: readonly DiffusionScaleRecipe[];
  acquireTexture: (width: number, height: number) => GpuTexture;
  releaseTexture: (texture: GpuTexture) => void;
  isCancelled?: () => boolean;
}

export interface BloomPyramidRenderResult {
  /** 第 0 张是已经逐级上采样并归一加权的最终 Bloom；其余用于补齐共享合成布局。 */
  scales: GpuTexture[];
  /** 本次创建且需要随缓存统一释放的全部纹理。 */
  textures: GpuTexture[];
}

/**
 * 构建数字 Bloom 的正权重 mip 金字塔。
 *
 * 每层只从相邻上一级用固定小核降采样，再从最小层逐级 tent 上采样。半径来自层级，
 * 不来自稀疏采样点的大跨度跳跃，因此亮边剖面不会出现二次峰值或平行复本。
 */
export async function renderBloomPyramid(
  options: BloomPyramidRenderOptions
): Promise<BloomPyramidRenderResult> {
  const downsampled: GpuTexture[] = [];
  const textures: GpuTexture[] = [];
  const uniforms: GpuBuffer[] = [];
  try {
    let previous = options.source;
    for (let index = 0; index < options.scales.length; index += 1) {
      assertNotCancelled(options.isCancelled);
      const dimensions = dimensionsForDivisor(
        options.width,
        options.height,
        BLOOM_SCALE_DIVISORS[index]
      );
      const target = options.acquireTexture(dimensions.width, dimensions.height);
      const uniform = createUniformBuffer(options.device, createDownsampleUniform());
      uniforms.push(uniform);
      renderPipelinePass(
        options.device,
        options.downsamplePipeline,
        [
          { binding: 0, resource: previous.createView() },
          { binding: 1, resource: options.sampler },
          { binding: 2, resource: { buffer: uniform } },
        ],
        target
      );
      downsampled.push(target);
      textures.push(target);
      previous = target;
    }

    let accumulated = downsampled[downsampled.length - 1];
    let accumulatedWeight = options.scales[options.scales.length - 1].weight;
    for (let index = downsampled.length - 2; index >= 0; index -= 1) {
      assertNotCancelled(options.isCancelled);
      const high = downsampled[index];
      const dimensions = dimensionsForDivisor(
        options.width,
        options.height,
        BLOOM_SCALE_DIVISORS[index]
      );
      const target = options.acquireTexture(dimensions.width, dimensions.height);
      const uniform = createUniformBuffer(
        options.device,
        createUpsampleUniform(options.scales[index].weight, accumulatedWeight)
      );
      uniforms.push(uniform);
      renderPipelinePass(
        options.device,
        options.upsamplePipeline,
        [
          { binding: 0, resource: high.createView() },
          { binding: 1, resource: options.sampler },
          { binding: 2, resource: { buffer: uniform } },
          { binding: 10, resource: accumulated.createView() },
        ],
        target
      );
      textures.push(target);
      accumulated = target;
      // 第一次合成写入两个最小层的原始权重；之后低层纹理已包含其余权重总和。
      accumulatedWeight = 1;
    }

    await options.device.queue.onSubmittedWorkDone();
    assertNotCancelled(options.isCancelled);
    return {
      scales: [accumulated, ...downsampled.slice(1)],
      textures,
    };
  } catch (error) {
    await options.device.queue.onSubmittedWorkDone().catch(() => undefined);
    for (const texture of textures) options.releaseTexture(texture);
    throw error;
  } finally {
    for (const buffer of uniforms) buffer.destroy();
  }
}

function createDownsampleUniform(): Float32Array {
  return new Float32Array([
    1, 1, 0, 0,
    1, 1, 0, 0,
  ]);
}

function createUpsampleUniform(highWeight: number, lowWeight: number): Float32Array {
  return new Float32Array([
    1, 1, 0, 0,
    1, 1, highWeight, lowWeight,
  ]);
}

function dimensionsForDivisor(
  width: number,
  height: number,
  divisor: number
): { width: number; height: number } {
  return {
    width: Math.max(1, Math.ceil(width / divisor)),
    height: Math.max(1, Math.ceil(height / divisor)),
  };
}

function assertNotCancelled(isCancelled?: () => boolean): void {
  if (isCancelled?.()) {
    throw new DOMException('图片编辑任务已取消', 'AbortError');
  }
}
