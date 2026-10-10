import { describe, expect, it } from 'vitest';
import { assignRgbProfilePixels, colorSettingsSchema, decodeTransferFunctionV3, encodeTransferFunctionV3, linearWorkingSpaceMatrixV3 } from './index';

describe('共享 RGB 颜色契约', () => {
  it('指定配置保留编码值、透明度及负值；转换矩阵与指定具有不同语义', () => {
    const data = Float32Array.of(.12, -.02, .8, .5, 0, 0, 0, 0);
    const assigned = assignRgbProfilePixels(data, 'srgb', 'linear');
    expect(assigned[0]).toBeCloseTo(encodeTransferFunctionV3(.24, 'srgb') * .5, 6);
    expect(assigned[1]).toBeLessThan(0);
    expect(assigned[2]).toBeGreaterThan(.5);
    expect(assigned[3]).toBe(.5);
    expect([...assigned.slice(4)]).toEqual([0, 0, 0, 0]);
    expect(linearWorkingSpaceMatrixV3('srgb', 'display-p3')[0]).not.toBe(1);
    expect([...data]).toEqual([.12, -.02, .8, .5, 0, 0, 0, 0].map(Math.fround));
  });
  it.each(['linear', 'srgb', 'pq', 'hlg'] as const)('%s 在线性/编码往返中恢复合法范围', transfer => {
    const value = transfer === 'hlg' ? .7 : 1.7;
    expect(decodeTransferFunctionV3(encodeTransferFunctionV3(value, transfer), transfer)).toBeCloseTo(value, 5);
  });
  it('各原色矩阵往返保持 D65 白点且 HDR 设置有真实约束', () => {
    for (const target of ['srgb', 'display-p3', 'rec2020'] as const) {
      const matrix = linearWorkingSpaceMatrixV3('srgb', target);
      for (let row = 0; row < 3; row++) expect(matrix[row * 3] + matrix[row * 3 + 1] + matrix[row * 3 + 2]).toBeCloseTo(1, 7);
    }
    expect(colorSettingsSchema.safeParse({ mode: 'convert', workingSpace: 'srgb', bitDepth: 8, transferFunction: 'pq' }).success).toBe(false);
    expect(colorSettingsSchema.safeParse({ mode: 'assign', workingSpace: 'rec2020', bitDepth: 'float32', transferFunction: 'hlg' }).success).toBe(true);
  });
});
