import { describe, expect, it, vi } from 'vitest'
import { compileCodeMaterial } from './compiler'
import { CodeMaterialError } from './contract'
import type { CodeMaterialContext } from './contract'
import { codeMaterialRandom, evaluateCodeMaterial } from './evaluate'
import { checkCodeMaterialParameterCompatibility, validateCodeMaterialParameters } from './parameters'

const context: CodeMaterialContext = { time: 1, localTime: .5, sequenceTime: 6, width: 3840, height: 2160, frame: 60, fps: 60 }
function source(body: string, options: { kind?: 'generator' | 'filter'; mode?: 'static' | 'dynamic'; parameters?: string; seed?: number } = {}): string {
  return `export default { apiVersion: 1, name: "新代码素材", kind: "${options.kind ?? 'generator'}", mode: "${options.mode ?? 'dynamic'}", width: 3840, height: 2160, durationSeconds: 10, seed: ${options.seed ?? 42}, parameters: ${options.parameters ?? '{}'}, render(ctx) { ${body} } }`
}
const rect = 'rect({x:0,y:0,width:300,height:180,fill:[1,.5,0,.5]})'
const numberParameter = '{amount:{type:"number",title:"强度",description:"改变图形或滤镜强度",default:.5,min:0,max:1,step:.01,unit:"",animatable:true}}'
function rejects(code: string, expectedCode?: string): void {
  try { compileCodeMaterial(code); throw new Error('危险源码未被拒绝') } catch (error) { expect(error).toBeInstanceOf(CodeMaterialError); if (expectedCode) expect((error as CodeMaterialError).code).toBe(expectedCode) }
}

describe('可创作的唯一作者接口', () => {
  it('原始解析诊断定位缺少表达式的行列，便于编辑后恢复', () => {
    expect(() => compileCodeMaterial('export default {\napiVersion:\n}')).toThrow('（3:1）')
  })
  it('静态透明图形可结构化克隆，包含新矩形、椭圆与线段', () => {
    const program = compileCodeMaterial(source(`return [${rect}, ellipse({x:420,y:100,width:120,height:80,fill:[0,1,0,.25]}),line({x1:0,y1:0,x2:100,y2:100,width:6,color:[1,1,1,.75]})];`, { mode: 'static' }))
    const cloned = structuredClone(program)
    expect(cloned).toEqual(program)
    expect(evaluateCodeMaterial(cloned, context)).toEqual([
      { kind: 'rect', x: 0, y: 0, width: 300, height: 180, fill: [1, .5, 0, .5], radius: 0 },
      { kind: 'ellipse', x: 420, y: 100, width: 120, height: 80, fill: [0, 1, 0, .25] },
      { kind: 'line', x1: 0, y1: 0, x2: 100, y2: 100, width: 6, color: [1, 1, 1, .75] },
    ])
    expect(evaluateCodeMaterial(cloned, { ...context, time: 8, localTime: 4, sequenceTime: 20, frame: 480 })).toEqual(evaluateCodeMaterial(cloned, context))
  })
  it('动态标题用参数单源以及三个显式时间，不借用墙钟', () => {
    const parameters = '{title:{type:"text",title:"标题",description:"屏幕标题",default:"你好",maxLength:80,animatable:false},ink:{type:"color",title:"颜色",default:[.1,.5,1,.8]},visible:{type:"boolean",title:"显示",default:true},align:{type:"choice",title:"对齐",default:"center",options:["left","center","right"]}}'
    const program = compileCodeMaterial(source('const x = ctx.width * .5 + sin(ctx.time) * 40; return [text({x:x,y:ctx.localTime*100+ctx.sequenceTime,text:ctx.params.visible?ctx.params.title:"",fontSize:120,color:ctx.params.ink,align:ctx.params.align})];', { parameters }))
    expect(program.parameters.map(item => item.key)).toEqual(['title', 'ink', 'visible', 'align'])
    expect(evaluateCodeMaterial(program, context, { title: '新源码标题', ink: [1, 0, .5, .7] })[0]).toMatchObject({ kind: 'text', text: '新源码标题', x: 1920 + Math.sin(1) * 40, y: 56, color: [1, 0, .5, .7], align: 'center' })
    expect(evaluateCodeMaterial(program, context, { visible: false })[0]).toMatchObject({ text: '' })
    expect(program.bindings[0].expression.type).toBe('number')
  })
  it('单输入可调滤镜保留类型化IR，const采样只计一次且CPU不执行像素', () => {
    const program = compileCodeMaterial(source('const pixel = sample(ctx.u,ctx.v); const a = ctx.params.amount; return rgba(clamp(pixel.r*a,0,1),pixel.g,pixel.b,pixel.a);', { kind: 'filter', parameters: numberParameter }))
    expect(program.metrics.samples).toBe(1)
    expect(program.metrics.scalarOperations).toBe(3)
    expect(program.bindings[0].expression).toMatchObject({ kind: 'call', op: 'sample', type: 'color', args: [{ kind: 'context', key: 'u', type: 'number' }, { kind: 'context', key: 'v', type: 'number' }] })
    expect(program.result).toMatchObject({ kind: 'call', op: 'rgba', type: 'color' })
    expect(structuredClone(program)).toEqual(program)
    expect(() => evaluateCodeMaterial(program, context)).toThrow('滤镜由可信 GPU')
    rejects(source(`return [${rect.replace('x:0', 'x:ctx.u')}];`), 'SYNTAX')
  })
})

