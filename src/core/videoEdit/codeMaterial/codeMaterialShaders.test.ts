import { describe, expect, it } from 'vitest'
import { compileCodeMaterial } from './compiler'
import { evaluateCodeMaterial, hitTestCodeMaterial } from './evaluate'
import { evaluateCodeFrameExpression } from './evaluateV3'
import { CODE_V3_LIMITS, CodeMaterialError } from './contract'
import { codeShaderFilterPasses, codeShaderParams, listCodeShaders } from './shaders'
import { emitCodeMaterialFilter } from '../../../features/videoEdit/engine/codeGpuFilter'

const source = (body: string, kind = 'generator', parameters = '{}', mode = 'dynamic'): string => `export default {apiVersion:1,languageVersion:3,name:"shaders",kind:"${kind}",mode:"${mode}",width:3840,height:2160,durationSeconds:10,seed:42,parameters:${parameters},render(ctx){${body}}}`
const context = { time: 2, localTime: 2, sequenceTime: 2, width: 3840, height: 2160, frame: 120, fps: 60 }
const shader = (extra = ''): string => `shader({name:"aurora",params:{speed:1,color_b:rgba(.1,.8,.6,1)},x:10,y:20,width:100,height:80,${extra}})`
const rejects = (run: () => unknown, code: string, message?: string): void => {
  try { run(); throw new Error('expected rejection') } catch (error) { expect(error).toBeInstanceOf(CodeMaterialError); expect((error as CodeMaterialError).code).toBe(code); if (message) expect((error as Error).message).toContain(message) }
}
describe('作者语言可信着色器层', () => {
  it('目录派生全部18生成/16滤镜，拒绝跨类别/转场/任意WGSL及未知参数并给出可用项', () => {
    expect(listCodeShaders('background')).toHaveLength(18); expect(listCodeShaders('filter')).toHaveLength(16)
    for (const name of ['chromatic', 'noise_dissolve', 'WGSL', 'shader_aurora']) rejects(() => compileCodeMaterial(source(`return [shader({name:"${name}",x:0,y:0,width:1,height:1})];`)), 'PARAMETERS', '可用名称')
    rejects(() => compileCodeMaterial(source('return [shader({name:"aurora",params:{unknown:1},x:0,y:0,width:1,height:1})];')), 'PARAMETERS', '可用参数')
    rejects(() => compileCodeMaterial(source('return shaderFilter("aurora",{});', 'filter')), 'PARAMETERS')
    rejects(() => compileCodeMaterial(source('return [shader({name:"aurora",params:{speed:5},x:0,y:0,width:1,height:1})];')), 'PARAMETERS', 'speed')
    rejects(() => compileCodeMaterial(source(`return [${shader('blur:1')}];`)), 'SYNTAX')
  })
  it('颜色、默认与覆盖时间、group裁切变换、矩形命中和源码元数据沿共享实现', () => {
    const program = compileCodeMaterial(source(`return [group({id:"g",x:200,y:100,scale:2,clip:{x:0,y:0,width:60,height:60}},[${shader('id:"sky",time:ctx.time*.5')}])];`))
    const [group] = evaluateCodeMaterial(program, context)
    expect(group.kind).toBe('group'); if (group.kind !== 'group') return
    const layer = group.children[0]; expect(layer.kind).toBe('shader'); if (layer.kind !== 'shader') return
    expect(layer.time).toBe(1); expect(parseInt(String(layer.params.color_b).slice(1, 3), 16)).toBe(26); expect(layer.elementId).toBe('sky'); expect(layer.elementPath?.length).toBe(2); expect(layer.sourceSpan?.startLine).toBe(1)
    expect(hitTestCodeMaterial(program, context, {}, { x: 230, y: 150 })?.elementId).toBe('sky')
    expect(hitTestCodeMaterial(program, context, {}, { x: 350, y: 150 })).toBeUndefined()
    rejects(() => compileCodeMaterial(source(`return [${shader('time:1e308')}];`)), 'NON_FINITE')
    const overflowingTime = compileCodeMaterial(source(`return [${shader('time:ctx.time*1e308')}];`)); rejects(() => evaluateCodeMaterial(overflowingTime, { ...context, time: 1 }), 'NON_FINITE')
    const [defaultTime] = evaluateCodeMaterial(compileCodeMaterial(source(`return [${shader()}];`)), context); expect(defaultTime.kind === 'shader' && defaultTime.time).toBe(2)
    rejects(() => compileCodeMaterial(source(`return [${shader()}];`, 'generator', '{}', 'static')), 'TYPE')
    expect(evaluateCodeMaterial(compileCodeMaterial(source(`return [${shader('time:0')}];`, 'generator', '{}', 'static')), context)[0].kind).toBe('shader')
  })
  it('表达式参数运行时严格校验，预算沿嵌套、repeat与别名输出计费', () => {
    const program = compileCodeMaterial(source(`return [${shader('params:{speed:ctx.time}')}];`.replace('params:{speed:1,color_b:rgba(.1,.8,.6,1)},','')))
    expect(evaluateCodeMaterial(program, context)[0].kind).toBe('shader')
    rejects(() => evaluateCodeMaterial(program, { ...context, time: 5 }), 'PARAMETERS', 'speed')
    rejects(() => compileCodeMaterial(source(`return repeat(${CODE_V3_LIMITS.shaderLayers + 1},i=>${shader()});`)), 'BUDGET')
    const alias = compileCodeMaterial(source(`const a=${shader()}; return repeat(4,i=>a);`)); expect(evaluateCodeMaterial(alias, context)).toHaveLength(4)
    const forged = { ...alias, result: { ...alias.result, max: 5, count: { kind: 'literal' as const, type: 'number' as const, value: 5 } } }
    rejects(() => evaluateCodeMaterial(forged, context), 'BUDGET')
  })
  it('滤镜纹理图串接并与采样/模糊/色彩原语组合；参数只在CPU帧级求值', () => {
    const program = compileCodeMaterial(source('const strength=40+sin(ctx.time)*10; const a=shaderFilter("chromatic",{strength:strength}); return saturate(shaderFilter("grain",{speed:ctx.time/2},a),.8);', 'filter'))
    const passes = codeShaderFilterPasses(program); expect(passes.map(value => value.name)).toEqual(['chromatic', 'grain']); expect(passes[1].input).toBe(0)
    const params = codeShaderParams(passes[0].name, 'filter', evaluateCodeFrameExpression(program, passes[0].params, context, {})); expect(params.strength).toBeCloseTo(40+Math.sin(2)*10)
    expect(emitCodeMaterialFilter(program)).toContain('codeShader1'); expect(emitCodeMaterialFilter(program)).not.toContain('sin(p.context0.x)')
    expect(emitCodeMaterialFilter(compileCodeMaterial(source('return clamp(mix(shaderFilter("glass",{}),blur(4),.5),0,1);', 'filter')))).toContain('codeBlur0')
    rejects(() => compileCodeMaterial(source('return shaderFilter("grain",{speed:ctx.u});', 'filter')), 'TYPE')
    rejects(() => compileCodeMaterial(source('const box={speed:ctx.u}; return shaderFilter("grain",{speed:box.speed});', 'filter')), 'TYPE')
    rejects(() => compileCodeMaterial(source('return shaderFilter("grain",{speed:sample(0,0).r});', 'filter')), 'TYPE')
    rejects(() => compileCodeMaterial(source('return shaderFilter("grain",{},sample(0,0));', 'filter')), 'TYPE')
    rejects(() => compileCodeMaterial(source('return shaderFilter("grain",{speed:-5});', 'filter')), 'PARAMETERS')
    const nested = Array.from({length:5}).reduce(value => `shaderFilter("grain",{},${value})`, 'shaderFilter("grain",{})')
    rejects(() => compileCodeMaterial(source(`return ${nested};`, 'filter')), 'BUDGET')
    rejects(() => compileCodeMaterial(source('return clamp(mix(average(repeat(64,i=>shaderFilter("grain",{}))),sample(0,0),.5),0,1);', 'filter')), 'BUDGET')
    const objectAlias = compileCodeMaterial(source('const stages={grain:shaderFilter("grain",{})}; return stages.grain;', 'filter')); expect(emitCodeMaterialFilter(objectAlias)).toContain('codeShader0')
    const shared = compileCodeMaterial(source('const a=shaderFilter("grain",{}); return clamp(mix(a,a,.5),0,1);','filter')); expect(codeShaderFilterPasses(shared)).toHaveLength(1)
  })
})
