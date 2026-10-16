import { describe, expect, it, vi } from 'vitest'
import { CODE_V3_LIMITS, CodeMaterialError } from './contract'
import type { CodeMaterialContext, CodeMaterialProgram } from './contract'
import { compileCodeMaterial } from './compiler'
import { evaluateCodeMaterialV3, evaluateCodeFrameExpressions } from './evaluateV3'
import { evaluateCodeMaterialV3 as reference, evaluateCodeFrameExpressions as referenceExpressions } from './__fixtures__/evaluateV3.reference'
import { codeExecutionCache } from './executionCache'
import type { CodeExecutionFrame } from './executionCache'
import { codeExecutionCompiler, codeTextRequest } from './executionPlan'
import { validateCodeMaterialParameters } from './parameters'
import { layoutCodeText } from './textLayout'
import type { CodeHeavyStructure } from './performance'

const context: CodeMaterialContext = { time: .2, localTime: .2, sequenceTime: .2, frame: 6, fps: 30, width: 1920, height: 1080 }
const source = (body: string, parameters = '{}'): string => `export default {apiVersion:1,languageVersion:3,name:'closures',kind:'generator',mode:'dynamic',width:1920,height:1080,durationSeconds:6,seed:7,parameters:${parameters},render(ctx){${body}}}`
const measureText = (request: Parameters<typeof layoutCodeText>[0]): ReturnType<typeof layoutCodeText> => layoutCodeText(request, text => Array.from(text).length * request.fontSize * .6)

// Exercise the same compiled binding/result closures while exposing their work
// counter. The frozen interpreter has only counter observation/start injection.
function compiledCost(program: CodeMaterialProgram, initialOperations = 0): number {
  const parameters = validateCodeMaterialParameters(program, {})
  const cache = codeExecutionCache(program, parameters, context)
  const frame: CodeExecutionFrame = {
    context, parameters, cache, epoch: cache.epoch, bindings: [], locals: new Map(), indices: [], draws: 0, characters: 0, operations: initialOperations, prepaid: false, bindingsReady: false,
    charge(cost = 1) { if (frame.prepaid) return
      frame.operations += cost
      if (frame.operations > CODE_V3_LIMITS.cpuOperations) throw new CodeMaterialError('BUDGET', `CPU 工作量 ${frame.operations} / ${CODE_V3_LIMITS.cpuOperations}，超出 ${frame.operations - CODE_V3_LIMITS.cpuOperations}；当前结构见源码位置。`)
    },
    measure(fields) {
      const request = codeTextRequest(fields)
      frame.charge(request.text.length * (request.maxLines ? 32 : 2))
      return measureText(request)
    },
  }
  const compile = codeExecutionCompiler(program)
  program.bindings.forEach((binding, index) => { if (!(index in frame.bindings)) frame.bindings[index] = compile(binding.expression).run(frame, 0) })
  frame.bindingsReady = true
  compile(program.result).run(frame, 0)
  return frame.operations
}
function failure(run: () => unknown): { code: string; message: string; sourceSpan: unknown } {
  try { run() } catch (error) {
    expect(error).toBeInstanceOf(CodeMaterialError)
    const value = error as CodeMaterialError
    return { code: value.code, message: value.message, sourceSpan: value.sourceSpan }
  }
  throw new Error('Expected a CodeMaterialError')
}

