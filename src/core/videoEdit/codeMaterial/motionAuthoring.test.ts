import { describe, expect, it, vi } from 'vitest'
import { compileCodeMaterial } from './compiler'
import { evaluateCodeMaterial } from './evaluate'
import type { CodeDrawCommand, CodeTextMeasurer } from './contract'
import { codeMaterialContextForFrame, codeMaterialMotionClock } from '../codeMaterialTiming'
import { evaluateCodeMaterialParameters, prepareCodeMaterialParameters } from '../codeMaterialAnimation'
import { codeMaterialCurvesSchema } from '../codeMaterialAnimation'
import { codeMotionSettings } from './motionSampling'
import { codeVisualCommands } from './visibility'

const rate = { numerator: 60000, denominator: 1001 }
const clip = { start: 60, duration: 120, sourceInUs: 1_000_000, sourceRemainder: { numerator: 1, denominator: 3 } }
const source = (body: string, parameters = '{}') => `export default {apiVersion:2,languageVersion:3,name:"运动层",kind:"generator",mode:"dynamic",width:64,height:64,durationSeconds:8,seed:1,parameters:${parameters},render(ctx){${body}}}`
const rect = 'rect({x:0,y:0,width:8,height:8,fill:[1,0,0,1]})'
const groups = (commands: CodeDrawCommand[]) => commands.filter((command): command is Extract<CodeDrawCommand, { kind: 'group' }> => command.kind === 'group')
const measure: CodeTextMeasurer = request => ({ width: request.text.length * request.fontSize, height: request.fontSize, lines: [request.text], fontSize: request.fontSize, font: 'test', glyphs: [] })

