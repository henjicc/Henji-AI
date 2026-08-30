import type { DiffusionRecipe } from '../diffusionRecipe';
import {
  createImageEditExportPlan,
  IMAGE_EDIT_GLOBAL_SCATTER_MAX_DIMENSION,
} from '../worker/exportPrototype';
import type { ImageEditExportFormat } from '../worker/protocol';

/** 旧柔光管线仍由纹理池管理；这个像素上限不应被 VGPU 辉光的工作集预算连带收紧。 */
const DIFFUSION_SINGLE_PASS_MAX_PIXELS = 40_000_000;

const MEBIBYTE = 1024 * 1024;

/**
 * VGPU 辉光整图渲染的保守进程内预算。
 *
 * WebGPU 不公开可用显存，因此这里不能假装按设备显存百分比动态推断。512 MiB 是一个
 * 跨独显、集显都可解释的应用侧上限；其中预留 192 MiB 给源 ImageBitmap、输出 Canvas、
 * Target.resize() 重建纹理时短暂并存的旧资源以及驱动内部开销。
 */
export const VGPU_GLOW_SINGLE_PASS_BUDGET_BYTES = 512 * MEBIBYTE;
export const VGPU_GLOW_SINGLE_PASS_RESERVE_BYTES = 192 * MEBIBYTE;

/**
 * VGPU 辉光常驻 GPU 工作集约为每个源像素 76/3 字节（约 25.3 B）：
 *
 * - rgba8 输入：4N；
 * - rgba16float scene + output：16N；
 * - level 与 accumulation 两套半分辨率金字塔：
 *   2 × 8 × (N/4 + N/16 + ...) = 16N/3。
 */
export const VGPU_GLOW_WORKING_SET_BYTES_PER_PIXEL = 76 / 3;

export function estimateVgpuGlowSinglePassBytes(
  width: number,
  height: number
): number {
  return VGPU_GLOW_SINGLE_PASS_RESERVE_BYTES
    + width * height * VGPU_GLOW_WORKING_SET_BYTES_PER_PIXEL;
}

/**
 * 只有 VGPU 辉光使用工作集预算。普通柔光继续走原有纹理池与像素上限，避免无谓分块。
 */
export function canRenderVgpuGlowInSinglePass(
  width: number,
  height: number,
  maxTextureDimension?: number
): boolean {
  if (typeof maxTextureDimension === 'number'
    && Math.max(width, height) > maxTextureDimension) {
    return false;
  }
  return estimateVgpuGlowSinglePassBytes(width, height)
    <= VGPU_GLOW_SINGLE_PASS_BUDGET_BYTES;
}

export interface WebGpuDiffusionExportOptions {
  width: number;
  height: number;
  recipe: DiffusionRecipe;
  format: ImageEditExportFormat;
  quality?: number;
  tileSize?: number;
  halo?: number;
  globalScatterMaxDimension?: number;
  /** 设备纹理边长上限；决定整图能否一次渲染完。 */
  maxTextureDimension?: number;
  isCancelled: () => boolean;
  onProgress: (completedTiles: number, totalTiles: number) => void;
  renderGlobal: (width: number, height: number) => Promise<ImageBitmap>;
  /**
   * 按整图降采样算一张全局散射，返回释放句柄。分块路径下所有块共用它，
   * 因此块边界不会出现亮度台阶。
   */
  buildGlobalScatter?: (
    width: number,
    height: number
  ) => Promise<{ release: () => void }>;
  renderTile: (tile: {
    index: number;
    expandedX: number;
    expandedY: number;
    expandedWidth: number;
    expandedHeight: number;
    /** 本块在整图里的归一化区域，用于从全局散射中取对应的一片。 */
    scatterRegion: readonly [number, number, number, number];
  }) => Promise<ImageBitmap>;
  postProcess?: (canvas: OffscreenCanvas) => Promise<OffscreenCanvas | void>;
}

export interface WebGpuDiffusionExportResult {
  bytes: Uint8Array;
  width: number;
  height: number;
}

