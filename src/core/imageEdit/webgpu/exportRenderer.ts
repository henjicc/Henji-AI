import type { DiffusionRecipe } from '../diffusionRecipe';
import {
  createImageEditExportPlan,
  IMAGE_EDIT_GLOBAL_SCATTER_MAX_DIMENSION,
} from '../worker/exportPrototype';
import type { ImageEditExportFormat } from '../worker/protocol';

export interface WebGpuDiffusionExportOptions {
  width: number;
  height: number;
  recipe: DiffusionRecipe;
  format: ImageEditExportFormat;
  quality?: number;
  tileSize?: number;
  halo?: number;
  globalScatterMaxDimension?: number;
  isCancelled: () => boolean;
  onProgress: (completedTiles: number, totalTiles: number) => void;
  renderGlobal: (width: number, height: number) => Promise<ImageBitmap>;
  renderTile: (tile: {
    index: number;
    expandedX: number;
    expandedY: number;
    expandedWidth: number;
    expandedHeight: number;
  }) => Promise<ImageBitmap>;
  postProcess?: (canvas: OffscreenCanvas) => Promise<OffscreenCanvas | void>;
}

export interface WebGpuDiffusionExportResult {
  bytes: Uint8Array;
  width: number;
  height: number;
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
  const global = await options.renderGlobal(
    plan.globalScatterWidth,
    plan.globalScatterHeight
  );
  try {
    context.drawImage(global, 0, 0, options.width, options.height);
  } finally {
    global.close();
  }

  const localBlend = Math.min(
    1,
    options.recipe.scales
      .slice(0, 3)
      .reduce((sum, scale) => sum + scale.weight, 0)
  );
  for (const tile of plan.tiles) {
    assertNotCancelled(options.isCancelled);
    const bitmap = await options.renderTile(tile);
    try {
      context.save();
      context.globalAlpha = localBlend;
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
      context.restore();
    } finally {
      bitmap.close();
    }
    options.onProgress(tile.index + 1, plan.totalTiles);
  }

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
  };
}

function assertNotCancelled(isCancelled: () => boolean): void {
  if (isCancelled()) {
    throw new DOMException('图片编辑任务已取消', 'AbortError');
  }
}
