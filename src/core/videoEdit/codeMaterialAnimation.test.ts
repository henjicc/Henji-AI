import { describe, expect, it } from 'vitest'
import { compileCodeMaterial } from './codeMaterial/compiler'
import { codeMaterialCurvesSchema, evaluateCodeMaterialParameters, prepareCodeMaterialParameters, proposeCodeMaterialMigration } from './codeMaterialAnimation'
import type { CodeMaterialCurves, CodeMaterialKeyframe } from './codeMaterialAnimation'
import type { CodeMaterialInstance } from './codeMaterialPersistence'
import { offsetVideoEditSource } from './time'

const source = `export default {apiVersion:1,name:"动画",kind:"generator",mode:"dynamic",width:3840,height:2160,durationSeconds:10,seed:1,parameters:{amount:{type:"number",title:"强度",default:5,min:0,max:10,step:1,animatable:true},ink:{type:"color",title:"颜色",default:[0,0,0,0],animatable:true},flag:{type:"boolean",title:"开关",default:false,animatable:true},label:{type:"text",title:"文字",default:"旧",maxLength:20,animatable:true},choice:{type:"choice",title:"选项",default:"a",options:["a","b"],animatable:true}},render(ctx){return [rect({x:ctx.params.amount,y:0,width:100,height:100,fill:ctx.params.ink})];}}`
const program = compileCodeMaterial(source)
const time = (sourceInUs: number) => ({ sourceInUs, sourceRemainder: { numerator: 0, denominator: 1 } })
const point = (id: string, sourceInUs: number, value: CodeMaterialKeyframe['value'], interpolation: CodeMaterialKeyframe['interpolation'] = 'linear'): CodeMaterialKeyframe => ({ id, ...time(sourceInUs), value, interpolation })
const instance = (curves: CodeMaterialCurves, parameters: CodeMaterialInstance['parameters'] = {}): CodeMaterialInstance => ({ definitionId: 'd', versionId: 'v', parameters, curves })
const evaluate = (curves: CodeMaterialCurves, us: number) => evaluateCodeMaterialParameters(prepareCodeMaterialParameters(program, instance(curves)), time(us))
it('代码参数与RGBA共用自定义贝塞尔，源时钟读写保留控制点，离散值继续拒绝平滑插值', () => {
  const curves: CodeMaterialCurves = { amount: [{ ...point('a', 0, 0, 'bezier'), bezier: [1 / 3, 0, 2 / 3, 0] }, point('b', 1e6, 10)], ink: [{ ...point('c', 0, [0, 0, 0, 0], 'bezier'), bezier: [1 / 3, 0, 2 / 3, 0] }, point('d', 1e6, [1, 1, 1, 1])] }
  const saved = codeMaterialCurvesSchema.parse(JSON.parse(JSON.stringify(curves)))
  expect(evaluate(saved, 500000).amount).toBeCloseTo(1.25, 6)
  expect(evaluate(saved, 500000).ink).toEqual(expect.arrayContaining([expect.closeTo(.125, 6)]))
  const overshoot = Object.fromEntries(Object.entries(curves).map(([key, points]) => [key, [{ ...points[0], bezier: [1 / 3, 3, 2 / 3, 3] }, points[1]]])) as CodeMaterialCurves
  expect(evaluate(overshoot, 500000)).toMatchObject({ amount: 10, ink: [1, 1, 1, 1] })
  expect(() => evaluate({ flag: [point('flag', 0, false, 'bezier')] }, 0)).toThrow('保持')
})

