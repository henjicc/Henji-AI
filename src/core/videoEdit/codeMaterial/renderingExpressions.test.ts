import { rasterizeCodeShape } from '@/features/videoEdit/engine/videoEditCodeGpuV3'
import { describe, expect, it, vi } from 'vitest'
import { compileCodeMaterial } from './compiler'
import { evaluateCodeMaterial } from './evaluate'
import { evaluateCodeFrameExpression } from './evaluateV3'
import { codeFilterFrameExpressions } from './filterFrameExpressions'
import { CODE_BLEND_NAMES } from './contract'
import { codePoint, codeTransform } from './geometry'
import { layoutCodeText } from './textLayout'
import { emitCodeMaterialFilter } from '@/features/videoEdit/engine/codeGpuFilter'
import { codeFilterRadius, codeMaterialFilterPasses } from '@/features/videoEdit/engine/videoEditCodeCompilerFilterV3'

const source = (body: string, kind = 'generator', parameters = '{}'): string => `export default {apiVersion:1,languageVersion:3,name:"render",kind:"${kind}",mode:"dynamic",width:64,height:64,durationSeconds:10,seed:1,parameters:${parameters},render(ctx){${body}}}`
const context = { width: 64, height: 64, fps: 60, frame: 12, time: .2, localTime: .2, sequenceTime: .2 }
const evaluate = (body: string) => evaluateCodeMaterial(compileCodeMaterial(source(body)), context, {}, { measureText: request => layoutCodeText(request, text => text.length * 10) })

describe('t101 作者渲染表达式', () => {
  it('任意图形遮罩带模式、反转、动画与独立路径，计入工作量', () => {
    for (const shape of ['ellipse({x:ctx.time,y:0,width:20,height:20,fill:[1,1,1,.5]})', 'path({d:"M0 0L20 0L0 20Z",fill:[1,0,0,1]})', 'text({x:0,y:0,text:"A",fontSize:20})', 'shader({name:"SolidColor",x:0,y:0,width:20,height:20})']) {
      const body = `return [group({mask:{shape:${shape},mode:"luma",invert:true}},[rect({x:0,y:0,width:40,height:40,fill:[1,0,0,1]})])];`
      // Use a known catalog generator for the shader layer.
      const program = compileCodeMaterial(source(body.replace('SolidColor', 'LinearGradient')))
      const commands = evaluateCodeMaterial(program, context, {}, { measureText: request => layoutCodeText(request, text => text.length * 10) })
      expect(program.metrics.draws).toBe(3)
      expect(commands[0]).toMatchObject({ kind: 'group', mask: { mode: 'luma', invert: true, shape: { elementPath: expect.arrayContaining(['mask']) } } })
    }
    expect(() => evaluate('return [group({mask:{shape:rect({x:0,y:0,width:1,height:1}),mode:"wrong"}},[])];')).toThrow('mask.mode')
  })
  it.each(CODE_BLEND_NAMES)('混合模式 %s 编译求值', blend => {
    expect(evaluate(`return [rect({x:0,y:0,width:10,height:10,blend:"${blend}"})];`)[0].blend).toBe(blend)
  })
  it('逐字 fill/blur/glow/skewX 随索引求值，父子倾斜共享矩阵', () => {
    const [command] = evaluate('return [text({x:0,y:0,text:"AB",fontSize:20,perChar:(i,n)=>({fill:rgba(i,0,0,1),blur:i,glow:{radius:i+1,intensity:2,color:[1,1,1,1]},skewX:i*15})})];')
    expect(command.kind === 'text' && command.perChar).toMatchObject([{ fill: [0,0,0,1], blur: 0, skewX: 0 }, { fill: [1,0,0,1], blur: 1, skewX: 15 }])
    const [group] = evaluate('return [group({x:10,y:20,skewX:45,skewY:0},[])];')
    expect(codePoint(codeTransform(group), 0, 10)).toEqual([20, 30])
  })
  it('三种渐变接受32色标并拒绝33色标；锥形角度可动画', () => {
    for (const kind of ['linearGradient', 'radialGradient', 'conicGradient']) {
      const fields = kind === 'linearGradient' ? 'x1:0,y1:0,x2:64,y2:64' : kind === 'radialGradient' ? 'cx:32,cy:32,r:20' : 'cx:32,cy:32,angle:ctx.time*360'
      const make = (count: number) => `return [rect({x:0,y:0,width:64,height:64,fill:${kind}({${fields},stops:${JSON.stringify(Array.from({length:count},(_,i)=>[i/(count-1),[i/(count-1),0,1,1]]))}})})];`
      expect(evaluate(make(32))[0].paint).toMatchObject({kind, stops: expect.any(Array)})
      expect(() => evaluate(make(33))).toThrow('32')
    }
  })
  it('时间三角函数、回弹与动态半径走CPU；纯像素越界仍拒绝', () => {
    for (const body of ['return rgba(sin(ctx.time),0,0,1);', 'return mix(sample(ctx.u,ctx.v),rgba(1,0,0,1),tween(ctx.time,0,1,0,1,"backOut"));', 'return blur(8+sin(ctx.time)*4);', 'return glow(.2,ctx.time*10,1);']) {
      const program = compileCodeMaterial(source(body, 'filter'))
      const values = codeFilterFrameExpressions(program).map(expression => evaluateCodeFrameExpression(program, expression, context, {}))
      expect(() => emitCodeMaterialFilter(program)).not.toThrow()
      expect(() => emitCodeMaterialFilter(program, false, values)).not.toThrow()
      for (const pass of codeMaterialFilterPasses(program)) expect(codeFilterRadius(program, pass.radius, {}, context)).toBeGreaterThanOrEqual(0)
    }
    for (const expression of ['1/(ctx.u-.5)', 'sqrt(ctx.u-.5)', 'sin(ctx.u*100)']) expect(() => emitCodeMaterialFilter(compileCodeMaterial(source(`return rgba(${expression},0,0,1);`, 'filter')))).toThrow()
  })
  it('滤镜参数repeat使用整数上界；混合表达式按当前uniform复核', () => {
    const p = '{count:{type:"number",title:"数",default:4,min:1,max:64,step:1}}'
    expect(emitCodeMaterialFilter(compileCodeMaterial(source('return average(repeat(ctx.params.count,i=>sampleOffset(i,0)));','filter',p)))).toContain('63.0<p.frameValues[0].x')
    const program = compileCodeMaterial(source('return rgba(1/(ctx.u+sin(ctx.time)),0,0,1);','filter'))
    expect(() => emitCodeMaterialFilter(program)).not.toThrow()
    const values = (time: number) => codeFilterFrameExpressions(program).map(e => evaluateCodeFrameExpression(program,e,{...context,time},{}))
    expect(() => emitCodeMaterialFilter(program,false,values(.2))).not.toThrow()
    expect(() => emitCodeMaterialFilter(program,false,values(0))).toThrow('除数')
  })
})

