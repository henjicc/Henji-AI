import { describe, expect, it } from 'vitest'
import { ScreenChangeAccumulator, planScreenChangeRefinement, screenFrameDifference, type ScreenChangeOptions } from './screenChanges'

const options = (patch: Partial<ScreenChangeOptions> = {}): ScreenChangeOptions => ({ width: 20, height: 10, channels: 3, fps: 5, startSeconds: 10, endSeconds: 20, ...patch })
function image(value = 0): Uint8Array { return new Uint8Array(20 * 10 * 3).fill(value) }
function popup(value = 255): Uint8Array {
  const frame = image()
  for (let y = 2; y < 4; y++) for (let x = 5; x < 10; x++) frame.fill(value, (y * 20 + x) * 3, (y * 20 + x + 1) * 3)
  return frame
}
const scan = (frames: Uint8Array[], patch: Partial<ScreenChangeOptions> = {}) => {
  const accumulator = new ScreenChangeAccumulator(options(patch))
  for (const frame of frames) accumulator.push(frame)
  return accumulator.finish()
}

describe('录屏局部变化的流式证据', () => {
  it('按变化像素比例发现小区域，边框为精确归一化范围；噪点不过像素阈值', () => {
    expect(screenFrameDifference(popup(), image(), 20, 10, 3)).toEqual({ ratio: .05, region: { x: .25, y: .2, width: .25, height: .2 } })
    expect(screenFrameDifference(image(10), image(), 20, 10, 3)).toEqual({ ratio: 0, region: { x: 0, y: 0, width: 0, height: 0 } })
    const one = image(); one[0] = 11
    expect(screenFrameDifference(one, image(), 20, 10, 3).ratio).toBe(.005)
    expect(scan([image(), one, one]).candidates).toMatchObject([{ changedRatio: .005, abrupt: false }])
  })
  it('RGB比较保留等亮度换色，不被灰度平均稀释', () => {
    expect(screenFrameDifference(Uint8Array.of(255, 0, 0), Uint8Array.of(0, 130, 0), 1, 1, 3).ratio).toBe(1)
    expect(screenFrameDifference(Uint8Array.of(20), Uint8Array.of(0), 1, 1, 1).ratio).toBe(1)
  })
  it('复原按原变化面积比较，保留小量背景残差；不同区域变化不合并成连续突变', () => {
    const residual = image(); residual.fill(40, 0, 3)
    expect(scan([image(), popup(), residual, residual]).candidates[0]).toMatchObject({ kind: 'transient', returnSeconds: 10.4 })
    const left = image(); left.fill(40, 0, 12)
    const right = new Uint8Array(left); right.fill(40, 200, 212)
    const third = new Uint8Array(right); third.fill(40, 400, 412)
    expect(scan([image(), left, left, right, right, third, third]).candidates.every(event => event.kind !== 'burst')).toBe(true)
  })
  it('弹出后复原保留短于0.4秒的候选，源时间不归零且不宣称精确解码时间', () => {
    const result = scan([image(), popup(), image(), image()])
    expect(result).toMatchObject({ samplingFps: 5, sampledFrames: 4, lastSampleSeconds: 10.6, candidates: [{
      kind: 'transient', beforeSeconds: 10, atSeconds: 10.2, lastChangeSeconds: 10.4, returnSeconds: 10.4, settledSeconds: 10.6, abrupt: true,
    }] })
    expect(planScreenChangeRefinement(result.candidates, 10, 20)).toMatchObject({ omitted: 0 })
    expect(planScreenChangeRefinement(result.candidates, 10, 20).ranges[0].fromSeconds).toBe(10)
    expect(planScreenChangeRefinement(result.candidates, 10, 20).ranges[0].toSeconds).toBeCloseTo(11)
  })
  it('稳定后的短暂切换为flash，同区域连续切换为burst；都只是需看片的候选', () => {
    const flash = scan([image(), popup(40), popup(40), popup(80), popup(80)]).candidates
    expect(flash.map(value => value.kind)).toEqual(['flash', 'change'])
    const burst = scan([image(), popup(40), popup(40), popup(80), popup(80), popup(120), popup(120)]).candidates
    expect(burst.map(value => value.kind)).toEqual(['burst', 'burst', 'burst'])
    // Repeated activity remains a review candidate even when it lacks a quiet lead-in.
    expect(burst.map(value => value.abrupt)).toEqual([true, false, false])
  })
  it('正常持续变化合并为一段，保留变化范围和持续证据', () => {
    const result = scan(Array.from({ length: 8 }, (_, i) => image(i * 20)))
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]).toMatchObject({ kind: 'continuous', atSeconds: 10.2, lastChangeSeconds: 11.4, changedRatio: 1 })
    expect(result.candidates[0].settledSeconds).toBeUndefined()
  })
  it('四秒之后复原不能冒充短暂弹出；尾部未稳定时不伪造稳定帧', () => {
    const frames = [image(), ...Array.from({ length: 24 }, () => popup()), image()]
    const result = scan(frames)
    expect(result.candidates).toHaveLength(2)
    expect(result.candidates[0].returnSeconds).toBeUndefined()
    expect(result.candidates.at(-1)?.settledSeconds).toBeUndefined()
  })
  it('复制输入帧，不受解码缓冲区复用影响；结束和失败后都不能再交付结果', () => {
    const accumulator = new ScreenChangeAccumulator(options())
    const frame = image(); accumulator.push(frame); frame.set(popup()); accumulator.push(frame)
    expect(accumulator.finish().candidates).toHaveLength(1)
    expect(() => accumulator.finish()).toThrow('已结束')
    expect(() => accumulator.push(frame)).toThrow('已结束')
    const broken = new ScreenChangeAccumulator(options())
    expect(() => broken.push(new Uint8Array(1))).toThrow('不完整')
    expect(() => broken.finish()).toThrow('已结束')
  })
  it('规格、范围与计算预算显式失败，不静默截断或接受越界采样', () => {
    for (const patch of [{ fps: 0 }, { width: 0 }, { height: 100000 }, { endSeconds: NaN }, { jumpRatio: .0001 }, { pixelDelta: 255 }]) {
      expect(() => new ScreenChangeAccumulator(options(patch))).toThrow('规格无效')
    }
    expect(() => screenFrameDifference(image(), image(), 20, 10, 3, -1)).toThrow('无效')
    const accumulator = new ScreenChangeAccumulator(options({ endSeconds: 10.2 }))
    accumulator.push(image())
    expect(() => accumulator.push(image())).toThrow('超出请求范围')
    expect(() => accumulator.finish()).toThrow('已结束')
    const many = new ScreenChangeAccumulator({ width: 1, height: 1, channels: 1, fps: 5, startSeconds: 0, endSeconds: 86400 })
    expect(() => {
      for (let i = 0; i < 20002; i++) many.push(Uint8Array.of(Math.floor(i / 2) % 2 ? 255 : 0))
    }).not.toThrow()
    expect(() => many.push(Uint8Array.of(255))).toThrow('超过10000项')
    expect(() => many.finish()).toThrow('已结束')
  })
  it('无变化或空输入不编造候选，报告实际采样量', () => {
    expect(scan([])).toEqual({ samplingFps: 5, sampledFrames: 0, lastSampleSeconds: null, candidates: [] })
    expect(scan([image(), image(), image()])).toMatchObject({ sampledFrames: 3, candidates: [] })
  })
  it('复核窗口合并重叠部分，先检查复原和短暂切换，超预算明确返回遗漏数量', () => {
    const event = scan([image(), popup(), image(), image()]).candidates[0]
    const result = planScreenChangeRefinement([{ ...event, kind: 'continuous', atSeconds: 15, beforeSeconds: 14.8, lastChangeSeconds: 18, settledSeconds: 18.2, returnSeconds: undefined }, event,
      { ...event, atSeconds: 10.3 }], 10, 20, { candidates: 2, seconds: 2 })
    expect(result.omitted).toBe(1)
    expect(result.ranges).toHaveLength(1)
    expect(result.ranges[0].fromSeconds).toBe(10)
    expect(result.ranges[0].toSeconds).toBeCloseTo(11)
    expect(planScreenChangeRefinement([event], 10, 20, { candidates: 1, seconds: .1 })).toEqual({ ranges: [], omitted: 1 })
    expect(() => planScreenChangeRefinement([], 10, 20, { candidates: 0, seconds: 2 })).toThrow('无效')
  })
})
