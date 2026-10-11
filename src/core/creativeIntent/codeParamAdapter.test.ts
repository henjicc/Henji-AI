import { describe, expect, it } from 'vitest'
import type { CodeMaterialMetadata } from '../videoEdit/codeMaterialDocument'
import { evaluateCodeMaterialParameters, prepareCodeMaterialParameters } from '../videoEdit/codeMaterialAnimation'
import { advanceVideoEditClipSource, videoEditClipSourceTimeAt } from '../videoEdit/clipSpeed'
import { compileCodeParameterTake } from './codeParamAdapter'

const metadata: CodeMaterialMetadata = { name: '参数', kind: 'generator', mode: 'dynamic', width: 1920, height: 1080, durationSeconds: 10, seed: 1, parameters: [
  { key: 'amount', type: 'number', title: '强度', description: '', unit: '', default: 0, min: 0, max: 10, step: .01, animatable: true },
  { key: 'point', type: 'point', title: '位置', description: '', default: { x: 0, y: 0 }, min: { x: 0, y: 0 }, max: { x: 1, y: 1 }, space: 'frame', animatable: true },
  { key: 'color', type: 'color', title: '颜色', description: '', default: [0, 0, 0, 1], animatable: true },
  { key: 'flag', type: 'boolean', title: '开关', description: '', default: false, animatable: true },
] }
const clip = { start: 100, duration: 121, sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 } }
const rate = { numerator: 30000, denominator: 1001 }

describe('M01/M02 declared parameter adapters', () => {
  it('preserves scalar dwell events and exact pins; source mapping survives speed, reverse, trim and split', () => {
    for (const reverse of [false, true]) {
      const timed = { ...clip, speed: { numerator: 2, denominator: 1 }, reverse, sourceInUs: reverse ? 9e6 : 0 }
      const samples = Array.from({ length: 121 }, (_, i) => ({ frame: 100 + i, value: i < 30 ? i / 6 : i <= 60 ? 5 : 5 + (i - 60) / 12, hard: [30, 60].includes(i) }))
      const points = compileCodeParameterTake(metadata, 'amount', timed, rate, samples)
      expect(points.length).toBeLessThanOrEqual(12)
      const prepared = prepareCodeMaterialParameters(metadata, { parameters: {}, curves: { amount: points } })
      for (const s of samples) {
        const source = videoEditClipSourceTimeAt(timed, s.frame - timed.start, rate)
        expect(Math.abs(Number(evaluateCodeMaterialParameters(prepared, source).amount) - s.value)).toBeLessThanOrEqual(.01000001)
        if (s.hard) expect(evaluateCodeMaterialParameters(prepared, source).amount).toBe(s.value)
      }
      const trimmed = { ...timed, ...advanceVideoEditClipSource(timed, 25, rate), start: 125, duration: 96 }
      expect(videoEditClipSourceTimeAt(trimmed, 35, rate)).toEqual(videoEditClipSourceTimeAt(timed, 60, rate))
    }
  })
  it('uses one native compound interpolation for point and color', () => {
    for (const key of ['point', 'color']) {
      const samples = Array.from({ length: 31 }, (_, i) => ({ frame: 100 + i, value: key === 'point' ? { x: i / 30, y: 1 - i / 30 } : [i / 30, 1 - i / 30, .5, 1] }))
      const points = compileCodeParameterTake(metadata, key, clip, rate, samples)
      const prepared = prepareCodeMaterialParameters(metadata, { parameters: {}, curves: { [key]: points } })
      expect(points).toHaveLength(2)
      expect(evaluateCodeMaterialParameters(prepared, videoEditClipSourceTimeAt(clip, 15, rate))[key]).toEqual(key === 'point' ? { x: .5, y: .5 } : [.5, .5, .5, 1])
    }
  })
  it('keeps discrete changes on their actual timeline frame during reverse playback', () => {
    const timed = { ...clip, sourceInUs: 5e6, reverse: true }
    const points = compileCodeParameterTake(metadata, 'flag', timed, rate, [{ frame: 100, value: false }, { frame: 110, value: true }, { frame: 120, value: false }])
    const prepared = prepareCodeMaterialParameters(metadata, { parameters: {}, curves: { flag: points } })
    expect(points.every(p => p.interpolation === 'hold')).toBe(true)
    for (let i = 0; i <= 20; i++) expect(evaluateCodeMaterialParameters(prepared, videoEditClipSourceTimeAt(timed, i, rate)).flag).toBe(i >= 10 && i < 20)
  })
  it('rejects source/arbitrary properties, invalid values, revisits and cancellation', () => {
    expect(() => compileCodeParameterTake(metadata, 'source', clip, rate, [{ frame: 100, value: 'throw 1' }])).toThrow('正式声明')
    expect(() => compileCodeParameterTake(metadata, 'amount', clip, rate, [{ frame: 100, value: 11 }])).toThrow()
    expect(() => compileCodeParameterTake(metadata, 'amount', clip, rate, [{ frame: 100, value: 1 }, { frame: 100, value: 2 }])).toThrow('重访')
    expect(() => compileCodeParameterTake(metadata, 'amount', clip, rate, [{ frame: 100, value: 1 }, { frame: 102, value: 2 }, { frame: 101, value: 3 }])).toThrow('换向')
    expect(() => compileCodeParameterTake(metadata, 'amount', clip, rate, [{ frame: 99, value: 1 }])).toThrow('片段')
    expect(() => compileCodeParameterTake(metadata, 'amount', clip, rate, [{ frame: 100, value: 1 }], { cancelled: () => true })).toThrow()
  })
  it('mixed custom parameters retain linear channels and exact discrete switches in reverse', () => {
    const amount = metadata.parameters[0]; const flag = metadata.parameters[3]
    if (amount.type !== 'number' || flag.type !== 'boolean') throw new Error('参数测试夹具类型错误')
    const custom: CodeMaterialMetadata = { ...metadata, parameters: [{ key: 'light', type: 'custom', title: '灯光', description: '', animatable: true, typeName: 'light', default: { amount: 0, flag: false }, fields: { amount, flag } }] }
    const timed = { ...clip, sourceInUs: 5e6, reverse: true }
    const points = compileCodeParameterTake(custom, 'light', timed, rate, [{ frame: 100, value: { amount: 0, flag: false } }, { frame: 110, value: { amount: 10, flag: true } }])
    const prepared = prepareCodeMaterialParameters(custom, { parameters: {}, curves: { light: points } })
    for (let i = 0; i <= 10; i++) {
      const value = evaluateCodeMaterialParameters(prepared, videoEditClipSourceTimeAt(timed, i, rate)).light
      expect(value).toMatchObject({ flag: i === 10 })
      expect((value as { amount: number }).amount).toBeCloseTo(i, 6)
    }
  })
})
