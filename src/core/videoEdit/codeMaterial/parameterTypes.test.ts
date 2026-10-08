import { describe, expect, it } from 'vitest'
import { compileCodeMaterial } from './compiler'
import { evaluateCodeMaterial } from './evaluate'
import { evaluateCodeFrameExpression } from './evaluateV3'
import { CodeMaterialError } from './contract'
import { validateCodeMaterialParameters, validateCodeMaterialParameterValue } from './parameters'
import { codeParameterMetadata, parseCodeMaterialTypes } from './parameterTypes'
import { easeCodeParameter, sampleCodeCurve, sampleCodeGradient } from './parameterSampling'
import { codeFilterParameterSlots, packCodeFilterParameters } from './filterParameters'
import { codeMaterialInstanceSchema } from '../codeMaterialPersistence'
import { codeMaterialKeyframeSchema, evaluateCodeMaterialParameters, prepareCodeMaterialParameters } from '../codeMaterialAnimation'
import { emitCodeMaterialFilter } from '../../../features/videoEdit/engine/codeGpuFilter'

const context = { time: .5, localTime: .5, sequenceTime: .5, width: 64, height: 64, frame: 30, fps: 60 }
function source(parameters: Record<string, unknown>, body = 'return [];', types: Record<string, unknown> = {}, kind = 'generator', shaders = ''): string {
  return `export default {apiVersion:1,languageVersion:3,name:"参数契约",kind:"${kind}",mode:"dynamic",width:64,height:64,durationSeconds:10,seed:42,types:${JSON.stringify(types)},parameters:${JSON.stringify(parameters)},${shaders}render(ctx){${body}}}`
}
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
    const program = compileCodeMaterial(source({ ...basic, lamp: { type: 'light', title: '主光', group: '照明', advanced: true, tooltip: '调整主光', description: '照亮主体', default: { power: 1.4 } } }, 'return [];', { light }))
    const values = validateCodeMaterialParameters(program)
    expect(values.lamp).toEqual({ angle: 30, color: [1, .5, 0, 1], power: 1.4 })
    expect(program.parameters.find(p => p.key === 'point')).toMatchObject({ space: 'frame', min: { x: 0, y: 0 }, max: { x: 1, y: 1 }, advanced: false })
    expect(program.parameters.find(p => p.key === 'angle')).toMatchObject({ min: -180, max: 180 })
    expect(program.parameters.find(p => p.key === 'gradient')).toMatchObject({ maxStops: 8 })
    expect(codeParameterMetadata(program.parameters.at(-1)!)).toMatchObject({ type: 'light', group: '照明', advanced: true, tooltip: '调整主光' })
    expect(codeParameterMetadata(program.parameters.find(p => p.type === 'choice')!)).toMatchObject({ options: basic.choice.options })
    expect(program.types!.light).toMatchObject({ title: '灯光', layout: 'row' })
    const specialOptions = [{ value: '__proto__', label: '特殊值' }, { value: 'constructor', label: '另一个值' }]
    expect(codeParameterMetadata(compileCodeMaterial(source({ choice: { ...basic.choice, options: specialOptions, default: '__proto__' } })).parameters[0])).toMatchObject({ options: specialOptions })
  })
  it('新类型/元数据仅 v3 开放，生成器声明超过32项，v1/v2保留原契约', () => {
    const params = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`p${i}`, basic.number]))
    expect(compileCodeMaterial(source(params)).parameters).toHaveLength(100)
    for (const parameter of [basic.angle, { ...basic.number, group: '组' }, { ...basic.color, alpha: false }, { ...basic.text, multiline: true }]) {
      const v1 = source({ value: parameter }).replace('languageVersion:3,', '').replace('types:{},', '')
      expect(() => compileCodeMaterial(v1)).toThrow(CodeMaterialError)
    }
    const legacyNumber = { type: 'number', title: '旧数值', min: 0, max: 10, step: 1, default: 1 }
    expect(() => compileCodeMaterial(source(Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`p${i}`, legacyNumber]))).replace('languageVersion:3,', '').replace('types:{},', ''))).toThrow('32')
    const choices = Array.from({ length: 64 }, (_, i) => `c${i}`)
    expect(compileCodeMaterial(source({ v: { ...basic.choice, options: choices, default: 'c0' } })).parameters[0]).toMatchObject({ options: choices })
    expect(() => compileCodeMaterial(source({ v: { ...basic.choice, options: [...choices, 'overflow'] } }))).toThrow('64')
  })
  it('实例错误列出形状与范围，并拒绝未知键与结构缺字段', () => {
    const program = compileCodeMaterial(source(basic))
    const invalid: Record<string, unknown> = { number: 11, angle: 181, point: { x: 2, y: .5 }, range: [4, 2], color: [1, 1, 1, .5], gradient: [...ramp].reverse(), curve: [{ x: 0, y: .1 }, { x: 0, y: .2 }, { x: 1, y: .9 }], grade: { ...grade, hue: 361 }, choice: 'missing', boolean: 1, text: 'x'.repeat(4097), font: 'bad; font', easing: [2, 0, 1, 1], seed: 1.5, image: { kind: 'image', mediaId: 'p', extra: true } }
    for (const [key, value] of Object.entries(invalid)) {
      try { validateCodeMaterialParameterValue(program.parameters.find(p => p.key === key)!, value); throw new Error('应拒绝无效实例') }
      catch (error) { expect(error).toBeInstanceOf(CodeMaterialError); expect((error as Error).message).toMatch(new RegExp(key)) }
    }
    expect(() => validateCodeMaterialParameters(program, { missing: 1 })).toThrow('未声明参数')
    const custom = compileCodeMaterial(source({ lamp: { type: 'light', title: '灯', default: {} } }, 'return [];', { light })).parameters[0]
    expect(() => validateCodeMaterialParameterValue(custom, { power: 1 })).toThrow('lamp.angle')
    expect(() => validateCodeMaterialParameterValue(custom, { angle: 1, color: [1, 1, 1, 1], power: 1, other: 1 })).toThrow('可用')
  })
  it('visibleWhen只引用前面的标量，条件唯一，比较值必须符合被引用声明', () => {
    const program = compileCodeMaterial(source({ mode: basic.choice, count: basic.number, enabled: basic.boolean,
      v: { ...basic.angle, visibleWhen: { param: 'mode', in: ['soft', 'hard'] } },
      w: { ...basic.angle, visibleWhen: { param: 'count', notEquals: 2 } }, z: { ...basic.angle, visibleWhen: { param: 'enabled', equals: true } } }))
    expect(program.parameters.at(-1)!.visibleWhen).toEqual({ param: 'enabled', equals: true })
    for (const condition of [{ param: 'later', equals: true }, { param: 'enabled' }, { param: 'enabled', equals: true, notEquals: false }, { param: 'mode', equals: 'missing' }, { param: 'point', equals: 1 }, { param: 'enabled', in: [] }]) {
      expect(() => compileCodeMaterial(source({ mode: basic.choice, enabled: basic.boolean, point: basic.point, v: { ...basic.angle, visibleWhen: condition }, later: basic.boolean }))).toThrow(CodeMaterialError)
    }
    for (const field of [{ title: 'x'.repeat(81) }, { group: 'x'.repeat(41) }, { tooltip: 'x'.repeat(201) }, { advanced: 1 }]) expect(() => compileCodeMaterial(source({ a: { ...basic.angle, ...field } }))).toThrow(CodeMaterialError)
  })
  it('自定义类型基础字段、数量、布局和保留名称均受约束', () => {
    expect(parseCodeMaterialTypes({ wheel: { title: '色轮', layout: 'wheel', fields: { grade: basic.grade, gain: basic.number } } }).wheel.layout).toBe('wheel')
    expect(compileCodeMaterial(source({ component: { type: 'custom', title: '组件', default: {} } }, 'return [];', { custom: light })).parameters[0]).toMatchObject({ type: 'custom', typeName: 'custom' })
    const invalid = [
      { light: { ...light, layout: 'free' } }, { light: { ...light, layout: 'wheel' } }, { light: { ...light, layout: 'wheel', fields: { a: basic.grade, b: basic.grade } } },
      { light: { ...light, fields: {} } }, { light: { ...light, fields: Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`p${i}`, basic.number])) } },
      { light: { ...light, fields: { image: basic.image } } }, { light: { ...light, fields: { nested: { type: 'light', title: '嵌套', default: {} } } } },
      { light: { ...light, fields: { power: { ...basic.number, advanced: true } } } }, { number: light },
    ]
    for (const types of invalid) expect(() => parseCodeMaterialTypes(types)).toThrow(CodeMaterialError)
    expect(() => compileCodeMaterial(source({ a: basic.curve, b: { ...basic.curve, kind: 'hue' } }))).toThrow('两端 y 相等')
    expect(compileCodeMaterial(source({ a: { ...basic.curve, kind: 'hue', default: [{ x: 0, y: .5 }, { x: 1, y: .5 }] } })).parameters[0]).toMatchObject({ kind: 'hue' })
  })
  it('对象、数组及别名字段可推断，未知字段报TYPE并给出可用字段', () => {
    const program = compileCodeMaterial(source({ p: basic.point, r: basic.range, g: basic.gradient, c: basic.curve, grade: basic.grade, lamp: { type: 'light', title: '灯', default: {} } },
      'const lamp=ctx.params.lamp; const ramp=ctx.params.g; return [rect({x:ctx.params.p.x+lamp.power+ctx.params.r[0]+ctx.params.c[1].y,y:ctx.params.grade.hue,width:1,height:1,fill:ramp[1].color})];', { light }))
    expect(evaluateCodeMaterial(program, context)[0]).toMatchObject({ x: 4.5, y: 30, fill: [1, .5, .2, 1] })
    for (const expression of ['ctx.params.lamp.missing', 'ctx.params.p.z', 'ctx.params.g[0].missing']) {
      try { compileCodeMaterial(source({ lamp: { type: 'light', title: '灯', default: {} }, p: basic.point, g: basic.gradient }, `return [rect({x:${expression},y:0,width:1,height:1})];`, { light })); throw new Error('应拒绝字段') }
      catch (error) { expect(error).toMatchObject({ code: 'TYPE', message: expect.stringContaining('可用字段') }) }
    }
  })
})

