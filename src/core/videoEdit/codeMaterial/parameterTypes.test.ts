import { describe, expect, it } from 'vitest'
import { testCodeMetadata } from './sourceTestFixtures'
import { CodeMaterialError } from './contract'
import { validateCodeMaterialParameters, validateCodeMaterialParameterValue } from './parameters'
import { codeParameterMetadata, parseCodeMaterialTypes } from './parameterTypes'
import { easeCodeParameter, sampleCodeCurve, sampleCodeGradient } from './parameterSampling'
import { codeMaterialInstanceSchema } from '../codeMaterialPersistence'
import { codeMaterialKeyframeSchema, evaluateCodeMaterialParameters, prepareCodeMaterialParameters } from '../codeMaterialAnimation'

const declaration = (parameters: Record<string, unknown>, _body = '', types: Record<string, unknown> = {}) => ({ name: '参数契约', parameters, types })
const grade = { hue: 30, strength: .4, luminance: -.2 }
const ramp = [{ at: 0, color: [0, 0, 0, 0] }, { at: 1, color: [1, .5, .2, 1] }]
const curve = [{ x: 0, y: 0 }, { x: .5, y: .25 }, { x: 1, y: 1 }]
const basic = {
  number: { type: 'number', title: '数值', min: 0, max: 10, step: .01, unit: '%', control: 'knob', default: 2 },
  angle: { type: 'angle', title: '角度', default: 30 }, point: { type: 'point', title: '点位', default: { x: .25, y: .75 } },
  range: { type: 'range', title: '区间', min: 0, max: 10, step: .1, default: [2, 4] },
  color: { type: 'color', title: '颜色', alpha: false, default: [1, .5, 0, 1] }, gradient: { type: 'gradient', title: '渐变', default: ramp },
  curve: { type: 'curve', title: '曲线', default: curve }, grade: { type: 'grade', title: '色轮', default: grade },
  choice: { type: 'choice', title: '模式', options: [{ value: 'soft', label: '柔和' }, { value: 'hard', label: '硬朗' }], control: 'segmented', default: 'soft' },
  boolean: { type: 'boolean', title: '开关', default: true }, text: { type: 'text', title: '文案', maxLength: 4096, multiline: true, default: '文字' },
  font: { type: 'font', title: '字体', default: 'sans-serif' }, easing: { type: 'easing', title: '缓动', default: [.25, -.5, .75, 1.5] },
  seed: { type: 'seed', title: '种子', default: 4294967295 }, image: { type: 'image', title: '图片', default: null },
}
const light = { title: '灯光', layout: 'row', fields: { angle: basic.angle, color: basic.color, power: basic.number } }
const time = (sourceInUs: number) => ({ sourceInUs, sourceRemainder: { numerator: 0, denominator: 1 } })

