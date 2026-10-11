import { describe, expect, it } from 'vitest'
import { videoEditClipSchema, type VideoEditClip } from '../videoEdit/document'
import { staggerMotion } from './stagger'
import { videoEditClipValue } from '../videoEdit/keyframes'

function clips() {
  const source = videoEditClipSchema.parse({ id: 'source', itemId: 'item', name: '标题', kind: 'text', text: '标题', start: 0, duration: 60, track: 1, sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 1 })
  source.id = 'source'; source.x = .1; source.scale = .5
  source.curves = { x: [{ time: 5, value: .1, interpolation: 'bezier', bezier: [.2, 0, .8, 1] }, { time: 15, value: .4, interpolation: 'linear' }], scale: [{ time: 5, value: .5, interpolation: 'linear' }, { time: 15, value: 1, interpolation: 'linear' }] }
  const a: VideoEditClip = { ...structuredClone(source), id: 'a', x: -.2, scale: 1, curves: undefined }
  const b = { ...structuredClone(a), id: 'b', x: .2, scale: .75 }
  return { source, a, b }
}
describe('错峰复制', () => {
  it('保留各自基态、贝塞尔与相对缩放，按目标顺序错开且源输入不变', () => {
    const { source, a, b } = clips(), before = structuredClone(source)
    const result = staggerMotion(source, [a, b], [5, 15], 4)
    expect(videoEditClipValue(result[0], 'x', 9)).toBeCloseTo(-.2)
    expect(videoEditClipValue(result[0], 'x', 19)).toBeCloseTo(.1)
    expect(videoEditClipValue(result[1], 'x', 23)).toBeCloseTo(.5)
    expect(videoEditClipValue(result[0], 'scale', 19)).toBe(2)
    expect(videoEditClipValue(result[1], 'scale', 23)).toBe(1.5)
    expect(result[0].curves?.x?.find(point => point.time === 9)?.bezier).toEqual([.2, 0, .8, 1])
    expect(source).toEqual(before); expect(a.curves).toBeUndefined()
  })
  it('裁切区间保留每个亚帧求值，区间外目标曲线不变', () => {
    const { source, a } = clips()
    a.curves = structuredClone(source.curves)
    const result = staggerMotion(source, [a], [8, 12], 0)[0]
    for (let frame = 8; frame <= 12; frame += .25) expect(videoEditClipValue(result, 'x', frame)).toBeCloseTo(a.x + videoEditClipValue(source, 'x', frame) - source.x, 10)
    for (const frame of [0, 5, 7, 13, 15, 30]) expect(videoEditClipValue(result, 'x', frame)).toBeCloseTo(videoEditClipValue(a, 'x', frame), 10)
  })
  it('任一目标时长或值域不足时整批拒绝，拒绝重复目标、负数与非整数错开', () => {
    const { source, a, b } = clips()
    expect(() => staggerMotion(source, [a, { ...b, duration: 20 }], [5, 15], 4)).toThrow('放不下')
    expect(() => staggerMotion(source, [a, { ...b, scale: 3 }], [5, 15], 4)).toThrow('范围')
    expect(() => staggerMotion(source, [a, a], [5, 15], 4)).toThrow('重复')
    expect(() => staggerMotion(source, [a], [5, 15], -.5)).toThrow('整数')
    expect(a.curves).toBeUndefined()
  })
})