describe('参数采样、动画及持久化', () => {
  it('三个新内置函数用CPU帧级表达式求值并按真实扫描预算计费', () => {
    expect(sampleCodeGradient(ramp, -.1)).toEqual([0, 0, 0, 0]); expect(sampleCodeGradient(ramp, 2)).toEqual([1, .5, .2, 1])
    expect(sampleCodeGradient(ramp, .5)).toEqual([.5, .25, .1, .5])
    expect(sampleCodeGradient([{ at: .5, color: [1, 0, 0, 1] }, { at: .5, color: [0, 0, 1, 1] }], .5)).toEqual([0, 0, 1, 1])
    expect(sampleCodeCurve(curve, .75)).toBe(.625); expect(sampleCodeCurve(curve, -1)).toBe(0); expect(sampleCodeCurve(curve, 2)).toBe(1)
    expect(easeCodeParameter('quadIn', .5)).toBe(.25); expect(easeCodeParameter([1 / 3, 0, 2 / 3, 1], .5)).toBeCloseTo(.5, 6)
    const program = compileCodeMaterial(source({ g: basic.gradient, c: basic.curve, e: basic.easing }, 'return [rect({x:sampleCurve(ctx.params.c,.75),y:ease(ctx.params.e,.5),width:1,height:1,fill:sampleGradient(ctx.params.g,.5)})];'))
    expect(evaluateCodeMaterial(program, context)[0]).toMatchObject({ x: .625, y: expect.closeTo(.5, 5), fill: [.5, .25, .1, .5] })
    expect(program.metrics.cpuOperations).toBeGreaterThan(640 + 512 + 128)
    expect(() => sampleCodeCurve([{ x: 0, y: 0 }, { x: 0, y: 1 }], .5)).toThrow('首尾')
  })
  it('分量插值：点/区间/grade/角度/结构；离散字段hold，源时间和ease共享原时钟', () => {
    const types = { component: { title: '组件', layout: 'stack', fields: { point: basic.point, grade: basic.grade, color: basic.color, range: basic.range, angle: basic.angle, label: basic.text, seed: basic.seed } } }
    const program = compileCodeMaterial(source({ p: { ...basic.point, animatable: true }, r: { ...basic.range, animatable: true }, a: { ...basic.angle, animatable: true }, g: { ...basic.grade, animatable: true }, light: { type: 'component', title: '组件', default: {}, animatable: true } }, 'return [];', types))
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
    const program = compileCodeMaterial(source({ ...Object.fromEntries(Object.entries(basic).filter(([key]) => key !== 'image').map(([key, value]) => [key, { ...value, animatable: true }])), label: { type: 'label', title: '标签', default: {}, animatable: true } }, 'return [];', types))
    const values = validateCodeMaterialParameters(program)
    const instance = { definitionId: 'd', versionId: 'v', parameters: values, curves: { easing: [{ id: 'e', ...time(0), value: values.easing, interpolation: 'hold' as const }] } }
    expect(codeMaterialInstanceSchema.parse(JSON.parse(JSON.stringify(instance)))).toEqual(instance)
    for (const key of ['gradient', 'curve', 'easing', 'seed', 'font', 'choice', 'boolean', 'text', 'label']) {
      const point = { id: key, ...time(0), value: values[key], interpolation: 'linear' as const }
      expect(() => prepareCodeMaterialParameters(program, codeMaterialInstanceSchema.parse({ ...instance, curves: { [key]: [point] } }))).toThrow('保持')
      expect(prepareCodeMaterialParameters(program, codeMaterialInstanceSchema.parse({ ...instance, curves: { [key]: [{ ...point, interpolation: 'hold' }] } })).curves.has(key)).toBe(true)
    }
    const bad: unknown[] = ['x'.repeat(4097), Infinity, { x: NaN, y: 1 }, { nested: { inner: 1 } }, Array.from({ length: 33 }, (_, i) => ({ at: i / 32, color: [1, 1, 1, 1] })), Array.from({ length: 65 }, (_, i) => ({ x: i / 64, y: .5 }))]
    for (const value of bad) {
      expect(codeMaterialInstanceSchema.safeParse({ definitionId: 'd', versionId: 'v', parameters: { p: value } }).success).toBe(false)
      expect(codeMaterialKeyframeSchema.safeParse({ id: 'p', ...time(0), value, interpolation: 'hold' }).success).toBe(false)
    }
    const many = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`p${i}`, i]))
    expect(codeMaterialInstanceSchema.parse({ definitionId: 'd', versionId: 'v', parameters: many }).parameters).toEqual(many)
  })
})

