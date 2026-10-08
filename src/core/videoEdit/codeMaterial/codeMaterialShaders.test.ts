import { describe, expect, it } from 'vitest'
import { compileCodeMaterial } from './compiler'
import { evaluateCodeMaterial, hitTestCodeMaterial } from './evaluate'
import { evaluateCodeFrameExpression } from './evaluateV3'
import { CODE_V3_LIMITS, CodeMaterialError, type CodeDrawCommand } from './contract'
import { codeShaderFilterPasses, codeShaderGraph } from './shaders'
import { emitCodeMaterialFilter } from '../../../features/videoEdit/engine/codeGpuFilter'

const source = (body: string, kind = 'generator', parameters = '{}', mode = 'dynamic', shaders = ''): string => `export default {apiVersion:1,languageVersion:3,name:"shaders",kind:"${kind}",mode:"${mode}",width:3840,height:2160,durationSeconds:10,seed:42,parameters:${parameters},${shaders ? `shaders:${shaders},` : ''}render(ctx){${body}}}`
const context = { time: 2, localTime: 2, sequenceTime: 2, width: 3840, height: 2160, frame: 120, fps: 60 }
const shader = (extra = ''): string => `shader({name:"Aurora",params:{speed:1,colorB:rgba(.1,.8,.6,1)},x:10,y:20,width:100,height:80,${extra}})`
const rejects = (run: () => unknown, code: string, message?: string): void => {
  try { run(); throw new Error('expected rejection') } catch (error) { expect(error).toBeInstanceOf(CodeMaterialError); expect((error as CodeMaterialError).code).toBe(code); if (message) expect((error as Error).message).toContain(message) }
}
/** 框架颜色串 → 0–255 通道，避免在测试里写十六进制字面量。 */
const channels = (value: unknown): number[] => { const text = String(value); return [1, 3, 5, 7].map(index => parseInt(text.slice(index, index + 2), 16)) }
const layer = (commands: CodeDrawCommand[]): Extract<CodeDrawCommand, { kind: 'shader' }> => { const value = commands[0]; if (value.kind !== 'shader') throw new Error('not a shader'); return value }
const ripple = '{ripple:{kind:"filter",props:{amount:{default:.02,min:0,max:.2}},wgsl:`let w = sin(uv.y * 40.0 + time) * amount;\nreturn textureSample(childTexture, childSampler, uv + vec2f(w, 0.0));`},glow:{kind:"generator",props:{tint:{type:"color",default:"rgb(255, 170, 0)"}},wgsl:"return tint;"}}'

