import { describe, expect, it } from 'vitest';
import { resolveUploadNodeSize } from './uploadNodeSizing';

describe('上传节点展示面积', () => {
  it.each(['1:1', '16:9', '9:16', '4:3', '3:4', '2:1'])('%s 保持比例和相近面积', (ratio) => {
    const size = resolveUploadNodeSize(ratio);
    const [w, h] = ratio.split(':').map(Number);
    expect(size.width / size.height).toBeCloseTo(w / h, 2);
    expect(Math.abs(size.width * size.height / (320 * 320) - 1)).toBeLessThan(0.005);
  });

  it.each(['100:1', '1:100'])('%s 限制极端比例的节点盒', ratio => {
    const size = resolveUploadNodeSize(ratio);
    expect(Math.max(size.width, size.height)).toBeLessThanOrEqual(640);
    expect(Math.min(size.width, size.height)).toBeGreaterThanOrEqual(64);
  });

  it('替换素材使用手动面积，并约束无效参考尺寸', () => {
    expect(resolveUploadNodeSize('9:16', { width: 800, height: 450 })).toEqual({ width: 450, height: 800 });
    expect(resolveUploadNodeSize('1:1', { width: NaN, height: 450 })).toEqual({ width: 320, height: 320 });
  });
});