describe('滤镜参数uniform契约', () => {
  it('基础类型与结构字段只按像素读取占槽，WGSL和打包顺序一致', () => {
    const parameters = { unused: basic.text, a: basic.angle, p: basic.point, r: basic.range, g: basic.grade, seed: basic.seed, flag: basic.boolean, lamp: { type: 'light', title: '灯', default: {} } }
    const program = compileCodeMaterial(source(parameters, 'const lamp=ctx.params.lamp; return rgba(clamp(lamp.power/10+ctx.params.p.x+ctx.params.r[0]/10,0,1),clamp(ctx.params.g.strength,0,1),clamp(ctx.params.a/180+ctx.params.seed/4294967295,0,1),ctx.params.flag?lamp.color.a:1);', { light }, 'filter'))
    const slots = codeFilterParameterSlots(program)
    expect(slots.map(slot => [slot.key, slot.field])).toEqual([['lamp', 'power'], ['p', undefined], ['r', undefined], ['g', undefined], ['a', undefined], ['seed', undefined], ['flag', undefined], ['lamp', 'color']])
    const packed = packCodeFilterParameters(program, validateCodeMaterialParameters(program))
    expect(packed).toHaveLength(256); expect([...packed.slice(0, 12)]).toEqual([2, 0, 0, 0, .25, .75, 0, 0, 2, 4, 0, 0])
    expect([...packed.slice(12, 15)]).toEqual([30, Math.fround(.4), Math.fround(-.2)])
    const wgsl = emitCodeMaterialFilter(program)
    expect(wgsl).toContain('array<vec4f,64>'); expect(wgsl).toContain('p.parameters[1].x'); expect(wgsl).toContain('p.parameters[7]')
  })
  it('64个实际读取槽可用，第65槽明确说明GPU技术限制；未读取参数不计入', () => {
    const parameters = Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`p${i}`, basic.number]))
    const sum = (names: string[]): string => names.length === 1 ? names[0] : `(${sum(names.slice(0, Math.floor(names.length / 2)))}+${sum(names.slice(Math.floor(names.length / 2)))})`
    const body = (count: number) => `return rgba(clamp(${sum(Array.from({ length: count }, (_, i) => `ctx.params.p${i}`))}/1000,0,1),0,0,1);`
    const program = compileCodeMaterial(source(parameters, body(64), {}, 'filter'))
    expect(codeFilterParameterSlots(program)).toHaveLength(64); expect(emitCodeMaterialFilter(program)).toContain('p.parameters[63].x')
    expect(packCodeFilterParameters(program, validateCodeMaterialParameters(program))[63 * 4]).toBe(2)
    expect(() => compileCodeMaterial(source(parameters, body(65), {}, 'filter'))).toThrow('64 槽技术限制')
  })
  it('禁止类型/采样函数的像素读取编译期拒绝，含别名与字段投影；帧级全部可用', () => {
    for (const [key, expression] of [['text', 'ctx.params.text==="x"?1:0'], ['font', 'ctx.params.font==="x"?1:0'], ['choice', 'ctx.params.choice==="soft"?1:0'], ['easing', 'ctx.params.easing[0]'], ['gradient', 'ctx.params.gradient[0].at'], ['curve', 'ctx.params.curve[0].y']] as const) {
      expect(() => compileCodeMaterial(source({ [key]: basic[key] }, `const alias=${expression}; return rgba(alias,0,0,1);`, {}, 'filter'))).toThrow('逐像素')
    }
    for (const expression of ['sampleGradient(ctx.params.gradient,.5)', 'rgba(sampleCurve(ctx.params.curve,.5),0,0,1)', 'rgba(ease(ctx.params.easing,.5),0,0,1)']) expect(() => compileCodeMaterial(source(basicWithoutImage(), `return ${expression};`, {}, 'filter'))).toThrow('CPU 帧级')
    expect(() => compileCodeMaterial(source({ p: { ...basic.point, space: 'pixels' } }, 'return rgba(clamp(ctx.params.p.x,0,1),0,0,1);', {}, 'filter'))).toThrow('frame 空间')
    const program = compileCodeMaterial(source(basicWithoutImage(), 'const amount=(ctx.params.choice==="soft"?sampleCurve(ctx.params.curve,.75):ease(ctx.params.easing,.5)); return shaderFilter("pass",{amount:amount,color:sampleGradient(ctx.params.gradient,.5)});', {}, 'filter', 'shaders:{pass:{kind:"filter",props:{amount:{default:0},color:{type:"color",default:"white"}},wgsl:"return child;"}},'))
    expect(codeFilterParameterSlots(program)).toHaveLength(0); expect(emitCodeMaterialFilter(program)).toContain('codeShader0')
    if (program.result.kind !== 'v3call') throw new Error('需要 shaderFilter')
    expect(evaluateCodeFrameExpression(program, program.result.args[1], context, {})).toEqual({ amount: .625, color: [.5, .25, .1, .5] })
  })
})
function basicWithoutImage(): Record<string, unknown> { return Object.fromEntries(Object.entries(basic).filter(([key]) => key !== 'image')) }