describe('闭包执行的计费、缓存与诊断边界', () => {
  it('绑定初始化内的 repeat 同样缓存，但保留滤镜入口的惰性绑定计费', () => {
    const program = compileCodeMaterial(source('const size=20;const dots=repeat(8,i=>rect({x:random(i*5+1)*size+ctx.time,y:i,width:1,height:1,fill:[1,0,0,1]}));return dots;'))
    evaluateCodeMaterialV3(program, context, {})
    const spy = vi.spyOn(Math, 'imul')
    try {
      const next = { ...context, time: 1, frame: 30 }
      const commands = evaluateCodeMaterialV3(program, next, {})
      expect(spy).not.toHaveBeenCalled()
      expect(commands).toStrictEqual(reference(structuredClone(program), next, {}))
    } finally { spy.mockRestore() }
    let cost = 0
    const original = structuredClone(program)
    reference(original, context, {}) // Match the literal-color warmup state.
    reference(original, context, {}, { onOperations: value => { cost = value } })
    expect(compiledCost(program)).toBe(cost)
    const partial = compileCodeMaterial(source('const a=random(5)*20;const b=a+ctx.time;return [rect({x:b,y:0,width:1,height:1,fill:[1,0,0,1]})];'))
    const oldPartial = structuredClone(partial)
    for (const time of [0, 1, 0]) {
      const ctx = { ...context, time }
      expect(evaluateCodeFrameExpressions(partial, [partial.bindings[1].expression], ctx, {}))
        .toStrictEqual(referenceExpressions(oldPartial, [oldPartial.bindings[1].expression], ctx, {}))
    }
  })

  it('只重算随时间变化的部分；参数原地修改、seed、画幅改变使循环缓存失效', () => {
    const program = compileCodeMaterial(source('return repeat(8,i=>rect({x:random(i*5+1)*ctx.params.size+ctx.time,y:random(i*5+2)*ctx.width,width:1,height:1,fill:[random(i*5+3),0,0,1]}));', '{size:{type:"number",title:"尺寸",min:0,max:100,step:1,default:20}}'))
    const values = { size: 20 }
    const spy = vi.spyOn(Math, 'imul')
    try {
      evaluateCodeMaterialV3(program, context, values)
      expect(spy).toHaveBeenCalled()
      spy.mockClear()
      const nextContext = { ...context, time: 1, frame: 30 }
      const next = evaluateCodeMaterialV3(program, nextContext, values)
      expect(spy).not.toHaveBeenCalled()
      expect(next).toStrictEqual(reference(structuredClone(program), nextContext, values))
      for (const nextContext of [context, { ...context, seed: 99 }, { ...context, width: 1280 }]) {
        values.size++
        spy.mockClear()
        const result = evaluateCodeMaterialV3(program, nextContext, values)
        expect(spy).toHaveBeenCalled()
        expect(result).toStrictEqual(reference(structuredClone(program), nextContext, values))
      }
    } finally { spy.mockRestore() }
  })

  it('嵌套 repeat、逐字计数、短路、复合参数、负零与音频变化不复用错误结果', () => {
    const bodies = [
      'return repeat(3,i=>repeat(2,j=>rect({x:random(i*5+j)*20,y:sin(ctx.time+j),width:1,height:1,fill:[1,0,0,1]})));',
      'return [text({x:0,y:0,text:ctx.params.title,fontSize:32,perChar:(i,n)=>({x:random(i*5+1)*n,y:i+ctx.time,opacity:1})})];',
      'return repeat(2,i=>rect({x:ctx.params.size===0?0:sqrt(ctx.params.size),y:i,width:1,height:1,opacity:ctx.params.size>0&&ctx.time>0?1:0,fill:ctx.params.tint}));',
      'return repeat(3,i=>rect({x:mod(ctx.params.size,2)+i,y:ctx.audio.level()+ctx.audio.band("bass"),width:1,height:1,fill:[1,0,0,1]}));',
    ]
    const parameters = '{title:{type:"text",title:"标题",default:"标题",maxLength:20},size:{type:"number",title:"值",min:0,max:100,step:1,default:4},tint:{type:"color",title:"颜色",default:[1,0,0,1]}}'
    for (const body of bodies) {
      const program = compileCodeMaterial(source(body, parameters)); const original = structuredClone(program)
      for (const size of [4, -0, 0, 9]) for (const time of [1, 0, .5, 1]) {
        const values = { size, title: time ? '更长的标题' : '短', tint: [time, 0, .5, 1] }
        const ctx = { ...context, time, localTime: time, frame: Math.round(time * 30), audio: { fps: 2, duration: 2, levels: [time, .2, .3, .4], bands: { bass: [.2, .3, time, .5], mid: [0, 0, 0, 0], treble: [0, 0, 0, 0] }, beats: [0, 1], onsets: [.1], bpm: 120, beatsPerBar: 4, barOrigin: 0 } }
        expect(evaluateCodeMaterialV3(program, ctx, values, { measureText })).toStrictEqual(reference(original, ctx, values, { measureText }))
      }
    }
  })

  it('缓存前后成本相等，预算边界保留第一处失败的计费量、消息和源码位置', () => {
    const bodies = [
      'return repeat(10,i=>rect({x:random(i*5+1)*100+sin(ctx.time),y:i,width:2,height:2,fill:[1,0,0,1]}));',
      'const a=sin(ctx.time);return [text({x:0,y:0,fontSize:32,text:formatNumber(a,{decimals:2})}),text({x:0,y:40,fontSize:32,text:"AB",perChar:(i,n)=>({x:i*n+random(i),opacity:1})})];',
      'return repeat(3,i=>rect({x:i>0?sin(i):0,y:0,width:1,height:1,fill:[1,0,0,1]}));',
    ]
    for (const body of bodies) {
      const program = compileCodeMaterial(source(body)); const original = structuredClone(program)
      let cost = 0
      for (let pass = 0; pass < 3; pass++) {
        reference(original, context, {}, { measureText, onOperations: operations => { cost = operations } })
        expect(compiledCost(program)).toBe(cost)
      }
      for (const remaining of [1, 2, 10, 31, 80, cost - 1, cost].filter(value => value <= cost)) {
        const initialOperations = CODE_V3_LIMITS.cpuOperations - remaining
        if (remaining === cost) { expect(compiledCost(program, initialOperations)).toBe(CODE_V3_LIMITS.cpuOperations); continue }
        expect(failure(() => compiledCost(program, initialOperations))).toStrictEqual(failure(() => reference(original, context, {}, { measureText, initialOperations })))
      }
    }
  })

  it.each(['sqrt(-1)', '1/(ctx.time-ctx.time)', 'exp(1000)', 'random(-1)', '[1,2][5]'])('%s 错误点名与源码位置不变', expression => {
    const program = compileCodeMaterial(source(`return repeat(2,i=>rect({x:${expression},y:i,width:1,height:1,fill:[1,0,0,1]}));`))
    expect(failure(() => evaluateCodeMaterialV3(program, context, {}))).toStrictEqual(failure(() => reference(structuredClone(program), context, {})))
  })

  it('profile 模式保留最重结构；已缓存结果不能跳过节点计时', () => {
    const program = compileCodeMaterial(source('return repeat(4,i=>rect({x:random(i)*100+sin(ctx.time),y:i,width:1,height:1,fill:[1,0,0,1]}));'))
    evaluateCodeMaterialV3(program, context, {})
    let clock = 0
    const spy = vi.spyOn(performance, 'now').mockImplementation(() => ++clock)
    try {
      let expected: CodeHeavyStructure | undefined; let actual: CodeHeavyStructure | undefined
      reference(structuredClone(program), context, {}, { onProfile: entry => { expected = entry } })
      clock = 0
      evaluateCodeMaterialV3(program, context, {}, { onProfile: entry => { actual = entry } })
      expect(actual).toStrictEqual(expected)
      // Compiled slots survive; their measured entries must belong to each
      // evaluation, including a different program with the same slot numbers.
      for (const current of [compileCodeMaterial(source('return [rect({x:0,y:0,width:1,height:1,fill:[1,0,0,1]})];')), program, program]) {
        clock = 0
        reference(structuredClone(current), context, {}, { onProfile: entry => { expected = entry } })
        clock = 0
        evaluateCodeMaterialV3(current, context, {}, { onProfile: entry => { actual = entry } })
        expect(actual).toStrictEqual(expected)
      }
    } finally { spy.mockRestore() }
  })

  it('缓存有硬上限，容量耗尽不改变结果，参数变化释放旧缓存', () => {
    const terms = Array.from({ length: 12 }, (_, i) => `random(i*13+${i})`).join('+')
    const program = compileCodeMaterial(source(`return repeat(4096,i=>rect({x:${terms},y:0,width:1,height:1,fill:[1,0,0,1]}));`))
    const first = evaluateCodeMaterialV3(program, context, {})
    expect(evaluateCodeMaterialV3(program, context, {})).toStrictEqual(first)
    expect(first).toStrictEqual(reference(structuredClone(program), context, {}))
    const cache = codeExecutionCache(program, {}, context)
    expect(cache.size).toBeGreaterThan(0)
    expect(cache.size).toBeLessThanOrEqual(32768)
    const changed = codeExecutionCache(program, {}, { ...context, seed: 88 })
    expect(changed).not.toBe(cache)
    expect(changed.size).toBe(0)
  })
})
