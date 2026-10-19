import { describe, expect, it } from 'vitest'
import { CodeMotionSamplingBudget, sampleCodeMotion } from './motionSampling'
import type { CodeMotionPose } from './motionSampling'
import type { VideoEditFrameOffset } from '../time'

const value = (offset: VideoEditFrameOffset): number => offset.numerator / offset.denominator
const shutter = { start: { numerator: -1, denominator: 4 }, end: { numerator: 1, denominator: 4 } }
const available = { start: { numerator: -2, denominator: 1 }, end: { numerator: 2, denominator: 1 } }
const bounds = { x: 0, y: 0, width: 100, height: 100 }
const pose = (x = 0, opacity = 1): CodeMotionPose => ({ matrix: [1, 0, 0, 1, x, 0], opacity })
const sample = (poseAt: (offset: VideoEditFrameOffset) => CodeMotionPose | null, extra: Partial<Parameters<typeof sampleCodeMotion>[0]> = {}) => sampleCodeMotion({ bounds, shutter, available, maxSamples: 64, budget: new CodeMotionSamplingBudget(), poseAt, ...extra })

describe('受控快门位姿采样', () => {
  it('关闭及零快门严格保留中心位姿，不求值其他时刻', () => {
    const offsets: number[] = []
    const at = (offset: VideoEditFrameOffset) => { offsets.push(value(offset)); return pose(value(offset) * 100) }
    expect(sample(at, { enabled: false, budget: new CodeMotionSamplingBudget(1) })).toEqual([{ offset: { numerator: 0, denominator: 1 }, pose: pose(), weight: 1 }])
    sample(at, { shutter: { start: shutter.start, end: shutter.start }, budget: new CodeMotionSamplingBudget(1) })
    expect(offsets).toEqual([0, 0])
  })
  it('静止层退为单样本；平移按四角像素路径选择样本，权重总和为1', () => {
    expect(sample(() => pose())).toHaveLength(1)
    const samples = sample(offset => pose(value(offset) * 80))
    expect(samples).toHaveLength(40)
    expect(samples.reduce((sum, entry) => sum + entry.weight, 0)).toBeCloseTo(1, 14)
    expect(samples[0].offset).toEqual({ numerator: -39, denominator: 160 })
    expect(samples.at(-1)!.offset).toEqual({ numerator: 39, denominator: 160 })
    expect(samples[0].pose!.matrix[4]).toBe(-19.5)
  })
  it('闭合旋转路径不能因首尾接近而被当作静止，采样受每层上限约束', () => {
    const samples = sample(offset => {
      const angle = value(offset) * Math.PI * 4
      return { matrix: [Math.cos(angle), Math.sin(angle), -Math.sin(angle), Math.cos(angle), 0, 0], opacity: 1 }
    }, { maxSamples: 12 })
    expect(samples).toHaveLength(12)
    expect(sample(offset => pose(value(offset) * 80), { maxSamples: 1 })).toHaveLength(1)
  })
  it('片段/源窗口裁掉不可用曝光并重新归一，排他终点永不被求值', () => {
    const called: number[] = []
    const partial = { start: { numerator: 0, denominator: 1 }, end: { numerator: 1, denominator: 8 } }
    const samples = sample(offset => { called.push(value(offset)); return pose(value(offset) * 800) }, { available: partial })
    expect(samples).toHaveLength(64)
    expect(called.every(time => time > 0 && time < .125)).toBe(true)
    expect(samples.reduce((sum, entry) => sum + entry.weight, 0)).toBe(1)
    expect(sample(() => { throw new Error('不能求值不可用曝光') }, { shutter: { start: { numerator: -2, denominator: 1 }, end: { numerator: -1, denominator: 1 } }, available: partial })).toEqual([])
    expect(sample(() => pose(), { available: { start: { numerator: -600, denominator: 1 }, end: { numerator: 1200, denominator: 1 } } })).toEqual(sample(() => pose()))
  })
  it('不透明度变化至少四样本，透明及奇异位姿保留曝光权重', () => {
    expect(sample(offset => pose(0, .5 + value(offset)))).toHaveLength(4)
    const samples = sample(offset => value(offset) < 0 ? null : pose())
    expect(samples).toHaveLength(4)
    expect(samples.filter(entry => entry.pose === null)).toHaveLength(2)
    expect(samples.filter(entry => entry.pose).reduce((sum, entry) => sum + entry.weight, 0)).toBe(.5)
    expect(sample(() => ({ matrix: [0, 0, 0, 0, 10, 20], opacity: 1 }))[0].pose).toBeNull()
  })
  it('层间共享预算包括探测，不因缓存命中重复收费，耗尽明确失败', () => {
    const budget = new CodeMotionSamplingBudget(33)
    expect(sample(() => pose(), { budget })).toHaveLength(1) // 16 probes + distinct midpoint
    expect(() => sample(() => pose(), { budget })).toThrow('超出预算')
    // Probe midpoints and the final 16 samples are identical reduced fractions.
    const exact = new CodeMotionSamplingBudget(16)
    expect(sample(offset => pose(value(offset) * 32), { maxSamples: 16, budget: exact })).toHaveLength(16)
  })
  it('相同时间重复、乱序取样确定，回调复用的可变矩阵不会污染已有样本', () => {
    const shared = pose()
    const at = (offset: VideoEditFrameOffset) => { shared.matrix[4] = value(offset) * 80; return shared }
    const first = sample(at)
    sample(at, { shutter: { start: { numerator: 1, denominator: 4 }, end: { numerator: 3, denominator: 4 } } })
    expect(sample(at)).toEqual(first)
    expect(first[0].pose!.matrix[4]).toBe(-19.5)
    expect(first.at(-1)!.pose!.matrix[4]).toBe(19.5)
  })
  it('无效采样数、窗口、矩阵及非有限输入均拒绝', () => {
    for (const maxSamples of [0, 65, 1.5, Infinity]) expect(() => sample(() => pose(), { maxSamples })).toThrow()
    expect(() => sample(() => pose(), { shutter: { start: shutter.end, end: shutter.start } })).toThrow('窗口')
    expect(() => sample(() => pose(), { available: { start: shutter.end, end: available.end } })).toThrow('中心')
    expect(() => sample(() => pose(), { shutter: { start: { numerator: -3, denominator: 1 }, end: shutter.end } })).toThrow('两帧')
    expect(() => sample(() => pose(), { bounds: { ...bounds, width: NaN } })).toThrow('内容范围')
    expect(() => sample(() => pose(NaN))).toThrow('有限仿射')
    expect(() => sample(() => pose(0, 2))).toThrow('不透明度')
  })
})