/**
 * 分块能否重建出这个配方的散射。
 *
 * 块只看得见自己那点内容加上 halo，所以只有当最宽的散射核落在 halo 里时，分块结果
 * 才可能和整图一致。三种模式现在共用散射金字塔，最宽尺度都远大于常规 halo，
 * 无论怎么调混合系数，块内各算各的都会在块边界留下亮度台阶。
 */
function tilesCanReproduceScatter(
  recipe: DiffusionRecipe,
  halo: number
): boolean {
  const widest = Math.max(...recipe.scatterLevels
    .filter((level) => level.weight[1] > 0)
    .map((level) => level.divisor));
  return widest <= halo;
}

function canRenderInSinglePass(options: WebGpuDiffusionExportOptions): boolean {
  const limit = options.maxTextureDimension;
  if (typeof limit === 'number' && Math.max(options.width, options.height) > limit) {
    return false;
  }
  return options.width * options.height <= DIFFUSION_SINGLE_PASS_MAX_PIXELS;
}

export async function renderDiffusionExport(
  options: WebGpuDiffusionExportOptions
): Promise<WebGpuDiffusionExportResult> {
  const plan = createImageEditExportPlan(options.width, options.height, {
    tileSize: options.tileSize,
    halo: options.halo,
    globalScatterMaxDimension: options.globalScatterMaxDimension
      ?? IMAGE_EDIT_GLOBAL_SCATTER_MAX_DIMENSION,
  });
  const output = new OffscreenCanvas(options.width, options.height);
  const context = output.getContext('2d');
  if (!context) throw new Error('OffscreenCanvas 2D context 不可用');
  assertNotCancelled(options.isCancelled);

  // 散射比 halo 宽就不能分块。这时整图一次渲染既是唯一无缝的做法，也让导出和预览
  // 走上同一条路径——预览本来就是整图一次渲染的。
  if (!tilesCanReproduceScatter(options.recipe, plan.halo)
    && canRenderInSinglePass(options)) {
    const whole = await options.renderGlobal(options.width, options.height);
    try {
      context.drawImage(whole, 0, 0);
    } finally {
      whole.close();
    }
    options.onProgress(plan.totalTiles, plan.totalTiles);
    return await encodeOutput(output, options);
  }

  // 散射按整图降采样只算一次，所有块共用；块只补自己那片的全分辨率底图。
  // 散射是低频的，降采样算不掉什么；而让每块各算各的，块边界必然对不上。
  const scatter = await options.buildGlobalScatter?.(
    plan.globalScatterWidth,
    plan.globalScatterHeight
  );
  try {
    for (const tile of plan.tiles) {
      assertNotCancelled(options.isCancelled);
      const bitmap = await options.renderTile({
        ...tile,
        scatterRegion: [
          tile.expandedX / options.width,
          tile.expandedY / options.height,
          tile.expandedWidth / options.width,
          tile.expandedHeight / options.height,
        ],
      });
      try {
        context.drawImage(
          bitmap,
          tile.cropX,
          tile.cropY,
          tile.width,
          tile.height,
          tile.x,
          tile.y,
          tile.width,
          tile.height
        );
      } finally {
        bitmap.close();
      }
      options.onProgress(tile.index + 1, plan.totalTiles);
    }
  } finally {
    scatter?.release();
  }

  return await encodeOutput(output, options);
}

async function encodeOutput(
  output: OffscreenCanvas,
  options: WebGpuDiffusionExportOptions
): Promise<WebGpuDiffusionExportResult> {
  assertNotCancelled(options.isCancelled);
  const finalOutput = await options.postProcess?.(output) ?? output;
  assertNotCancelled(options.isCancelled);
  const blob = await finalOutput.convertToBlob({
    type: options.format,
    quality: options.quality,
  });
  return {
    bytes: new Uint8Array(await blob.arrayBuffer()),
    width: finalOutput.width,
    height: finalOutput.height,
  };
}