describe('纯函数求值与有限输出', () => {
  it('乱序同帧、参数、种子及重新编译得到相同结果', () => {
    const code = source('const r = random(7); const y = mix(20,400,ctx.params.amount); return [rect({x:ctx.time*100+r*50,y:y,width:ctx.width*.1,height:80,fill:[ctx.params.amount,0,1,.5]})];', { parameters: numberParameter })
    const first = compileCodeMaterial(code); const second = compileCodeMaterial(code)
    const at = (time: number): CodeMaterialContext => ({ ...context, time, frame: Math.round(time * 60) })
    const expected = new Map([0, .25, 1, 4, 9].map(time => [time, evaluateCodeMaterial(first, at(time))]))
    for (const time of [9, 1, 0, 4, .25, 1]) expect(evaluateCodeMaterial(second, at(time))).toEqual(expected.get(time))
    expect(evaluateCodeMaterial(first, context, { amount: .8 })).not.toEqual(evaluateCodeMaterial(first, context))
    expect(evaluateCodeMaterial(first, { ...context, seed: 43 })).not.toEqual(evaluateCodeMaterial(first, context))
    expect(evaluateCodeMaterial(first, context)).toEqual(evaluateCodeMaterial(compileCodeMaterial(code), context))
    expect(codeMaterialRandom(42, 7)).toBe(codeMaterialRandom(42, 7))
    expect(() => codeMaterialRandom(1, .5)).toThrow(CodeMaterialError)
  })
  it('const绑定不展开，安全条件分支只求值选中分支', () => {
    const program = compileCodeMaterial(source(`const zero = ctx.time-ctx.time; const x = ctx.params.amount>0?100:1/zero; return [${rect.replace('x:0', 'x:x')}];`, { parameters: numberParameter }))
    expect(evaluateCodeMaterial(program, context)[0]).toMatchObject({ x: 100 })
    expect(() => evaluateCodeMaterial(program, context, { amount: 0 })).toThrow(CodeMaterialError)
  })
  it('非有限结果、无效图形、文本与输入在提交给渲染器前被拒绝', () => {
    rejects(source(`return [${rect.replace('x:0', 'x:1/0')}];`), 'NON_FINITE')
    rejects(source(`return [${rect.replace('x:0', 'x:1e999')}];`), 'NON_FINITE')
    const nonfinite = compileCodeMaterial(source(`const denominator = ctx.time-1; return [${rect.replace('x:0', 'x:1/denominator')}];`))
    expect(() => evaluateCodeMaterial(nonfinite, context)).toThrow(CodeMaterialError)
    expect(() => evaluateCodeMaterial(compileCodeMaterial(source(`return [${rect.replace('width:300', 'width:-1')}];`)), context)).toThrow(CodeMaterialError)
    expect(() => evaluateCodeMaterial(compileCodeMaterial(source(`return [${rect.replace('fill:[1,.5,0,.5]', 'fill:[2,0,0,1]')}];`)), context)).toThrow(CodeMaterialError)
    const title = 'text({x:0,y:0,text:ctx.params.title,fontSize:100,color:[1,1,1,1]})'
    const long = compileCodeMaterial(source(`return [${title},${title},${title}];`, { parameters: '{title:{type:"text",title:"标题",default:"",maxLength:4096}}' }))
    expect(() => evaluateCodeMaterial(long, context, { title: '字'.repeat(3000) })).toThrow('文本字符')
    expect(() => evaluateCodeMaterial(compileCodeMaterial(source(`return [${rect}];`)), { ...context, fps: 0 })).toThrow(CodeMaterialError)
    expect(() => evaluateCodeMaterial(compileCodeMaterial(source(`return [${rect}];`)), { ...context, seed: -1 })).toThrow(CodeMaterialError)
  })
  it('文本总量按实际输出计费，别名和条件重复不能绕过预算', () => {
    const parameters = '{title:{type:"text",title:"标题",default:"",maxLength:4096},visible:{type:"boolean",title:"显示",default:true}}'
    const declaration = 'const t=text({x:0,y:0,text:ctx.params.title,fontSize:100,color:[1,1,1,1]});'
    const repeated = compileCodeMaterial(source(`${declaration} return [t,t,t];`, { parameters }))
    expect(() => evaluateCodeMaterial(repeated, context, { title: '字'.repeat(3000) })).toThrow('本帧文本字符总数')
    expect(evaluateCodeMaterial(repeated, context, { title: '字'.repeat(2700) })).toHaveLength(3)
    const conditional = compileCodeMaterial(source(`${declaration} const r=${rect}; return [ctx.params.visible?t:r,ctx.params.visible?t:r,ctx.params.visible?t:r];`, { parameters }))
    expect(() => evaluateCodeMaterial(conditional, context, { title: '字'.repeat(3000) })).toThrow('本帧文本字符总数')
    expect(evaluateCodeMaterial(conditional, context, { title: '字'.repeat(3000), visible: false }).every(draw => draw.kind === 'rect')).toBe(true)
    const maximumAliases = compileCodeMaterial(source(`${declaration} return [${Array.from({ length: 256 }, () => 't').join(',')}];`, { parameters }))
    expect(() => evaluateCodeMaterial(maximumAliases, context, { title: '字'.repeat(4096) })).toThrow('本帧文本字符总数')
  })
})

