import { describe, expect, it } from 'vitest';
import { applySeamPlan, createSeamPlan, seamAnalysisSize, sampleSeamCoordinate } from '.';
import { resampleAffinePixels } from '../resample';
import type { EvaluationContext } from '../../evaluation';
import { seamSourceRegion, sampleSeamRegion } from './sampling';
const context: EvaluationContext = { target: { kind: 'image', id: 'sample' }, sourceVersion: '1', time: { kind: 'static' }, referenceGrid: { width: 4, height: 3 }, roi: { x: 0, y: 0, width: 4, height: 3 }, color: { workingSpace: 'srgb', transferFunction: 'linear', alpha: 'premultiplied', precision: 'float32' }, quality: 'final' };
const source = () => ({ width: 4, height: 3, originX: 0, originY: 0, data: Float32Array.from({ length: 48 }, (_, i) => i % 4 === 3 ? .5 : (Math.floor(i / 4) % 4 === 2 ? 2 : -.2)) });
describe('共享重采样与内容识别缩放', () => {
  it.each([{ width: Number.MAX_SAFE_INTEGER, height: 1 }, { width: 1, height: Number.MAX_SAFE_INTEGER }, { width: 2, height: 1_000_000_000 }])('细长图像 $width × $height 的分析仍受字节预算约束而不是像素上限', source => {
    const output = { width: Math.max(1, Math.floor(source.width / 2)), height: Math.max(1, Math.floor(source.height / 2)) }, budget = seamAnalysisSize(source, output);
    expect(Math.max(budget.source.width, budget.output.width) * Math.max(budget.source.height, budget.output.height) * 64).toBeLessThanOrEqual(8 * 1024 * 1024);
    if (source.width > 1) expect(budget.source.width).toBeGreaterThanOrEqual(2);
    if (source.height > 1) expect(budget.source.height).toBeGreaterThanOrEqual(2);
  });
  it.each([{ width: 3840, height: 2160 }, { width: 7680, height: 4320 }])('大图 $width × $height 保持 512 分块和原分辨率边界，不分配整图 RGBA', grid => {
    const pixels = source(), plan = createSeamPlan(pixels, pixels, { context });
    for (const region of [{ x: 0, y: 0, width: 512, height: 512 }, { x: grid.width - 512, y: grid.height - 512, width: 512, height: 512 }]) {
      const bounds = seamSourceRegion(plan, grid, region, grid);
      expect(bounds.width).toBeLessThanOrEqual(513); expect(bounds.height).toBeLessThanOrEqual(513);
      const roi = Float32Array.from({ length: bounds.width * bounds.height * 4 }, (_, i) => i % 4 === 3 ? .5 : i % 4 === 0 ? 2 : -.1);
      const sampled = sampleSeamRegion(plan, grid, region, grid, bounds, roi, 4);
      expect(sampled.byteLength).toBe(512 * 512 * 16); expect(sampled[0]).toBeCloseTo(2); expect(sampled.at(-1)).toBeCloseTo(.5);
    }
  });
  it('保持浮点 HDR/负值/透明度，RGBA 和软覆盖共用中心采样', () => {
    const pixels = source(), grid = { x: 0, y: 0, width: 4, height: 3 };
    expect([...resampleAffinePixels(pixels, grid, grid, [1, 0, 0, 1, 0, 0], 4)]).toEqual([...pixels.data]);
    const coverage = { width: 2, height: 1, data: Float32Array.of(.2, .8) };
    expect([...resampleAffinePixels(coverage, { x: 0, y: 0, width: 2, height: 1 }, { x: 0, y: 0, width: 4, height: 1 }, [2, 0, 0, 1, 0, 0], 1)]).toEqual([expect.closeTo(.15), expect.closeTo(.35), expect.closeTo(.65), expect.closeTo(.6)]);
  });
  it('保护高能量主体，缩小与补缝的同一位移场作用于 alpha 和软覆盖', () => {
    const pixels = source(), protect = new Float32Array(12); for (let y = 0; y < 3; y++) protect[y * 4 + 2] = 1;
    const plan = createSeamPlan(pixels, { width: 3, height: 3 }, { context, protect });
    expect([...applySeamPlan({ ...pixels, data: protect }, plan, { width: 3, height: 3 }, 1)].filter(v => v > .9)).toHaveLength(3);
    const result = applySeamPlan(pixels, plan, { width: 3, height: 3 }, 4);
    expect([...result].filter((_, i) => i % 4 === 3)).toEqual(Array(9).fill(.5));
    const enlarged = createSeamPlan(pixels, { width: 7, height: 5 }, { context, protect });
    expect(enlarged.coordinates).toHaveLength(70); expect(applySeamPlan(pixels, enlarged, { width: 7, height: 5 }, 4).every(Number.isFinite)).toBe(true);
  });
  it('代理边缘外推保留 8K 全分辨率位置，ROI 分块结果等于整体', () => {
    const pixels = source(), plan = createSeamPlan(pixels, pixels, { context });
    expect(sampleSeamCoordinate(plan, .0001, .9999)).toEqual([expect.closeTo(.0001), expect.closeTo(.9999)]);
    const region = { x: 1, y: 1, width: 2, height: 1 }, bounds = seamSourceRegion(plan, pixels, region, pixels), roi = new Float32Array(bounds.width * bounds.height * 4);
    for (let y = 0; y < bounds.height; y++) roi.set(pixels.data.subarray(((bounds.y + y) * pixels.width + bounds.x) * 4, ((bounds.y + y) * pixels.width + bounds.x + bounds.width) * 4), y * bounds.width * 4);
    expect([...sampleSeamRegion(plan, pixels, region, pixels, bounds, roi, 4)]).toEqual([...pixels.data.slice(20, 28)]);
    const budget = seamAnalysisSize({ width: 7680, height: 4320 }, { width: 9000, height: 5000 });
    expect(budget.output.width * budget.output.height * 64).toBeLessThan(8 * 1024 * 1024 * 1.02);
  });
  it('时间、源版本隔离缓存，取消及非法保护图明确失败', () => {
    const pixels = source(), controller = new AbortController(); controller.abort();
    expect(() => createSeamPlan(pixels, { width: 2, height: 2 }, { context: { ...context, signal: controller.signal } })).toThrow();
    expect(() => createSeamPlan(pixels, pixels, { context, protect: Float32Array.of(1) })).toThrow('保护区域');
    const first = createSeamPlan(pixels, pixels, { context }), second = createSeamPlan(pixels, pixels, { context: { ...context, time: { kind: 'frame', ticks: 1, timeBase: [1, 24], frameId: '1' } } });
    expect(first.identity).not.toBe(second.identity);
  });
});
