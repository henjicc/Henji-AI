import type { DiffusionRecipe } from '../diffusionRecipe';
import {
  createImageEditExportPlan,
  IMAGE_EDIT_GLOBAL_SCATTER_MAX_DIMENSION,
} from '../worker/exportPrototype';
import type { ImageEditExportFormat } from '../worker/protocol';

/**
 * 整图单遍渲染的像素上限。
 *
 * 单遍需要同时持有底图、散射源、金字塔和输出，rgba16float 下大致是 4 倍图片面积
 * 乘 8 字节；四千万像素约 1.3GB 显存，再往上就该退回分块。四千万像素已经覆盖
 * 8K×5K，本应用的导出尺寸都在里面。
 */
const SINGLE_PASS_MAX_PIXELS = 40_000_000;

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
 * 才可能和整图一致。辉光的最宽尺度是长边的一半（3840 的图就是 1920px），而 halo 是
 * 64px——差了三十倍，无论怎么调混合系数都会在块边界留下亮度台阶。
 */
function tilesCanReproduceScatter(
  recipe: DiffusionRecipe,
  halo: number
): boolean {
  const widestNormalized = recipe.mode === 'glow'
    ? Math.max(...recipe.glow.levels
      .filter((level) => level.weight[1] > 0)
      .map((level) => level.divisor)) / recipe.image.referenceDimension
    : Math.max(...recipe.scales.map((scale) => scale.radius));
  return widestNormalized * recipe.image.referenceDimension <= halo;
}

function canRenderInSinglePass(options: WebGpuDiffusionExportOptions): boolean {
  const limit = options.maxTextureDimension;
  if (typeof limit === 'number' && Math.max(options.width, options.height) > limit) {
    return false;
  }
  return options.width * options.height <= SINGLE_PASS_MAX_PIXELS;
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
 * 块是**全分辨率裁剪**，绝对像素量（glow.levels.divisor）不变、归一化量（scales.radius）
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
    glow: {
      ...recipe.glow,
      levels: recipe.glow.levels.map((level) => ({
        ...level,
        divisor: Math.max(2, Math.round(level.divisor * scale)),
      })),
    },
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
    // glow.levels 刻意不动：divisor 是绝对像素数，而块是全分辨率的裁剪而非缩图，
    // 同一个 divisor 在块内本来就代表同样大小的散射。scales.radius 需要换算是因为
    // 它按 referenceDimension 归一化过（模糊着色器里再乘 aspectCorrection 还原成像素），
    // 参照系一变就必须跟着变。两者形态不同，不要顺手一起换算。
  };
}

function assertNotCancelled(isCancelled: () => boolean): void {
  if (isCancelled()) {
    throw new DOMException('图片编辑任务已取消', 'AbortError');
  }
}