it('帧性能定位保留repeat源码行列，确定性求值不受计时影响', () => {
  const program = compileCodeMaterial(source('return repeat(20,i=>rect({x:i,y:0,width:1,height:1}));'))
  let heaviest: import('./performance').CodeHeavyStructure | undefined
  const measured = evaluateCodeMaterial(program, context, {}, { onProfile: value => { heaviest = value } })
  expect(measured).toEqual(evaluateCodeMaterial(program, context))
  expect(heaviest).toMatchObject({ kind: 'repeat', cpuMs: expect.any(Number), sourceSpan: { startLine: 1, startColumn: expect.any(Number) } })
})

it('大量帧级数学只计CPU预算，含repeat局部索引；像素工作保留独立预算',()=>{
  const program=compileCodeMaterial(source('return average(repeat(64,i=>rgba(sin(ctx.time+i),0,0,1)));','filter'))
  expect(program.metrics.scalarOperations).toBe(0)
  expect(program.metrics.cpuOperations).toBeGreaterThan(0)
  expect(codeFilterFrameExpressions(program)).toHaveLength(1)
  const values=codeFilterFrameExpressions(program).map(e=>evaluateCodeFrameExpression(program,e,context,{}))
  expect(()=>emitCodeMaterialFilter(program,false,values)).not.toThrow()
})

it('正式Canvas栅格入口传入锥形角度、中心和全部32色标',()=>{
  const gradient={addColorStop:vi.fn()};const createConicGradient=vi.fn(()=>gradient)
  const context={createConicGradient,translate:vi.fn(),setLineDash:vi.fn(),beginPath:vi.fn(),roundRect:vi.fn(),fill:vi.fn()}
  vi.stubGlobal('OffscreenCanvas',class{getContext(){return context}})
  try{
    const stops=JSON.stringify(Array.from({length:32},(_,i)=>[i/31,[i/31,0,1,1]]))
    const [command]=evaluate(`return [rect({x:0,y:0,width:64,height:64,fill:conicGradient({cx:32,cy:16,angle:90,stops:${stops}})})];`)
    rasterizeCodeShape(command,{x:0,y:0,width:64,height:64})
    expect(createConicGradient).toHaveBeenCalledWith(Math.PI/2,32,16)
    expect(gradient.addColorStop).toHaveBeenCalledTimes(32);expect(context.fill).toHaveBeenCalledOnce()
  }finally{vi.unstubAllGlobals()}
})