/**
 * 把配方换算到「整图降采样后」的分辨率上，供全局散射使用。
 *
 * 和 `rebaseDiffusionRecipeForTile` 的区别正是这次最容易搞错的地方：
 * 块是**全分辨率裁剪**，绝对像素量（scatterLevels.divisor）不变、归一化量（scales.radius）
 * 要换算；而这里是**整图缩图**，归一化量天然不变、绝对像素量必须跟着缩。
 * 两个函数长得像，但换算的方向恰好相反，不要合并。
 */
export function rebaseDiffusionRecipeForScale(
  recipe: DiffusionRecipe,
  width: number,
  height: number
): DiffusionRecipe {
  const referenceDimension = Math.max(width, height);
  const scale = referenceDimension / recipe.image.referenceDimension;
  return {
    ...recipe,
    image: {
      width,
      height,
      referenceDimension,
      aspectCorrection: [referenceDimension / width, referenceDimension / height],
    },
    scatterLevels: rebaseScatterLevelsForScale(recipe.scatterLevels, scale),
  };
}

export function rebaseDiffusionRecipeForTile(
  recipe: DiffusionRecipe,
  width: number,
  height: number
): DiffusionRecipe {
  const referenceDimension = Math.max(width, height);
  const radiusScale = recipe.image.referenceDimension / referenceDimension;
  return {
    ...recipe,
    image: {
      width,
      height,
      referenceDimension,
      aspectCorrection: [
        referenceDimension / width,
        referenceDimension / height,
      ],
    },
    scales: recipe.scales.map((scale) => ({
      ...scale,
      radius: Math.min(1, scale.radius * radiusScale),
    })),
    // scatterLevels 刻意不动：divisor 是绝对像素数，而块是全分辨率的裁剪而非缩图，
    // 同一个 divisor 在块内本来就代表同样大小的散射。scales.radius 需要换算是因为
    // 它按 referenceDimension 归一化过（模糊着色器里再乘 aspectCorrection 还原成像素），
    // 参照系一变就必须跟着变。两者形态不同，不要顺手一起换算。
  };
}

/**
 * 把原配方的归一化散射尺度投影到缩图后的 2× mip 网格。
 *
 * 不能简单把 divisor 乘缩放率并取整：例如 2,4,8 可能会变成 2,2,3，后两级不再是
 * 相邻 mip，固定小核又会开始跨区欠采样。这里把每一级能量按 log2 距离分配到相邻的
 * 2^n 层，既保留总能量和相对半径，也保证金字塔每步只降一半。
 */
function rebaseScatterLevelsForScale(
  levels: DiffusionRecipe['scatterLevels'],
  scale: number
): DiffusionRecipe['scatterLevels'] {
  const maximumTarget = Math.max(2, ...levels.map((level) => level.divisor * scale));
  const count = Math.max(1, Math.ceil(Math.log2(maximumTarget)));
  const divisors = Array.from({ length: count }, (_, index) => 2 ** (index + 1));
  const channelWeights = divisors.map(() => [0, 0, 0]);

  for (const level of levels) {
    const target = Math.max(2, level.divisor * scale);
    const position = Math.max(0, Math.min(count - 1, Math.log2(target) - 1));
    const lower = Math.floor(position);
    const upper = Math.min(count - 1, lower + 1);
    const upperAmount = position - lower;
    for (const channel of [0, 1, 2] as const) {
      channelWeights[lower][channel] += level.weight[channel] * (1 - upperAmount);
      channelWeights[upper][channel] += level.weight[channel] * upperAmount;
    }
  }

  for (const channel of [0, 1, 2] as const) {
    const total = channelWeights.reduce((sum, weight) => sum + weight[channel], 0);
    if (total <= 0) continue;
    for (const weight of channelWeights) weight[channel] /= total;
  }

  return divisors.map((divisor, index) => ({
    divisor,
    weight: [
      channelWeights[index][0],
      channelWeights[index][1],
      channelWeights[index][2],
    ] as const,
  }));
}

function assertNotCancelled(isCancelled: () => boolean): void {
  if (isCancelled()) {
    throw new DOMException('图片编辑任务已取消', 'AbortError');
  }
}