describe('作者语言着色器（shaders 框架组件与自写 WGSL）', () => {
  it('按框架组件名使用，未知名称、类别不符与未知属性给出可用项', () => {
    expect(layer(evaluateCodeMaterial(compileCodeMaterial(source(`return [${shader()}];`)), context)).graph.layers[0]).toMatchObject({ type: 'Aurora', id: 'fx' })
    rejects(() => compileCodeMaterial(source('return [shader({name:"NoSuch",x:0,y:0,width:1,height:1})];')), 'PARAMETERS', '未知着色器')
    rejects(() => compileCodeMaterial(source('return [shader({name:"Blur",x:0,y:0,width:1,height:1})];')), 'PARAMETERS', '滤镜组件')
    rejects(() => compileCodeMaterial(source('return shaderFilter("Aurora",{});', 'filter')), 'PARAMETERS', '不是滤镜组件')
    rejects(() => compileCodeMaterial(source('return [shader({name:"Aurora",params:{unknown:1},x:0,y:0,width:1,height:1})];')), 'PARAMETERS', '可用属性')
    rejects(() => compileCodeMaterial(source(`return [${shader('blur:1')}];`)), 'SYNTAX')
    rejects(() => compileCodeMaterial(source('return [shader({x:0,y:0,width:1,height:1})];')), 'PARAMETERS', 'name')
  })
  it('颜色转框架颜色字符串，默认与覆盖时间、group 裁切变换、命中与源码元数据沿共享实现', () => {
    const program = compileCodeMaterial(source(`return [group({id:"g",x:200,y:100,scale:2,clip:{x:0,y:0,width:60,height:60}},[${shader('id:"sky",time:ctx.time*.5')}])];`))
    const [group] = evaluateCodeMaterial(program, context)
    expect(group.kind).toBe('group'); if (group.kind !== 'group') return
    const value = layer(group.children)
    expect(value.time).toBe(1); expect(channels(value.graph.layers[0].props?.colorB)).toEqual([26, 204, 153, 255]); expect(value.elementId).toBe('sky'); expect(value.elementPath?.length).toBe(2); expect(value.sourceSpan?.startLine).toBe(1)
    expect(hitTestCodeMaterial(program, context, {}, { x: 230, y: 150 })?.elementId).toBe('sky')
    expect(hitTestCodeMaterial(program, context, {}, { x: 350, y: 150 })).toBeUndefined()
    const overflowingTime = compileCodeMaterial(source(`return [${shader('time:ctx.time*1e308')}];`)); rejects(() => evaluateCodeMaterial(overflowingTime, { ...context, time: 1 }), 'NON_FINITE')
    expect(layer(evaluateCodeMaterial(compileCodeMaterial(source(`return [${shader()}];`)), context)).time).toBe(2)
    rejects(() => compileCodeMaterial(source(`return [${shader()}];`, 'generator', '{}', 'static')), 'TYPE')
    expect(layer(evaluateCodeMaterial(compileCodeMaterial(source(`return [${shader('time:0')}];`, 'generator', '{}', 'static')), context)).kind).toBe('shader')
  })
  it('属性可用任意帧表达式；layers 写完整图层树，滤镜组件作用于前面的生成器', () => {
    const program = compileCodeMaterial(source('return [shader({x:0,y:0,width:ctx.width,height:ctx.height,layers:[{type:"MeshGradient",props:{speed:ctx.time/4}},{type:"FilmGrain",id:"grain",props:{strength:.3+sin(ctx.time)*.1}},{type:"Circle",props:{center:[.5,.4],color:rgba(1,1,1,.5),blendMode:"screen"}}]})];'))
    const graph = layer(evaluateCodeMaterial(program, context)).graph
    expect(graph.layers.map(value => value.type)).toEqual(['MeshGradient', 'FilmGrain', 'Circle'])
    expect(graph.layers[0].props?.speed).toBe(0.5); expect(graph.layers[1].props?.strength).toBeCloseTo(.3 + Math.sin(2) * .1)
    expect(graph.layers[2].props).toMatchObject({ center: { x: .5, y: .4 }, blendMode: 'screen' }); expect(channels(graph.layers[2].props?.color)).toEqual([255, 255, 255, 128])
    rejects(() => compileCodeMaterial(source('return [shader({x:0,y:0,width:1,height:1,layers:[{type:"@input"}]})];')), 'PARAMETERS', '@input')
    rejects(() => compileCodeMaterial(source('return [shader({x:0,y:0,width:1,height:1,layers:[{type:"Aurora",props:{nope:1}}]})];')), 'PARAMETERS', '可用属性')
    rejects(() => compileCodeMaterial(source('return [shader({name:"Aurora",x:0,y:0,width:1,height:1,layers:[{type:"Aurora"}]})];')), 'PARAMETERS', '其中之一')
    rejects(() => compileCodeMaterial(source(`return repeat(${CODE_V3_LIMITS.shaderLayers + 1},i=>${shader()});`)), 'BUDGET')
  })
  it('素材里自己写 WGSL 着色器，按名字使用；图里只带用到的定义', () => {
    const program = compileCodeMaterial(source('return [shader({name:"glow",params:{tint:rgba(0,0,1,1)},x:0,y:0,width:10,height:10})];', 'generator', '{}', 'dynamic', ripple))
    expect(program.shaders?.map(value => value.name)).toEqual(['ripple', 'glow'])
    expect(program.shaders?.[0].wgsl).toContain('textureSample(childTexture')
    const graph = layer(evaluateCodeMaterial(program, context)).graph
    expect(graph.shaders?.map(value => value.name)).toEqual(['glow']); expect(channels(graph.layers[0].props?.tint)).toEqual([0, 0, 255, 255])
    rejects(() => compileCodeMaterial(source('return [];', 'generator', '{}', 'dynamic', '{bad:{kind:"other",wgsl:"return vec4f(1.0);"}}')), 'SYNTAX', 'kind')
    rejects(() => compileCodeMaterial(source('return [];', 'generator', '{}', 'dynamic', '{bad:{kind:"filter",wgsl:`return ${1}`}}')), 'SYNTAX', '插值')
    rejects(() => compileCodeMaterial(source('return [shader({name:"ripple",x:0,y:0,width:1,height:1})];', 'generator', '{}', 'dynamic', ripple)), 'PARAMETERS', '滤镜')
    rejects(() => compileCodeMaterial(`export default {apiVersion:1,name:"v1",kind:"generator",mode:"dynamic",width:10,height:10,durationSeconds:1,seed:1,parameters:{},shaders:${ripple},render(ctx){return [];}}`), 'SYNTAX', 'v3')
  })
  it('滤镜纹理图串接框架滤镜与自写滤镜，图层树写法自动垫输入；参数只在帧级求值', () => {
    const program = compileCodeMaterial(source('const s=40+sin(ctx.time)*10; const a=shaderFilter("ChromaticAberration",{strength:s/100}); const b=shaderFilter("ripple",{amount:.05},a); return saturate(shaderFilter({layers:[{type:"Vignette",props:{intensity:.4}}]},b),.8);', 'filter', '{}', 'dynamic', ripple))
    const passes = codeShaderFilterPasses(program)
    expect(passes.map(value => value.name)).toEqual(['ChromaticAberration', 'ripple', undefined]); expect(passes[1].input).toBe(0); expect(passes[2].input).toBe(1)
    const first = codeShaderGraph(program, { name: passes[0].name, params: evaluateCodeFrameExpression(program, passes[0].params!, context, {}) }, 'filter')
    expect(first.layers.map(value => value.type)).toEqual(['@input', 'ChromaticAberration']); expect(first.layers[1].props?.strength).toBeCloseTo((40 + Math.sin(2) * 10) / 100)
    const tree = codeShaderGraph(program, evaluateCodeFrameExpression(program, passes[2].target, context, {}) as { layers: unknown }, 'filter')
    expect(tree.layers.map(value => value.type)).toEqual(['@input', 'Vignette'])
    expect(codeShaderGraph(program, { name: 'ripple', params: {} }, 'filter').shaders?.map(value => value.name)).toEqual(['ripple'])
    expect(emitCodeMaterialFilter(program)).toContain('codeShader2')
    rejects(() => compileCodeMaterial(source('return shaderFilter("FilmGrain",{strength:ctx.u});', 'filter')), 'TYPE')
    rejects(() => compileCodeMaterial(source('return shaderFilter("FilmGrain",{strength:sample(0,0).r});', 'filter')), 'TYPE')
    rejects(() => compileCodeMaterial(source('return shaderFilter("FilmGrain",{},sample(0,0));', 'filter')), 'TYPE')
    const nested = Array.from({ length: CODE_V3_LIMITS.shaderFilterPasses }).reduce(value => `shaderFilter("FilmGrain",{},${value})`, 'shaderFilter("FilmGrain",{})')
    rejects(() => compileCodeMaterial(source(`return ${nested};`, 'filter')), 'BUDGET')
    const shared = compileCodeMaterial(source('const a=shaderFilter("FilmGrain",{}); return clamp(mix(a,a,.5),0,1);', 'filter')); expect(codeShaderFilterPasses(shared)).toHaveLength(1)
  })
})
