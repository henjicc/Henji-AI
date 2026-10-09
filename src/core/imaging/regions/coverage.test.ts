import { describe, expect, it } from 'vitest';
import { combineRegionCoverage, evaluateRegionProgram, rasterizeRegionGeometry, sampleRegionCoverage, staticRegionContext, createProgramRegionSource, readRegionSource } from './index';

describe('共享区域覆盖', () => {
  it('保留半透明覆盖，布尔与笔迹合成语义明确', () => {
    expect(combineRegionCoverage(0.4, 0.3, 'add')).toBe(0.4);
    expect(combineRegionCoverage(0.4, 0.3, 'subtract')).toBeCloseTo(0.1);
    expect(combineRegionCoverage(0.4, 0.3, 'intersect')).toBe(0.3);
    expect(combineRegionCoverage(0.4, 0.3, 'paint')).toBeCloseTo(0.58);
    expect(combineRegionCoverage(0.4, 0.3, 'erase')).toBeCloseTo(0.28);
    const rect = rasterizeRegionGeometry(2, 1, 0, 0, { type: 'rectangle', x: 0.25, y: 0, width: 1, height: 1 });
    expect([...rect]).toEqual([0.75, 0.25]);
  });
  it('浮点双线性采样使用像素中心与显式缺省值', () => {
    const coverage = { x: 0, y: 0, width: 2, height: 1, data: new Float32Array([0.25, 0.75]) };
    expect(sampleRegionCoverage(coverage, 1, 0.5, 1)).toBe(0.5);
    expect(sampleRegionCoverage(coverage, -0.5, 0.5, 1)).toBe(1);
  });
  it('变换后的压缩模型输入转浮点；画外和奇异矩阵分别拒绝覆盖与求值', () => {
    const shape = { type: 'mask' as const, width: 2, height: 1, matrix: [0.5, 0, 0, 1, 0.25, 0] as const,
      runs: [[0, 1, 64], [1, 1, 192]] as const };
    const program = { operations: [{ shape, combine: 'replace' as const }], feather: 0, inverted: false };
    const result = evaluateRegionProgram(program, { width: 4, height: 1 }, { x: -1, y: 0, width: 6, height: 1 });
    expect([...result]).toEqual([0, 0, expect.closeTo(64 / 255, 6), expect.closeTo(192 / 255, 6), 0, 0]);
    expect(() => evaluateRegionProgram({ ...program, operations: [{ ...program.operations[0], shape: { ...shape, matrix: [0, 0, 0, 0, 0, 0] } }] }, { width: 4, height: 1 }, { x: 0, y: 0, width: 1, height: 1 })).toThrow('不可逆');
  });
  it('源时间传给注入 provider；跟踪缺帧不能沿用上一帧，取消后拒绝返回', async () => {
    const grid = { width: 4, height: 4 }, roi = { x: 0, y: 0, width: 2, height: 2 };
    const source = createProgramRegionSource(context => {
      if (context.time.kind !== 'frame' || context.time.ticks !== 7) throw new Error('该帧跟踪区域不可用');
      return { operations: [], inverted: true, feather: 0 };
    });
    const context = { ...staticRegionContext(grid, 'source-v2'), time: { kind: 'frame' as const, ticks: 7, timeBase: [1, 24] as const, frameId: '7' } };
    expect(typeof source.defaultValue === 'function' ? source.defaultValue(context) : source.defaultValue).toBe(1);
    expect([...(await readRegionSource(source, roi, context)).data]).toEqual([1, 1, 1, 1]);
    await expect(readRegionSource(source, roi, { ...context, time: { ...context.time, ticks: 8 } })).rejects.toThrow('不可用');
    const abort = new AbortController();
    const delayed = { defaultValue: 0, read: async () => { abort.abort(); return { ...roi, data: new Float32Array(4) }; } };
    await expect(readRegionSource(delayed, roi, { ...context, signal: abort.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });
});