describe('默认拒绝与资源边界', () => {
  it('拒绝宿主、网络、模块、原型、循环、赋值、隐式求值及未知AST', () => {
    const bodies = [
      'return [process.exit()];', 'return [fetch("x")];', 'return [globalThis];', 'return [window.document];', 'return [new Function("return 1")()];',
      'while(true){} return [];', 'for(;;){} return [];', 'try{}catch(e){} return [];', 'throw 1; return [];', 'let x=0; return [];',
      'const x=0; x=1; return [];', 'const x=()=>x(); return [];', 'const x=await Promise.resolve(1); return [];', 'return [...[]];',
      'return [ctx["time"]];', 'return [ctx.params.constructor];', 'return [ctx.time.toString()];', 'return [ctx?.time];',
      'const x={get value(){return 1}}; return [];', 'const x=1 as number; return [];', 'const x=1; return [x++];',
    ]
    for (const body of bodies) rejects(source(body))
    rejects(`import fs from "node:fs"; ${source('return [];')}`)
    rejects(source('return [];').replace('render(ctx)', 'async render(ctx)'))
    rejects(source('return [];').replace('parameters: {}', 'parameters:{constructor:{type:"boolean",title:"x",default:true}}'))
    rejects(source('return [];').replace('name: "新代码素材"', 'name: "x", name: "y"'))
    rejects(source('return [];').replace('parameters: {}', 'parameters:{a:{type:"boolean",title:"x",default:true,get animatable(){return true}}}'))
  })
  it('静态输出拒绝所有时间依赖，类型错误默认拒绝', () => {
    for (const key of ['time', 'localTime', 'sequenceTime', 'frame', 'fps']) rejects(source(`const x=ctx.${key}; return [${rect}];`, { mode: 'static' }))
    for (const body of ['return rgba(1,1,1,1);', 'return [rect({x:"x",y:0,width:1,height:1,fill:[1,1,1,1]})];', 'const x=ctx.time+true; return [];', 'return [sample(0,0)];']) rejects(source(body))
    rejects(source('return true;', { kind: 'filter' }), 'TYPE')
  })
  it('源码、AST数量、深度、CPU操作、图形和滤镜预算均有拒绝证据', () => {
    rejects(source('return [];') + ' '.repeat(65536), 'SOURCE_LIMIT')
    rejects(source(`const x=${'('.repeat(70)}1${')'.repeat(70)};return [];`), 'BUDGET')
    rejects(source(`return [${Array.from({ length: 257 }, () => rect).join(',')}];`), 'BUDGET')
    const overScalar = `${Array.from({ length: 129 }, (_, index) => `const v${index}=sin(ctx.time);`).join('')}return rgba(0,0,0,1);`
    rejects(source(overScalar, { kind: 'filter' }), 'BUDGET')
    rejects(source('const a=sample(0,0);const b=sample(0,0);const c=sample(0,0);const d=sample(0,0);const e=sample(0,0);return a;', { kind: 'filter' }), 'BUDGET')
    rejects(source(`${Array.from({ length: 1150 }, (_, index) => `const v${index}=sin(1);`).join('')}return [];`), 'BUDGET')
    rejects(source(`${Array.from({ length: 2500 }, (_, index) => `const v${index}=1;`).join('')}return [];`), 'BUDGET')
    const safe = compileCodeMaterial(source(`return [${rect}];`))
    const huge = { ...safe, bindings: Array.from({ length: 1500 }, (_, index) => ({ name: `v${index}`, expression: { kind: 'call' as const, type: 'number' as const, op: 'sin' as const, args: [{ kind: 'literal' as const, type: 'number' as const, value: 1 }] } })) }
    expect(() => evaluateCodeMaterial(huge, context)).toThrow('CPU 操作预算')
    const declarations = Object.fromEntries(Array.from({ length: 33 }, (_, index) => [`p${index}`, { type: 'boolean', title: '参数', default: true }]))
    rejects(source('return [];', { parameters: JSON.stringify(declarations) }), 'BUDGET')
  })
  it('超长源码在UTF8编码分配前拒绝，短字符数仍按实际UTF8字节限额', () => {
    const encode = vi.spyOn(TextEncoder.prototype, 'encode')
    try {
      rejects(' '.repeat(65537), 'SOURCE_LIMIT')
      expect(encode).not.toHaveBeenCalled()
      rejects('字'.repeat(21846), 'SOURCE_LIMIT')
      expect(encode).toHaveBeenCalledOnce()
    } finally { encode.mockRestore() }
  })
  it('随机哈希按至少12个标量操作计费，const投影仍只计算一次', () => {
    const one = compileCodeMaterial(source('const r=random(7);return rgba(r,r,r,1);', { kind: 'filter' }))
    expect(one.metrics.scalarOperations).toBeGreaterThanOrEqual(12)
    expect(one.metrics.cpuOperations).toBeGreaterThanOrEqual(12)
    const over = `${Array.from({ length: 11 }, (_, index) => `const r${index}=random(${index});`).join('')}return rgba(r0,r0,r0,1);`
    rejects(source(over, { kind: 'filter' }), 'BUDGET')
  })
  it('余数按四次操作计费，真实单输入滤镜超过128操作时拒绝', () => {
    const body = (count: number): string => `const pixel=sample(ctx.u,ctx.v);${Array.from({ length: count }, (_, index) => `const r${index}=pixel.r%.25;`).join('')}return rgba(r0,r0,r0,pixel.a);`
    const boundary = compileCodeMaterial(source(body(32), { kind: 'filter' }))
    expect(boundary.metrics.scalarOperations).toBe(128)
    expect(boundary.metrics.samples).toBe(1)
    rejects(source(body(33), { kind: 'filter' }), 'BUDGET')
  })
  it('颜色条件选择按四通道计费，超过128操作时拒绝', () => {
    const parameters = '{flag:{type:"boolean",title:"开关",default:true}}'
    const body = (count: number): string => `const pixel=sample(ctx.u,ctx.v);${Array.from({ length: count }, (_, index) => `const c${index}=ctx.params.flag?pixel:[0,0,0,1];`).join('')}return c0;`
    const boundary = compileCodeMaterial(source(body(32), { kind: 'filter', parameters }))
    expect(boundary.metrics.scalarOperations).toBe(128)
    expect(boundary.metrics.samples).toBe(1)
    rejects(source(body(33), { kind: 'filter', parameters }), 'BUDGET')
  })
})

