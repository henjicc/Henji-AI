import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderDiffusionExport, rebaseDiffusionRecipeForTile } from './exportRenderer';
import { compileDiffusionRecipe } from '../diffusionRecipe';
import { createDefaultDiffusionOperationParams } from '../diffusionParams';
import type { DiffusionMode } from '../types';

/**
 * 分块导出只能重建落在 halo 内的散射。辉光的最宽尺度是长边的一半（3840 的图就是
 * 1920px），halo 只有 64px，块只看得见自己那点内容，块边界必然出现亮度台阶——
 * 实测就是导出图上沿 1536 网格的一圈矩形边框。这里钉住「散射比 halo 宽就必须整图
 * 一次渲染」，避免以后改了尺度区间又悄悄退回分块。
 */

interface RenderCalls {
  global: { width: number; height: number }[];
  tiles: number;
}

function createFakeBitmap(): ImageBitmap {
  return { width: 1, height: 1, close: vi.fn() } as unknown as ImageBitmap;
}

function stubCanvas(): void {
  vi.stubGlobal('OffscreenCanvas', class {
    constructor(public width: number, public height: number) {}
    getContext(): unknown {
      return { drawImage: vi.fn(), save: vi.fn(), restore: vi.fn(), globalAlpha: 1 };
    }
    convertToBlob(): Promise<Blob> {
      return Promise.resolve({ arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) } as Blob);
    }
  });
}

async function runExport(
  mode: DiffusionMode,
  size: { width: number; height: number }
): Promise<RenderCalls> {
  const calls: RenderCalls = { global: [], tiles: 0 };
  const recipe = compileDiffusionRecipe(
    { ...createDefaultDiffusionOperationParams(), mode },
    { ...size, quality: 'high' }
  );
  await renderDiffusionExport({
    ...size,
    recipe,
    format: 'image/png',
    maxTextureDimension: 8192,
    isCancelled: () => false,
    onProgress: () => undefined,
    renderGlobal: async (width, height) => {
      calls.global.push({ width, height });
      return createFakeBitmap();
    },
    renderTile: async () => {
      calls.tiles += 1;
      return createFakeBitmap();
    },
  });
  return calls;
}

describe('柔光导出分块策略', () => {
  beforeEach(() => { stubCanvas(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('辉光整图一次渲染，不走分块', async () => {
    const calls = await runExport('glow', { width: 3840, height: 2160 });

    expect(calls.tiles).toBe(0);
    expect(calls.global).toEqual([{ width: 3840, height: 2160 }]);
  });

  /**
   * 黑柔/白柔的远端半径上限是长边的 0.2（3840 的图就是 768px），同样远超 64px halo，
   * 因此也不该分块。分块留给超出单遍预算的超大图。
   */
  it('黑柔与白柔同样整图一次渲染', async () => {
    for (const mode of ['black_mist', 'white_mist'] as const) {
      const calls = await runExport(mode, { width: 3840, height: 2160 });
      expect(calls.tiles, mode).toBe(0);
      expect(calls.global, mode).toEqual([{ width: 3840, height: 2160 }]);
    }
  });

  it('超出单遍像素预算时退回分块', async () => {
    const calls = await runExport('glow', { width: 12000, height: 8000 });

    expect(calls.tiles).toBeGreaterThan(1);
    // 分块路径下 renderGlobal 只用来铺低分辨率底，尺寸受 globalScatterMaxDimension 约束
    expect(Math.max(calls.global[0].width, calls.global[0].height)).toBe(2048);
  });
});

describe('Tile 重基准', () => {
  /**
   * scales.radius 按 referenceDimension 归一化，换参照系必须换算；
   * glow.levels.divisor 是绝对像素数，而块是全分辨率裁剪不是缩图，换算反而会错。
   * 两者形态不同，容易被顺手一起改掉。
   */
  it('归一化半径跟着参照系换算，绝对像素的辉光层级保持不变', () => {
    const recipe = compileDiffusionRecipe(
      { ...createDefaultDiffusionOperationParams(), mode: 'glow' },
      { width: 6000, height: 4000, quality: 'high' }
    );
    const tileRecipe = rebaseDiffusionRecipeForTile(recipe, 1664, 1664);

    expect(tileRecipe.scales[0].radius * tileRecipe.image.referenceDimension)
      .toBeCloseTo(recipe.scales[0].radius * recipe.image.referenceDimension, 10);
    expect(tileRecipe.glow.levels.map((level) => level.divisor))
      .toEqual(recipe.glow.levels.map((level) => level.divisor));
  });
});
