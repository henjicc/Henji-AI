import { describe, expect, it } from 'vitest';
import { PaintDabGenerator, paintPressure, rasterizePaintDabs, rasterizePaintFill, samplePaintGradient, type PaintBrush, type PaintSurface } from './index';

const brush: PaintBrush = { size: 8, hardness: .6, opacity: .4, flow: .2, spacing: .13, smoothing: .4, texture: .3, scatter: .4, seed: 87, pressureSize: true, pressureFlow: true, tilt: true, tip: 'chisel' };
function surface(width = 32, channels = 1, originX = 0): PaintSurface {
  return { width, height: 16, originX, originY: 0, before: new Float32Array(width * 16 * channels), output: new Float32Array(width * 16 * channels), coverage: new Float32Array(width * 16) };
}
describe('共享绘画内核', () => {
  it('固定种子和采样序列在不同事件分批中完全一致，尾点跟上平滑输入', () => {
    const points = [{ x: 2, y: 4, pressure: .2 }, { x: 12, y: 6, pressure: .7, tiltX: 45 }, { x: 28, y: 8, pressure: 1 }];
    const a = new PaintDabGenerator(brush), b = new PaintDabGenerator(brush);
    const whole = [...a.append(points), ...a.finish()];
    expect([...b.append(points.slice(0, 1)), ...b.append(points.slice(1)), ...b.finish()]).toEqual(whole);
    expect(whole.at(-1)?.radius).toBe(4);
    expect(b.finish()).toEqual([]);
    const alternate = new PaintDabGenerator({ ...brush, seed: 88 });
    expect(alternate.append(points)).not.toEqual(whole.slice(0, -1));
  });
  it('压感大小与流量独立控制，曲线和倾角影响笔尖', () => {
    expect(paintPressure(.25, 'soft')).toBe(.5);
    expect(paintPressure(.5, 'firm')).toBe(.25);
    const [dab] = new PaintDabGenerator({ ...brush, pressureSize: false, pressureFlow: true }).append([{ x: 2, y: 3, pressure: .5, tiltX: 60 }]);
    expect(dab.radius).toBe(4); expect(dab.flow).toBe(.1); expect(dab.roundness).toBeLessThan(.3);
  });
  it('整笔透明度是上限，流量在笔内叠加，选区只作用一次', () => {
    const shape = { size: 8, hardness: 1, opacity: .4, flow: .5, pressureSize: false };
    const [dab] = new PaintDabGenerator(shape).append([{ x: 8.5, y: 8.5 }]);
    const target = surface(); target.clip = new Float32Array(32 * 16).fill(.5);
    rasterizePaintDabs(target, [dab], shape, { kind: 'mask', value: 1 }, 'brush');
    const index = 8 * 32 + 8; expect(target.output[index]).toBeCloseTo(.1);
    rasterizePaintDabs(target, [dab], shape, { kind: 'mask', value: 1 }, 'brush');
    expect(target.output[index]).toBeCloseTo(.15);
    rasterizePaintDabs(target, Array.from({ length: 40 }, () => dab), shape, { kind: 'mask', value: 1 }, 'brush');
    expect(target.output[index]).toBeCloseTo(.2);
  });
  it('瓦片顺序不影响纹理或覆盖，HDR橡皮按预乘比例擦除', () => {
    const g = new PaintDabGenerator(brush), dabs = [...g.append([{ x: 3, y: 8 }, { x: 28, y: 8 }]), ...g.finish()];
    const full = surface(), left = surface(16), right = surface(16, 1, 16);
    for (const part of [right, left, full]) rasterizePaintDabs(part, dabs, brush, { kind: 'mask', value: 1 }, 'brush');
    for (let y = 0; y < 16; y++) expect([...full.output.slice(y * 32, (y + 1) * 32)]).toEqual([...left.output.slice(y * 16, (y + 1) * 16), ...right.output.slice(y * 16, (y + 1) * 16)]);
    const rgba = surface(1, 4); rgba.before.set([2, -1, .5, 1]); rgba.output.set(rgba.before);
    rasterizePaintFill(rgba, { kind: 'solid', target: { kind: 'rgba', color: [0, 0, 0, .5] } }, 1, false);
    expect([...rgba.output.slice(0, 4)]).toEqual([1, -.5, .25, 1]);
    const shape = { size: 4, hardness: 1, opacity: .5, pressureSize: false };
    const d = new PaintDabGenerator(shape).append([{ x: .5, y: .5 }]);
    rasterizePaintDabs(rgba, d, shape, { kind: 'rgba', color: [0, 0, 0, 0] }, 'eraser');
    expect([...rgba.output.slice(0, 4)]).toEqual([1, -.5, .25, .5]);
  });
  it('线性/径向渐变在工作线性空间插值，支持透明色标与HDR', () => {
    const fill = { kind: 'linear' as const, start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, stops: [{ position: 0, color: [0, 0, 0, 0] as const }, { position: 1, color: [4, -2, 1, 1] as const }] };
    expect(samplePaintGradient(fill, 5, 0)).toEqual([2, -1, .5, .5]);
    expect(samplePaintGradient({ ...fill, kind: 'radial' }, 0, 5)).toEqual([2, -1, .5, .5]);
    expect(() => rasterizePaintFill(surface(), fill, 1, true)).toThrow('蒙版渐变');
    const abort = new AbortController(); abort.abort();
    expect(() => rasterizePaintFill(surface(), { kind: 'solid', target: { kind: 'mask', value: 1 } }, 1, true, abort.signal)).toThrow();
  });
});
