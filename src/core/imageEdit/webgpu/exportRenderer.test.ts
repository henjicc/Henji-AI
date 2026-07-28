import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  renderDiffusionExport,
  rebaseDiffusionRecipeForScale,
  rebaseDiffusionRecipeForTile,
} from './exportRenderer';
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
  scatter: { width: number; height: number }[];
  scatterReleased: number;
  tiles: number;
  regions: (readonly [number, number, number, number])[];
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
  const calls: RenderCalls = {
    global: [], scatter: [], scatterReleased: 0, tiles: 0, regions: [],
  };
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
    buildGlobalScatter: async (width, height) => {
      calls.scatter.push({ width, height });
      return { release: () => { calls.scatterReleased += 1; } };
    },
    renderTile: async (tile) => {
      calls.tiles += 1;
      calls.regions.push(tile.scatterRegion);
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
   * 黑柔/白柔的远端半径上限分别约为长边的 1/8、1/5，同样远超 64px halo，
   * 因此也不该分块。分块留给超出单遍预算的超大图。
   */
  it('黑柔与白柔同样整图一次渲染', async () => {
    for (const mode of ['black_mist', 'white_mist'] as const) {
      const calls = await runExport(mode, { width: 3840, height: 2160 });
      expect(calls.tiles, mode).toBe(0);
      expect(calls.global, mode).toEqual([{ width: 3840, height: 2160 }]);
    }
  });

  /**
   * 超大图仍要分块，但散射必须只算一次全局的、所有块共用——这正是块边界不再出现
   * 亮度台阶的原因。块自己算各自的散射就会重现那圈矩形边框。
   */
  it('超出单遍像素预算时分块，但散射只算一次全局的供所有块共用', async () => {
    const calls = await runExport('glow', { width: 12000, height: 8000 });

    expect(calls.tiles).toBeGreaterThan(1);
    expect(calls.scatter).toHaveLength(1);
    expect(Math.max(calls.scatter[0].width, calls.scatter[0].height)).toBe(2048);
    expect(calls.scatterReleased).toBe(1);
    // 分块路径不再需要整图合成来铺底，底图由各块的全分辨率结果直接拼出。
    expect(calls.global).toHaveLength(0);
  });

  it('每块拿到自己在整图里的归一化散射区域', async () => {
    const size = { width: 12000, height: 8000 };
    const calls = await runExport('glow', size);

    expect(calls.regions).toHaveLength(calls.tiles);
    // 第一块贴在左上角，起点必须是 0；否则散射会整体错位。
    expect(calls.regions[0][0]).toBe(0);
    expect(calls.regions[0][1]).toBe(0);
    for (const [offsetX, offsetY, scaleX, scaleY] of calls.regions) {
      expect(offsetX + scaleX).toBeLessThanOrEqual(1 + 1e-9);
      expect(offsetY + scaleY).toBeLessThanOrEqual(1 + 1e-9);
      expect(scaleX).toBeGreaterThan(0);
      expect(scaleY).toBeGreaterThan(0);
    }
  });
});

describe('Tile 重基准', () => {
  /**
   * scales.radius 按 referenceDimension 归一化，换参照系必须换算；
   * scatterLevels.divisor 是绝对像素数，而块是全分辨率裁剪不是缩图，换算反而会错。
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
    expect(tileRecipe.scatterLevels.map((level) => level.divisor))
      .toEqual(recipe.scatterLevels.map((level) => level.divisor));
  });

  /**
   * 缩图重基准的换算方向和裁剪重基准恰好相反：整图缩小时归一化量天然不变，
   * 绝对像素量必须跟着缩。两个函数长得像，合并或抄错方向都会让全局散射的尺度错位。
   */
  it('缩图重基准把绝对像素的辉光层级按比例缩小，归一化尺度保持不变', () => {
    const recipe = compileDiffusionRecipe(
      { ...createDefaultDiffusionOperationParams(), mode: 'glow' },
      { width: 6000, height: 4000, quality: 'high' }
    );
    const scaled = rebaseDiffusionRecipeForScale(recipe, 2048, 1365);

    expect(scaled.image.referenceDimension).toBe(2048);
    for (let index = 1; index < scaled.scatterLevels.length; index += 1) {
      expect(scaled.scatterLevels[index].divisor)
        .toBe(scaled.scatterLevels[index - 1].divisor * 2);
    }
    for (const channel of [0, 1, 2] as const) {
      const normalizedMean = (
        target: typeof recipe,
        levels: typeof recipe.scatterLevels
      ): number => levels.reduce(
        (sum, level) => sum + level.divisor * level.weight[channel],
        0
      ) / target.image.referenceDimension;
      expect(normalizedMean(scaled, scaled.scatterLevels))
        .toBeCloseTo(normalizedMean(recipe, recipe.scatterLevels), 2);
    }
  });
});