describe('API2 作者运动层', () => {
  it('正式编译和执行计划只重算位姿，绑定与repeat局部值不沿用中心缓存，内容只求值一次', () => {
    const program = compileCodeMaterial(source('const position=ctx.time*100;return repeat(2,i=>group({x:position+i*20,y:16,motionBlur:{}},[text({x:0,y:0,fontSize:10,text:formatNumber(ctx.frame)})]));'))
    const context = codeMaterialContextForFrame(clip, 75, rate, program)
    const motion = codeMaterialMotionClock(clip, 75, rate, program, () => ({}), context)
    const measured = vi.fn(measure)
    const draws = groups(evaluateCodeMaterial(program, context, {}, { motion, measureText: measured }))
    expect(program.motionBlur).toBe(true)
    expect(measured).toHaveBeenCalledTimes(2)
    for (const [index, group] of draws.entries()) {
      expect(group.children[0]).toMatchObject({ kind: 'text', text: '75' })
      expect(group.motionSamples!.length).toBeGreaterThan(1)
      for (const sample of group.motionSamples!) {
        const expected = motion.at(sample.offset)!
        expect(sample.pose!.matrix[4]).toBeCloseTo(expected.context.time * 100 + index * 20, 12)
      }
      expect(new Set(group.motionSamples!.map(sample => sample.pose!.matrix[4])).size).toBeGreaterThan(1)
    }
    expect(draws[1].x).toBe(draws[0].x + 20)
    expect(evaluateCodeMaterial(program, context, {}, { motion, measureText: measure })).toEqual(draws)
  })
  it('关闭后完全保留普通分组结果；中心检查不假造运动时钟；配置与API版本严格检查', () => {
    const body = `return [group({x:ctx.time*10,motionBlur:{enabled:false}},[${rect}])];`
    const program = compileCodeMaterial(source(body)), context = codeMaterialContextForFrame(clip, 75, rate, program)
    const ordinary = compileCodeMaterial(source(body.replace(',motionBlur:{enabled:false}', '')))
    const at = vi.fn(() => { throw new Error('关闭后不取样') })
    expect(codeVisualCommands(evaluateCodeMaterial(program, context, {}, { motion: { available: { start: { numerator: -1, denominator: 1 }, end: { numerator: 1, denominator: 1 } }, at } })).commands).toEqual(codeVisualCommands(evaluateCodeMaterial(ordinary, context)).commands)
    expect(at).not.toHaveBeenCalled()
    expect(groups(evaluateCodeMaterial(compileCodeMaterial(source(`return [group({motionBlur:{}},[${rect}])];`)), context))[0].motionSamples).toBeUndefined()
    expect(() => compileCodeMaterial(source(body).replace('apiVersion:2', 'apiVersion:1'))).toThrow('apiVersion:2')
    expect(() => compileCodeMaterial(source(body).replace('apiVersion:2', 'apiVersion:3'))).toThrow('apiVersion')
    for (const config of [{ shutter: 721 }, { phase: 720, shutter: 1 }, { maxSamples: 0 }, { maxSamples: 1.5 }, { enabled: 'yes' }, { unknown: 1 }]) expect(() => codeMotionSettings(config)).toThrow()
  })
  it('子时刻沿精确源曲线读取；微秒余数可比持久关键帧更细，但落盘schema仍拒绝超范围余数', () => {
    const program = compileCodeMaterial(source(`return [group({x:ctx.params.amount*100,y:16,motionBlur:{shutter:179.123456,maxSamples:64}},[${rect}])];`, '{amount:{type:"number",title:"位置",default:0,min:0,max:1000,step:1,animatable:true}}'))
    const prepared = prepareCodeMaterialParameters(program, { parameters: {}, curves: { amount: [{ id: 'a', sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, value: 0, interpolation: 'linear' }, { id: 'b', sourceInUs: 8_000_000, sourceRemainder: { numerator: 0, denominator: 1 }, value: 800, interpolation: 'linear' }] } })
    const context = codeMaterialContextForFrame(clip, 75, rate, program), parametersAt = (time: Parameters<typeof evaluateCodeMaterialParameters>[1]) => evaluateCodeMaterialParameters(prepared, time)
    const motion = codeMaterialMotionClock(clip, 75, rate, program, parametersAt, context)
    const group = groups(evaluateCodeMaterial(program, context, motion.at({ numerator: 0, denominator: 1 })!.parameters, { motion }))[0]
    expect(group.motionSamples!.some(sample => motion.at(sample.offset)!.sourceTime!.sourceRemainder.denominator > 1_000_000)).toBe(true)
    for (const sample of group.motionSamples!) expect(sample.pose!.matrix[4]).toBeCloseTo(Number(motion.at(sample.offset)!.parameters.amount) * 100, 12)
    const time = { sourceInUs: 0, sourceRemainder: { numerator: 1, denominator: 1_500_001 } }
    expect(Number(parametersAt(time).amount)).toBeGreaterThan(0)
    expect(codeMaterialCurvesSchema.safeParse({ amount: [{ id: 'invalid', ...time, value: 1, interpolation: 'linear' }] }).success).toBe(false)
  })
  it('变速、倒放和缺失源曝光沿正式时钟；乱序及片段移动保持同一源位姿', () => {
    const program = compileCodeMaterial(source(`return [group({x:ctx.time*10,motionBlur:{shutter:720,maxSamples:8}},[${rect}])];`))
    for (const reverse of [false, true]) for (const speed of [{ numerator: 2, denominator: 1 }, { numerator: 1, denominator: 3 }]) {
      const timed = { ...clip, reverse, speed, sourceInUs: 4_000_000 }
      const render = (frame: number, start = 60) => { const input = { ...timed, start }; const context = codeMaterialContextForFrame(input, frame, rate, program); return evaluateCodeMaterial(program, context, {}, { motion: codeMaterialMotionClock(input, frame, rate, program, () => ({}), context) }) }
      const expected = render(75)
      render(80); render(65)
      expect(render(75)).toEqual(expected)
      expect(render(175, 160)).toEqual(expected)
    }
    const zero = { ...clip, sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 } }
    const context = codeMaterialContextForFrame(zero, 75, rate, program)
    const motion = codeMaterialMotionClock(zero, 75, rate, program, () => ({}), context)
    expect(motion.at({ numerator: -1, denominator: 2 })).not.toBeNull()
    const firstContext = codeMaterialContextForFrame(zero, 60, rate, program)
    const handleClock = codeMaterialMotionClock(zero, 60, rate, program, () => ({}), firstContext, { start: 59, end: 62 })
    expect(handleClock.at({ numerator: -1, denominator: 2 })).toBeNull()
    expect(handleClock.at({ numerator: 1, denominator: 2 })).not.toBeNull()
  })
  it('CPU位姿预算与所有运动层共用，超过预算明确拒绝完整帧', () => {
    const program = compileCodeMaterial(source(`return repeat(256,i=>group({x:0,motionBlur:{}},[${rect}]));`))
    const context = codeMaterialContextForFrame(clip, 75, rate, program)
    expect(() => evaluateCodeMaterial(program, context, {}, { motion: codeMaterialMotionClock(clip, 75, rate, program, () => ({}), context) })).toThrow('采样超出预算')
    const work = Array.from({ length: 48 }, (_, index) => `sin(ctx.time+i+${index})`).join('+')
    const costly = compileCodeMaterial(source(`return repeat(64,i=>group({x:${work},motionBlur:{}},[${rect}]));`))
    const costlyContext = codeMaterialContextForFrame(clip, 75, rate, costly)
    expect(() => evaluateCodeMaterial(costly, costlyContext, {}, { motion: codeMaterialMotionClock(clip, 75, rate, costly, () => ({}), costlyContext) })).toThrow(/CPU|工作量/)
  })
  it('别名实例的元素覆盖在探测前按源时刻生效，能揭示零透明层并产生覆盖动画拖影', () => {
    const program = compileCodeMaterial(source(`const layer=group({id:"layer",opacity:0,motionBlur:{}},[${rect}]);return [layer,layer];`))
    const context = codeMaterialContextForFrame(clip, 75, rate, program)
    const motion = codeMaterialMotionClock(clip, 75, rate, program, () => ({}), context)
    const [first, second] = groups(evaluateCodeMaterial(program, context))
    expect(first.elementId).not.toBe(second.elementId)
    const overrides = { [first.elementId!]: { opacity: 1, curves: { dx: [{ id: 'start', sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, value: 0, interpolation: 'linear' as const }, { id: 'end', sourceInUs: 8_000_000, sourceRemainder: { numerator: 0, denominator: 1 }, value: 800, interpolation: 'linear' as const }] } } }
    const result = groups(evaluateCodeMaterial(program, context, {}, { motion, measureText: measure, elementOverrides: overrides, sourceTime: motion.at({ numerator: 0, denominator: 1 })!.sourceTime }))
    expect(result[0].motionSamples!.length).toBeGreaterThan(1)
    for (const sample of result[0].motionSamples!) {
      expect(sample.pose!.opacity).toBe(1)
      expect(sample.pose!.matrix[4]).toBeCloseTo(motion.at(sample.offset)!.context.time * 100, 11)
    }
    expect(result[1].motionSamples!.every(sample => sample.pose === null)).toBe(true)
  })
  it('覆盖缩放使用每个子时刻的作者锚点，静态作者矩阵也能得到正确曝光路径', () => {
    const program = compileCodeMaterial(source(`return [group({id:"anchor",anchorX:ctx.time*4,motionBlur:{}},[${rect}])];`))
    const context = codeMaterialContextForFrame(clip, 75, rate, program), motion = codeMaterialMotionClock(clip, 75, rate, program, () => ({}), context)
    const result = groups(evaluateCodeMaterial(program, context, {}, { motion, measureText: measure, elementOverrides: { anchor: { scale: 2 } }, sourceTime: motion.at({ numerator: 0, denominator: 1 })!.sourceTime }))[0]
    expect(result.motionSamples!.length).toBeGreaterThan(1)
    for (const sample of result.motionSamples!) {
      expect(sample.pose!.matrix[0]).toBe(2)
      expect(sample.pose!.matrix[4]).toBeCloseTo(-motion.at(sample.offset)!.context.time * 4, 12)
    }
  })
  it('外组采样密度包含内组曝光的完整范围，不能仅按内组中心矩形估算旋转路径', () => {
    const program = compileCodeMaterial(source(`return [group({rotation:(ctx.time-1)*720,motionBlur:{}},[group({x:(ctx.time-1)*10000,motionBlur:{}},[${rect}])])];`))
    const timed = { ...clip, sourceInUs: 750000, sourceRemainder: { numerator: 0, denominator: 1 } }, rate = { numerator: 60, denominator: 1 }
    const context = codeMaterialContextForFrame(timed, 75, rate, program)
    const motion = codeMaterialMotionClock(timed, 75, rate, program, () => ({}), context)
    const outer = groups(evaluateCodeMaterial(program, context, {}, { motion }))[0]
    expect(outer.motionSamples!.length).toBeGreaterThanOrEqual(5)
  })
  it('运动蒙版中心透明但快门内可见时保留内容，静态空组仍正常剔除', () => {
    const mask = `group({opacity:max(0,min(1,(ctx.time-1)*240)),motionBlur:{}},[${rect}])`
    const program = compileCodeMaterial(source(`return [group({mask:{shape:${mask}}},[${rect}]),group({opacity:0,mask:{shape:${mask}}},[${rect}]),group({clip:{x:0,y:0,width:0,height:8},mask:{shape:${mask}}},[${rect}])];`))
    const timed = { ...clip, sourceInUs: 750000, sourceRemainder: { numerator: 0, denominator: 1 } }, rate = { numerator: 60, denominator: 1 }
    const context = codeMaterialContextForFrame(timed, 75, rate, program)
    const motion = codeMaterialMotionClock(timed, 75, rate, program, () => ({}), context)
    const [visible, transparent, emptyClip] = groups(evaluateCodeMaterial(program, context, {}, { motion, cullInvisible: true }))
    expect(visible.children).toHaveLength(1)
    const shape = visible.mask!.shape!
    expect(shape.kind).toBe('group')
    if (shape.kind === 'group') expect(shape.motionSamples!.some(sample => sample.pose && sample.pose.opacity > 0)).toBe(true)
    expect(transparent.children).toHaveLength(0)
    expect(emptyClip.children).toHaveLength(0)
  })
})