describe('v3 参数声明与实例契约', () => {
  it('解析全部类型和元数据，默认补齐自定义字段并保存选项标签', () => {
    const program = testCodeMetadata(declaration({ ...basic, lamp: { type: 'light', title: '主光', group: '照明', advanced: true, tooltip: '调整主光', description: '照亮主体', default: { power: 1.4 } } }, 'return [];', { light }))
    const values = validateCodeMaterialParameters(program)
    expect(values.lamp).toEqual({ angle: 30, color: [1, .5, 0, 1], power: 1.4 })
    expect(program.parameters.find(p => p.key === 'point')).toMatchObject({ space: 'frame', min: { x: 0, y: 0 }, max: { x: 1, y: 1 }, advanced: false })
    expect(program.parameters.find(p => p.key === 'angle')).toMatchObject({ min: -180, max: 180 })
    expect(program.parameters.find(p => p.key === 'gradient')).toMatchObject({ maxStops: 8 })
    expect(codeParameterMetadata(program.parameters.at(-1)!)).toMatchObject({ type: 'light', group: '照明', advanced: true, tooltip: '调整主光' })
    expect(codeParameterMetadata(program.parameters.find(p => p.type === 'choice')!)).toMatchObject({ options: basic.choice.options })
    expect(program.types!.light).toMatchObject({ title: '灯光', layout: 'row' })
    const specialOptions = [{ value: '__proto__', label: '特殊值' }, { value: 'constructor', label: '另一个值' }]
    expect(codeParameterMetadata(testCodeMetadata(declaration({ choice: { ...basic.choice, options: specialOptions, default: '__proto__' } })).parameters[0])).toMatchObject({ options: specialOptions })
  })
  it('生成器声明可超过32项，选项上限64', () => {
    const params = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`p${i}`, basic.number]))
    expect(testCodeMetadata(declaration(params)).parameters).toHaveLength(100)
    const choices = Array.from({ length: 64 }, (_, i) => `c${i}`)
    expect(testCodeMetadata(declaration({ v: { ...basic.choice, options: choices, default: 'c0' } })).parameters[0]).toMatchObject({ options: choices })
    expect(() => testCodeMetadata(declaration({ v: { ...basic.choice, options: [...choices, 'overflow'] } }))).toThrow('64')
  })
  it('实例错误列出形状与范围，并拒绝未知键与结构缺字段', () => {
    const program = testCodeMetadata(declaration(basic))
    const invalid: Record<string, unknown> = { number: 11, angle: 181, point: { x: 2, y: .5 }, range: [4, 2], color: [1, 1, 1, .5], gradient: [...ramp].reverse(), curve: [{ x: 0, y: .1 }, { x: 0, y: .2 }, { x: 1, y: .9 }], grade: { ...grade, hue: 361 }, choice: 'missing', boolean: 1, text: 'x'.repeat(4097), font: 'bad; font', easing: [2, 0, 1, 1], seed: 1.5, image: { kind: 'image', mediaId: 'p', extra: true } }
    for (const [key, value] of Object.entries(invalid)) {
      try { validateCodeMaterialParameterValue(program.parameters.find(p => p.key === key)!, value); throw new Error('应拒绝无效实例') }
      catch (error) { expect(error).toBeInstanceOf(CodeMaterialError); expect((error as Error).message).toMatch(new RegExp(key)) }
    }
    expect(() => validateCodeMaterialParameters(program, { missing: 1 })).toThrow('未声明参数')
    const custom = testCodeMetadata(declaration({ lamp: { type: 'light', title: '灯', default: {} } }, 'return [];', { light })).parameters[0]
    expect(() => validateCodeMaterialParameterValue(custom, { power: 1 })).toThrow('lamp.angle')
    expect(() => validateCodeMaterialParameterValue(custom, { angle: 1, color: [1, 1, 1, 1], power: 1, other: 1 })).toThrow('可用')
  })
  it('visibleWhen只引用前面的标量，条件唯一，比较值必须符合被引用声明', () => {
    const program = testCodeMetadata(declaration({ mode: basic.choice, count: basic.number, enabled: basic.boolean,
      v: { ...basic.angle, visibleWhen: { param: 'mode', in: ['soft', 'hard'] } },
      w: { ...basic.angle, visibleWhen: { param: 'count', notEquals: 2 } }, z: { ...basic.angle, visibleWhen: { param: 'enabled', equals: true } } }))
    expect(program.parameters.at(-1)!.visibleWhen).toEqual({ param: 'enabled', equals: true })
    for (const condition of [{ param: 'later', equals: true }, { param: 'enabled' }, { param: 'enabled', equals: true, notEquals: false }, { param: 'mode', equals: 'missing' }, { param: 'point', equals: 1 }, { param: 'enabled', in: [] }]) {
      expect(() => testCodeMetadata(declaration({ mode: basic.choice, enabled: basic.boolean, point: basic.point, v: { ...basic.angle, visibleWhen: condition }, later: basic.boolean }))).toThrow(CodeMaterialError)
    }
    for (const field of [{ title: 'x'.repeat(81) }, { group: 'x'.repeat(41) }, { tooltip: 'x'.repeat(201) }, { advanced: 1 }]) expect(() => testCodeMetadata(declaration({ a: { ...basic.angle, ...field } }))).toThrow(CodeMaterialError)
  })
  it('自定义类型基础字段、数量、布局和保留名称均受约束', () => {
    expect(parseCodeMaterialTypes({ wheel: { title: '色轮', layout: 'wheel', fields: { grade: basic.grade, gain: basic.number } } }).wheel.layout).toBe('wheel')
    expect(testCodeMetadata(declaration({ component: { type: 'custom', title: '组件', default: {} } }, 'return [];', { custom: light })).parameters[0]).toMatchObject({ type: 'custom', typeName: 'custom' })
    const invalid = [
      { light: { ...light, layout: 'free' } }, { light: { ...light, layout: 'wheel' } }, { light: { ...light, layout: 'wheel', fields: { a: basic.grade, b: basic.grade } } },
      { light: { ...light, fields: {} } }, { light: { ...light, fields: Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`p${i}`, basic.number])) } },
      { light: { ...light, fields: { image: basic.image } } }, { light: { ...light, fields: { nested: { type: 'light', title: '嵌套', default: {} } } } },
      { light: { ...light, fields: { power: { ...basic.number, advanced: true } } } }, { number: light },
    ]
    for (const types of invalid) expect(() => parseCodeMaterialTypes(types)).toThrow(CodeMaterialError)
    expect(() => testCodeMetadata(declaration({ a: basic.curve, b: { ...basic.curve, kind: 'hue' } }))).toThrow('两端 y 相等')
    expect(testCodeMetadata(declaration({ a: { ...basic.curve, kind: 'hue', default: [{ x: 0, y: .5 }, { x: 1, y: .5 }] } })).parameters[0]).toMatchObject({ kind: 'hue' })
  })
})

