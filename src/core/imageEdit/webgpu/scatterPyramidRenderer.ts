import type { DiffusionScatterLevel } from '../diffusionRecipe';
import {
  createUniformBuffer,
  renderPipelinePass,
  type GpuBuffer,
  type GpuDevice,
  type GpuRenderPipeline,
  type GpuTexture,
} from '../worker/webgpuRuntimeSupport';

export interface ScatterPyramidRenderOptions {
  device: GpuDevice;
  sampler: unknown;
  downsamplePipeline: GpuRenderPipeline;
  upsamplePipeline: GpuRenderPipeline;
  source: GpuTexture;
  width: number;
  height: number;
  levels: readonly DiffusionScatterLevel[];
  acquireTexture: (width: number, height: number) => GpuTexture;
  releaseTexture: (texture: GpuTexture) => void;
  isCancelled?: () => boolean;
}

export interface ScatterPyramidRenderResult {
  /** 已经逐级上采样并加权的最终散射。 */
  scales: GpuTexture[];
  /** 本次创建且需要随缓存统一释放的全部纹理。 */
  textures: GpuTexture[];
}

/**
 * 构建三种柔光模式共用的正权重 mip 散射金字塔。
 *
 * 每层只从相邻上一级用固定小核降采样，再从最小层逐级 tent 上采样。半径来自层级，
 * 不来自稀疏采样点的大跨度跳跃，因此亮边剖面不会出现二次峰值或平行复本。
 *
 * 层数由配方按图片尺寸决定而不是写死六级：最外层之后没有更宽的尺度可叠时，PSF 会
 * 从幂律突然退化成高斯并直接归零，观感上就是光晕有一圈看得见的外边界。多出来的层
 * 几乎不要钱——第 i 级只有全分辨率的 1/4^i。
 */
export async function renderScatterPyramid(
  options: ScatterPyramidRenderOptions
): Promise<ScatterPyramidRenderResult> {
  const downsampled: GpuTexture[] = [];
  const textures: GpuTexture[] = [];
  const uniforms: GpuBuffer[] = [];
  try {
    let previous = options.source;
    for (const level of options.levels) {
      assertNotCancelled(options.isCancelled);
      const dimensions = dimensionsForDivisor(options.width, options.height, level.divisor);
      const target = options.acquireTexture(dimensions.width, dimensions.height);
      const uniform = createUniformBuffer(options.device, createDiffusionDownsampleUniform());
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
    let accumulatedWeight: readonly [number, number, number] =
      options.levels[options.levels.length - 1].weight;
    for (let index = downsampled.length - 2; index >= 0; index -= 1) {
      assertNotCancelled(options.isCancelled);
      const dimensions = dimensionsForDivisor(
        options.width,
        options.height,
        options.levels[index].divisor
      );
      const target = options.acquireTexture(dimensions.width, dimensions.height);
      const uniform = createUniformBuffer(
        options.device,
        createDiffusionUpsampleUniform(options.levels[index].weight, accumulatedWeight)
      );
      uniforms.push(uniform);
      renderPipelinePass(
        options.device,
        options.upsamplePipeline,
        [
          { binding: 0, resource: downsampled[index].createView() },
          { binding: 1, resource: options.sampler },
          { binding: 2, resource: { buffer: uniform } },
          { binding: 10, resource: accumulated.createView() },
        ],
        target
      );
      textures.push(target);
      accumulated = target;
      // 第一次合成写入两个最小层的原始权重；之后低层纹理已包含其余权重总和。
      accumulatedWeight = [1, 1, 1];
    }

    assertNotCancelled(options.isCancelled);
    return { scales: [accumulated], textures };
  } catch (error) {
    await options.device.queue.onSubmittedWorkDone().catch(() => undefined);
    for (const texture of textures) options.releaseTexture(texture);
    throw error;
  } finally {
    for (const buffer of uniforms) buffer.destroy();
  }
}

export function createDiffusionDownsampleUniform(): Float32Array {
  return new Float32Array([
    1, 1, 0, 0,
    1, 1, 0, 0,
    0, 0, 0, 0,
    0, 0, 0, 0,
  ]);
}

export function createDiffusionUpsampleUniform(
  highWeight: readonly [number, number, number],
  lowWeight: readonly [number, number, number]
): Float32Array {
  return new Float32Array([
    1, 1, 0, 0,
    1, 1, 0, 0,
    highWeight[0], highWeight[1], highWeight[2], 0,
    lowWeight[0], lowWeight[1], lowWeight[2], 0,
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
