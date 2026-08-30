import { describe, expect, it } from 'vitest';
import {
  chooseViewportMip,
  createTileRegion,
  enumerateTilesForRect,
  gaussianBlurHalo,
  mipSize,
  planTileExecution,
  tileGridSize,
} from './tileGeometry';

describe('图片编辑 V3 瓦片几何', () => {
  const twoHundredMegapixels = { width: 20_000, height: 10_000 };

  it('只按视口选择 mip，不创建 200MP 全帧表面', () => {
    expect(chooseViewportMip(twoHundredMegapixels, { width: 1_440, height: 900 })).toBe(3);
    expect(mipSize(twoHundredMegapixels, 3)).toEqual({ width: 2_500, height: 1_250 });
    expect(tileGridSize(twoHundredMegapixels, 0)).toEqual({ width: 40, height: 20 });
  });

  it('在图片边缘裁剪 halo，并保持输出瓦片坐标不变', () => {
    expect(createTileRegion({ width: 1_000, height: 700 }, { mip: 0, x: 1, y: 1 }, 30))
      .toEqual({
        coordinate: { mip: 0, x: 1, y: 1 },
        outputRect: { x: 512, y: 512, width: 488, height: 188 },
        sourceRect: { x: 482, y: 482, width: 518, height: 218 },
        halo: 30,
      });
  });

  it('只枚举脏矩形覆盖的瓦片', () => {
    expect(enumerateTilesForRect(twoHundredMegapixels, 0, {
      x: 500,
      y: 500,
      width: 40,
      height: 40,
    })).toEqual([
      { mip: 0, x: 0, y: 0 },
      { mip: 0, x: 1, y: 0 },
      { mip: 0, x: 0, y: 1 },
      { mip: 0, x: 1, y: 1 },
    ]);
  });

  it('将文档坐标模糊半径转换为当前 mip 的三倍标准差 halo', () => {
    expect(gaussianBlurHalo(24, 0)).toBe(72);
    expect(gaussianBlurHalo(24, 2)).toBe(18);
  });

  it('只规划 200MP 瓦片数量和最坏工作集，并在预算允许时合并 supertile', () => {
    const plan = planTileExecution(twoHundredMegapixels, 0, {
      halo: gaussianBlurHalo(64, 0),
      bytesPerPixel: 8,
      workingSurfaceCount: 2,
      maxWorkingSetBytes: 32 * 1024 * 1024,
    });

    expect(plan).toMatchObject({
      storageGrid: { width: 40, height: 20 },
      executionGrid: { width: 20, height: 10 },
      storageTileCount: 800,
      executionUnitCount: 200,
      executionTileSize: 1024,
      halo: 192,
      maxSourceRegion: { width: 1408, height: 1408 },
      usesSupertile: true,
    });
    expect(plan.estimatedWorkingSetBytes).toBe(31_719_424);
  });

  it('supertile 超出单元预算时回退到 512，连单瓦片都容不下则拒绝规划', () => {
    const options = {
      halo: 192,
      bytesPerPixel: 8,
      workingSurfaceCount: 2,
      maxWorkingSetBytes: 16 * 1024 * 1024,
    } as const;
    expect(planTileExecution(twoHundredMegapixels, 0, options)).toMatchObject({
      executionTileSize: 512,
      executionUnitCount: 800,
      maxSourceRegion: { width: 896, height: 896 },
      estimatedWorkingSetBytes: 12_845_056,
      usesSupertile: false,
    });
    expect(() => planTileExecution(twoHundredMegapixels, 0, {
      ...options,
      maxWorkingSetBytes: 12 * 1024 * 1024,
    })).toThrow('工作集预算不足');
  });
});