describe('源码版本参数兼容', () => {
  it('实例不静默丢弃、转换或裁剪，默认值也是唯一声明的一部分', () => {
    const previous = compileCodeMaterial(source(`return [${rect}];`, { parameters: numberParameter }))
    expect(validateCodeMaterialParameters(previous, {})).toEqual({ amount: .5 })
    for (const values of [{ amount: 2 }, { amount: '1' }, { amount: null }, { unknown: .1 }, { amount: Number.NaN }]) expect(() => validateCodeMaterialParameters(previous, values)).toThrow(CodeMaterialError)
    const wider = compileCodeMaterial(source(`return [${rect}];`, { parameters: numberParameter.replace('max:1', 'max:2').replace('default:.5', 'default:.8') }))
    expect(checkCodeMaterialParameterCompatibility(previous, wider, {})).toEqual({ amount: .5 })
    const deleted = compileCodeMaterial(source(`return [${rect}];`))
    const narrowed = compileCodeMaterial(source(`return [${rect}];`, { parameters: numberParameter.replace('max:1', 'max:.75') }))
    const changed = compileCodeMaterial(source(`return [${rect}];`, { parameters: '{amount:{type:"boolean",title:"强度",default:true}}' }))
    for (const next of [deleted, narrowed, changed]) expect(() => checkCodeMaterialParameterCompatibility(previous, next, { amount: .5 })).toThrow('显式迁移')
    const color = compileCodeMaterial(source(`return [${rect}];`, { parameters: '{ink:{type:"color",title:"颜色",default:[0,0,0,1]}}' }))
    expect(() => validateCodeMaterialParameters(color, { ink: [0, 0, 0, 2] })).toThrow(CodeMaterialError)
    const sparse = new Array<number>(4)
    expect(() => validateCodeMaterialParameters(color, { ink: sparse })).toThrow(CodeMaterialError)
    expect(() => validateCodeMaterialParameters(color, { ink: structuredClone(sparse) })).toThrow(CodeMaterialError)
    sparse[0] = 0; sparse[1] = .5; sparse[3] = 1
    expect(() => validateCodeMaterialParameters(color, { ink: sparse })).toThrow(CodeMaterialError)
  })
  it('新增参数保留旧实例，选项与文本上限缩小必须显式迁移', () => {
    const declarations = '{title:{type:"text",title:"标题",default:"旧标题",maxLength:80},choice:{type:"choice",title:"样式",default:"A",options:["A","B"]}}'
    const previous = compileCodeMaterial(source('return [];', { parameters: declarations }))
    const added = compileCodeMaterial(source('return [];', { parameters: declarations.replace(/}$/, ',flag:{type:"boolean",title:"显示",default:true}}') }))
    expect(checkCodeMaterialParameterCompatibility(previous, added, { title: '保存的标题', choice: 'B' })).toEqual({ title: '保存的标题', choice: 'B', flag: true })
    for (const changed of [declarations.replace('maxLength:80', 'maxLength:40'), declarations.replace('["A","B"]', '["A"]')]) expect(() => checkCodeMaterialParameterCompatibility(previous, compileCodeMaterial(source('return [];', { parameters: changed })), { title: 'x', choice: 'A' })).toThrow('显式迁移')
    expect(() => validateCodeMaterialParameters(previous, { title: 'x'.repeat(81) })).toThrow(CodeMaterialError)
    expect(() => validateCodeMaterialParameters(previous, { choice: 'C' })).toThrow(CodeMaterialError)
  })
})
