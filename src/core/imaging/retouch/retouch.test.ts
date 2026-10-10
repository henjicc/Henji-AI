import { describe, expect, it } from 'vitest';
import { PaintDabGenerator, type PaintSurface } from '../paint';
import { applyRetouchTextureDonor, rasterizeRetouchDabs, completeRetouchTexture, type RetouchPixels } from './index';
import { evaluationCacheIdentity, type EvaluationContext } from '../evaluation';

function pixels(w = 32, h = 16): RetouchPixels {
  const data = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set([x / w * 2, y / h - .2, .25, .5], (y * w + x) * 4);
  return { width: w, height: h, originX: 0, originY: 0, data };
}
function surface(p: RetouchPixels): PaintSurface { return { width: p.width, height: p.height, originX: p.originX, originY: p.originY, before: new Float32Array(p.data), output: new Float32Array(p.data), coverage: new Float32Array(p.width * p.height) }; }
describe('共享连续修饰', () => {
  it('有理源时间和源版本参与身份，宿主取消的帧样本不能计算', () => {
    const p = pixels(), context: EvaluationContext = { target: { kind: 'video_edit.clip', id: 'clip' }, sourceVersion: '1',
      time: { kind: 'frame', ticks: 12, timeBase: [1, 24], frameId: 'source-frame-12' }, referenceGrid: { width: 32, height: 16 },
      roi: { x: 0, y: 0, width: 32, height: 16 }, color: { workingSpace: 'srgb', transferFunction: 'linear', alpha: 'premultiplied', precision: 'float32' }, quality: 'final', signal: AbortSignal.abort() };
    expect(evaluationCacheIdentity(context)).not.toBe(evaluationCacheIdentity({ ...context, sourceVersion: '2' }));
    expect(() => rasterizeRetouchDabs(surface(p), [], { size: 8, opacity: 1, hardness: 1 }, { mode: 'clone', offset: { x: 1, y: 0 }, source: p, destination: p, healingRadius: 0, context })).toThrow();
    expect(() => completeRetouchTexture({ pixels: p, coverage: new Float32Array(512), context })).toThrow();
  });
  it('旧源不反馈，流量叠加/整笔透明度/软选区只作用一次，HDR和负值不截断', () => {
    const p = pixels(), s = surface(p), original = new Float32Array(p.data), brush = { size: 8, opacity: .4, flow: .5, hardness: 1, pressureSize: false };
    s.clip = new Float32Array(p.width * p.height).fill(.5);
    const dabs = new PaintDabGenerator(brush).append([{ x: 8.5, y: 8.5 }]);
    const source = { mode: 'clone' as const, offset: { x: 12, y: 0 }, source: p, destination: p, healingRadius: 0 };
    rasterizeRetouchDabs(s, dabs, brush, source); rasterizeRetouchDabs(s, dabs, brush, source);
    const i = (8 * 32 + 8) * 4, amount = .75 * .4 * .5;
    expect(s.output[i]).toBeCloseTo(original[i] * (1 - amount * .5) + original[i + 12 * 4] * amount);
    expect(s.output[i + 1]).toBeLessThan(original[i + 1] + .1);
    expect(p.data).toEqual(original);
    expect(s.output[i + 3]).toBeCloseTo(.5 + .5 * .5 * amount);
  });
  it('跨瓦片/事件分批与整幅结果逐像素相同，修复保持透明度', () => {
    const p = pixels(40, 16), full = surface(p), brush = { size: 12, hardness: .7, opacity: .6, flow: .4 };
    const gen = new PaintDabGenerator(brush), ds = [...gen.append([{ x: 10, y: 8 }, { x: 30, y: 9 }]), ...gen.finish()];
    const spec = { mode: 'heal' as const, offset: { x: -3, y: 0 }, source: p, destination: p, healingRadius: 4 };
    rasterizeRetouchDabs(full, ds, brush, spec);
    for (const ox of [0, 20]) {
      const data = new Float32Array(20 * 16 * 4);
      for (let y = 0; y < 16; y++) data.set(p.data.subarray((y * 40 + ox) * 4, (y * 40 + ox + 20) * 4), y * 20 * 4);
      const tile = surface({ width: 20, height: 16, originX: ox, originY: 0, data });
      rasterizeRetouchDabs(tile, ds.slice(0, 3), brush, spec); rasterizeRetouchDabs(tile, ds.slice(3), brush, spec);
      for (let y = 0; y < 16; y++) expect(tile.output.slice(y * 80, (y + 1) * 80)).toEqual(full.output.slice((y * 40 + ox) * 4, (y * 40 + ox + 20) * 4));
      for (let i = 3; i < tile.output.length; i += 4) expect(tile.output[i]).toBe(.5);
    }
  });
  it('不存在的供体透明，不能用边界伸展掩盖缺来源；取消时间样本拒绝', () => {
    const p = pixels(), s = surface(p), brush = { size: 8, hardness: 1, opacity: 1 };
    const ds = new PaintDabGenerator(brush).append([{ x: 8, y: 8 }]);
    expect(rasterizeRetouchDabs(s, ds, brush, { mode: 'clone', offset: { x: 1000, y: 0 }, source: p, destination: p, healingRadius: 0 })).toBe(false);
    expect(s.output).toEqual(s.before);
  });
});
describe('纹理搜索', () => {
  it('大图分块供体排除原选区，原尺寸高频、HDR、alpha和软覆盖仅混合一次', () => {
    const target = pixels(3, 1), donor = pixels(3, 1), coverage = Float32Array.of(.5, 1, 0), excluded = Float32Array.of(1, 0, 0);
    donor.data[0] = 9; donor.data[4] = 3;
    const output = new Float32Array(target.data), resolved = new Uint8Array(3);
    expect(applyRetouchTextureDonor(target, coverage, donor, excluded, output, resolved)).toBe(1);
    expect(output[0]).toBe(target.data[0]); expect(output[4]).toBe(3); expect(output[7]).toBe(.5);
    excluded[0] = 0;
    expect(applyRetouchTextureDonor(target, coverage, donor, excluded, output, resolved)).toBe(0);
    expect(output[0]).toBeCloseTo(4.5); expect(output[4]).toBe(3); expect(output.subarray(8)).toEqual(target.data.subarray(8));
    donor.data.fill(0);
    expect(applyRetouchTextureDonor(target, coverage, donor, excluded, output, resolved)).toBe(0);
    expect(output[0]).toBeCloseTo(4.5);
  });
  it('确定性、排除损坏供体、重复纹理相位、软覆盖、非选区与alpha精确保留', () => {
    const p = pixels(64, 64), mask = new Float32Array(64 * 64), truth = new Float32Array(p.data);
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
      const i = y * 64 + x; truth.set([(x % 8) / 8 * 1.5, (y % 8) / 8 - .2, .3, .5], i * 4);
      p.data.set(truth.subarray(i * 4, i * 4 + 4), i * 4);
      if (x >= 20 && x < 40 && y >= 20 && y < 40) { mask[i] = x === 20 ? .5 : 1; p.data[i * 4] = 5; p.data[i * 4 + 1] = 0; }
    }
    const a = completeRetouchTexture({ pixels: p, coverage: mask, seed: 13 }), b = completeRetouchTexture({ pixels: p, coverage: mask, seed: 13 });
    expect(a.data).toEqual(b.data);
    for (let i = 0; i < mask.length; i++) for (let c = 0; c < 4; c++) {
      if (!mask[i] || c === 3) expect(a.data[i * 4 + c]).toBe(p.data[i * 4 + c]);
      else expect(a.data[i * 4 + c]).toBeCloseTo(p.data[i * 4 + c] * (1 - mask[i]) + truth[i * 4 + c] * mask[i], 5);
    }
  });
  it('无背景明确拒绝，不制造黑图成功', () => {
    const p = pixels(); expect(() => completeRetouchTexture({ pixels: p, coverage: new Float32Array(p.width * p.height).fill(1) })).toThrow('背景');
  });
});
