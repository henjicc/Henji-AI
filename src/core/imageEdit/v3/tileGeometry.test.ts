import { describe, expect, it } from 'vitest';
import {
  chooseViewportMip,
  createTileRegion,
  enumerateTilesForRect,
  gaussianBlurHalo,
  mipSize,
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
});