describe('参数采样、动画及持久化', () => {
  it('渐变、曲线与缓动参数采样', () => {
    expect(sampleCodeGradient(ramp, -.1)).toEqual([0, 0, 0, 0]); expect(sampleCodeGradient(ramp, 2)).toEqual([1, .5, .2, 1])
    expect(sampleCodeGradient(ramp, .5)).toEqual([.5, .25, .1, .5])
    expect(sampleCodeGradient([{ at: .5, color: [1, 0, 0, 1] }, { at: .5, color: [0, 0, 1, 1] }], .5)).toEqual([0, 0, 1, 1])
    expect(sampleCodeCurve(curve, .75)).toBe(.625); expect(sampleCodeCurve(curve, -1)).toBe(0); expect(sampleCodeCurve(curve, 2)).toBe(1)
    expect(easeCodeParameter('quadIn', .5)).toBe(.25); expect(easeCodeParameter([1 / 3, 0, 2 / 3, 1], .5)).toBeCloseTo(.5, 6)
    expect(() => sampleCodeCurve([{ x: 0, y: 0 }, { x: 0, y: 1 }], .5)).toThrow('首尾')
  })
  it('分量插值：点/区间/grade/角度/结构；离散字段hold，源时间和ease共享原时钟', () => {
    const types = { component: { title: '组件', layout: 'stack', fields: { point: basic.point, grade: basic.grade, color: basic.color, range: basic.range, angle: basic.angle, label: basic.text, seed: basic.seed } } }
    const program = testCodeMetadata(declaration({ p: { ...basic.point, animatable: true }, r: { ...basic.range, animatable: true }, a: { ...basic.angle, animatable: true }, g: { ...basic.grade, animatable: true }, light: { type: 'component', title: '组件', default: {}, animatable: true } }, 'return [];', types))
    const start = validateCodeMaterialParameters(program); const end = { ...start, p: { x: 1, y: .25 }, r: [6, 8], a: 170, g: { hue: 350, strength: .8, luminance: .2 }, light: { point: { x: 1, y: .25 }, grade: { hue: 350, strength: .8, luminance: .2 }, color: [0, .5, 1, 1], range: [6, 8], angle: 170, label: '新文字', seed: 1 } }
    const curves = Object.fromEntries(program.parameters.map(p => [p.key, [{ id: `${p.key}0`, ...time(0), value: start[p.key], interpolation: 'linear' }, { id: `${p.key}1`, ...time(1e6), value: end[p.key as keyof typeof end], interpolation: 'ease' }]]))
    const instance = codeMaterialInstanceSchema.parse({ definitionId: 'd', versionId: 'v', parameters: {}, curves })
    const prepared = prepareCodeMaterialParameters(program, instance)
    const midpoint = evaluateCodeMaterialParameters(prepared, time(500000))
    expect(midpoint).toMatchObject({ p: { x: .625, y: .5 }, r: [4, 6], a: 100, g: { hue: 190, strength: expect.closeTo(.6, 8), luminance: 0 }, light: { label: '文字', seed: 4294967295, color: [.5, .5, .5, 1], angle: 100 } })
    const left = prepared.curves.get('a')!.points[0]; left.value = -170; left.interpolation = 'ease'
    expect(evaluateCodeMaterialParameters(prepared, time(250000)).a).toBe(-116.875)
    expect(evaluateCodeMaterialParameters(prepared, time(1e6)).light).toEqual(end.light)
  })
  it('离散参数和纯离散自定义组件仅hold，所有新值JSON往返且有技术形状边界', () => {
    const types = { label: { title: '标签', layout: 'row', fields: { font: basic.font, seed: basic.seed } } }
    const program = testCodeMetadata(declaration({ ...Object.fromEntries(Object.entries(basic).filter(([key]) => key !== 'image').map(([key, value]) => [key, { ...value, animatable: true }])), label: { type: 'label', title: '标签', default: {}, animatable: true } }, 'return [];', types))
    const values = validateCodeMaterialParameters(program)
    const instance = { definitionId: 'd', versionId: 'v', parameters: values, curves: { easing: [{ id: 'e', ...time(0), value: values.easing, interpolation: 'hold' as const }] } }
    expect(codeMaterialInstanceSchema.parse(JSON.parse(JSON.stringify(instance)))).toEqual(instance)
    for (const key of ['gradient', 'curve', 'easing', 'seed', 'font', 'choice', 'boolean', 'text', 'label']) {
      const point = { id: key, ...time(0), value: values[key], interpolation: 'linear' as const }
      expect(() => prepareCodeMaterialParameters(program, codeMaterialInstanceSchema.parse({ ...instance, curves: { [key]: [point] } }))).toThrow('保持')
      expect(prepareCodeMaterialParameters(program, codeMaterialInstanceSchema.parse({ ...instance, curves: { [key]: [{ ...point, interpolation: 'hold' }] } })).curves.has(key)).toBe(true)
    }
    const bad: unknown[] = ['x'.repeat(4097), Infinity, { x: NaN, y: 1 }, { nested: { inner: 1 } }]
    for (const value of bad) {
      expect(codeMaterialInstanceSchema.safeParse({ definitionId: 'd', versionId: 'v', parameters: { p: value } }).success).toBe(false)
      expect(codeMaterialKeyframeSchema.safeParse({ id: 'p', ...time(0), value, interpolation: 'hold' }).success).toBe(false)
    }
    // These arrays can now be data tables. A bound gradient/curve still enforces its own limits.
    expect(() => validateCodeMaterialParameterValue(program.parameters.find(p => p.key === 'gradient')!, Array.from({ length: 33 }, (_, i) => ({ at: i / 32, color: [1, 1, 1, 1] })))).toThrow()
    expect(() => validateCodeMaterialParameterValue(program.parameters.find(p => p.key === 'curve')!, Array.from({ length: 65 }, (_, i) => ({ x: i / 64, y: .5 })))).toThrow()
    const many = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`p${i}`, i]))
    expect(codeMaterialInstanceSchema.parse({ definitionId: 'd', versionId: 'v', parameters: many }).parameters).toEqual(many)
  })
})
