import { describe, expect, it } from 'vitest';
import { resolveUpscaleComparisonSource } from './upscaleComparison';

const toDisplay = (path: string) => path.startsWith('/') ? `henji-media://local${path}` : path;
const data = {
  sourceCapabilityId: 'image.upscale', imageUrl: '/result.png',
  generationInputImages: ['/original.png'],
};

describe('高清对比来源', () => {
  it('读取当次输入快照，支持本地路径与展示地址匹配', () => {
    expect(resolveUpscaleComparisonSource(data, toDisplay('/result.png'), toDisplay))
      .toBe(toDisplay('/original.png'));
  });
  it.each([
    undefined,
    { ...data, sourceCapabilityId: 'image.element-edit' },
    { ...data, generationInputImages: undefined },
    { ...data, generationInputImages: [] },
    { ...data, generationInputImages: ['/a.png', '/b.png'] },
    { ...data, generationInputImages: [null] },
    { ...data, generationInputImages: [' '] },
  ])('普通图片及缺少可靠原图的历史结果不猜测原图', (candidate) => {
    expect(resolveUpscaleComparisonSource(candidate, toDisplay('/result.png'), toDisplay)).toBeNull();
  });
  it('翻到另一张结果不沿用旧结果的原图', () => {
    expect(resolveUpscaleComparisonSource(data, '/another.png', toDisplay)).toBeNull();
  });
});