describe('连续源时刻的有界代码参数曲线', () => {
  it('数值与RGBA按线性/基础缓动求值，端点之外保持端值', () => {
    const curves = { amount: [point('a', 0, 0), point('b', 1e6, 10)], ink: [point('c', 0, [0, .2, .4, 0], 'ease'), point('d', 1e6, [1, .6, .8, 1])] }
    expect(evaluate(curves, 250000).amount).toBe(2.5)
    expect(evaluate(curves, 250000).ink).toEqual([.15625, .2625, .4625, .15625])
    expect(evaluate(curves, 2e6).amount).toBe(10)
    expect(evaluate(curves, 0).ink).toEqual([0, .2, .4, 0])
    expect(curves.ink[0].value).toEqual([0, .2, .4, 0])
  })
  it('离散值只保持插值，并在指定关键帧边界切换', () => {
    const curves = { flag: [point('a', 0, false, 'hold'), point('b', 1e6, true, 'hold')], label: [point('c', 0, '旧', 'hold'), point('d', 1e6, '新', 'hold')], choice: [point('e', 0, 'a', 'hold'), point('f', 1e6, 'b', 'hold')] }
    expect(evaluate(curves, 999999)).toMatchObject({ flag: false, label: '旧', choice: 'a' })
    expect(evaluate(curves, 1e6)).toMatchObject({ flag: true, label: '新', choice: 'b' })
  })
  it('NTSC分数边界、裁剪与拆分的同一源时刻不重定动画', () => {
    const rate = { numerator: 30000, denominator: 1001 }; const initial = time(0)
    const a = offsetVideoEditSource(initial, 30, rate); const b = offsetVideoEditSource(initial, 120, rate)
    const prepared = prepareCodeMaterialParameters(program, instance({ amount: [{ ...point('a', 0, 0), ...a }, { ...point('b', 0, 10), ...b }] }))
    const original = offsetVideoEditSource(initial, 75, rate)
    const trimmed = offsetVideoEditSource(a, 45, rate)
    const split = offsetVideoEditSource(offsetVideoEditSource(a, 40, rate), 5, rate)
    expect(original).toEqual(trimmed); expect(trimmed).toEqual(split)
    expect(evaluateCodeMaterialParameters(prepared, original).amount).toBe(5)
    expect(evaluateCodeMaterialParameters(prepared, split).amount).toBe(5)
    const rationalBoundary = { ...point('fraction', 33366, 10), sourceRemainder: { numerator: 2, denominator: 3 } }
    const exact = prepareCodeMaterialParameters(program, instance({ amount: [point('zero', 0, 0), rationalBoundary] }))
    expect(evaluateCodeMaterialParameters(exact, offsetVideoEditSource(initial, 1, rate)).amount).toBe(10)
  })
  it('拒绝重复源时刻/标识、越界及未声明或不可动画参数，允许长曲线', () => {
    expect(() => prepareCodeMaterialParameters(program, instance({ amount: [point('a', 1, 0), { ...point('b', 1, 10), sourceRemainder: { numerator: 0, denominator: 2 } }] }))).toThrow('重复关键帧')
    expect(() => codeMaterialCurvesSchema.parse({ amount: [point('same', 0, 0)], ink: [point('same', 1, [1, 1, 1, 1])] })).toThrow('标识')
    expect(codeMaterialCurvesSchema.parse({ amount: Array.from({ length: 1200 }, (_, index) => point(String(index), index, 1)) }).amount).toHaveLength(1200)
    expect(() => prepareCodeMaterialParameters(program, instance({ missing: [point('a', 0, 1)] }))).toThrow('不支持关键帧')
    expect(() => prepareCodeMaterialParameters(program, instance({ amount: [point('a', 0, 11)] }))).toThrow('范围')
    expect(() => prepareCodeMaterialParameters(program, instance({ amount: [point('a', 11e6, 1)] }))).toThrow('时长')
    expect(() => prepareCodeMaterialParameters(program, instance({ flag: [point('a', 0, true)] }))).toThrow('保持')
  })
  it('无曲线不改变默认参数，静态素材可在延长的源范围动画', () => {
    const staticProgram = { ...program, mode: 'static' as const }
    const prepared = prepareCodeMaterialParameters(staticProgram, instance({ amount: [point('a', 100e6, 0), point('b', 200e6, 10)] }))
    expect(evaluateCodeMaterialParameters(prepared, time(150e6)).amount).toBe(5)
    expect(evaluateCodeMaterialParameters(prepareCodeMaterialParameters(program, instance({})), time(0)).amount).toBe(5)
  })
})

describe('源码迁移提案不静默丢值或曲线', () => {
  it('删后面的参数不误删前面的有效曲线；新增参数采用新默认', () => {
    const previous = instance({ amount: [point('a', 0, 1), point('b', 2e6, 7)] }, { amount: 3, flag: true })
    const next = { ...program, parameters: [...program.parameters.filter(parameter => parameter.key !== 'flag'), { key: 'added', title: '新增', description: '', animatable: false, type: 'number' as const, min: 0, max: 20, step: 1, unit: '', default: 12 }] }
    const proposal = proposeCodeMaterialMigration(program, next, previous, 'new')
    expect(proposal.instance.parameters).toMatchObject({ amount: 3, added: 12 })
    expect(proposal.instance.parameters).not.toHaveProperty('flag'); expect(proposal.instance.curves?.amount).toEqual(previous.curves?.amount)
    expect(proposal.impacts).toEqual([{ key: 'flag', title: '开关', reason: '参数已删除', resetValue: true, removeCurve: false }])
    expect(previous.versionId).toBe('v'); expect(previous.parameters.flag).toBe(true)
  })
  it('类型/范围/可动画和时长变化分别说明受影响值与曲线', () => {
    const previous = instance({ amount: [point('a', 0, 1), point('b', 8e6, 9)], flag: [point('c', 0, true, 'hold')] }, { amount: 9, flag: true })
    const next = { ...program, durationSeconds: 5, parameters: program.parameters.map(parameter => parameter.key === 'amount' && parameter.type === 'number' ? { ...parameter, max: 4, default: 2 } : parameter.key === 'flag' ? { ...parameter, animatable: false as const } : parameter) }
    const proposal = proposeCodeMaterialMigration(program, next, previous, 'new')
    expect(proposal.instance.parameters.amount).toBe(2); expect(proposal.instance.curves).toBeUndefined()
    expect(proposal.impacts).toEqual(expect.arrayContaining([expect.objectContaining({ key: 'amount', resetValue: true, removeCurve: true }), expect.objectContaining({ key: 'flag', resetValue: false, removeCurve: true })]))
    const typeChanged = { ...program, parameters: program.parameters.map(parameter => parameter.key === 'amount' ? { key: 'amount', title: '强度', description: '', animatable: false, type: 'text' as const, default: '重置', maxLength: 10 } : parameter) }
    expect(proposeCodeMaterialMigration(program, typeChanged, previous, 'text').impacts).toContainEqual(expect.objectContaining({ key: 'amount', reason: '参数类型已改变', resetValue: true, removeCurve: true }))
  })
})
