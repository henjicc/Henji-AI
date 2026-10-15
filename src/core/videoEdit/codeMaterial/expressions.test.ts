import { evaluateCodeFrameExpression } from './evaluateV3'
import { codeFilterFrameExpressions } from './filterFrameExpressions'
import { describe, expect, it } from 'vitest'
import { compileCodeMaterial } from './compiler'
import { evaluateCodeMaterial } from './evaluate'
import { CODE_V3_LIMITS, CodeMaterialError } from './contract'
import { layoutCodeText } from './textLayout'
import { parseCodePath } from './geometry'
import { emitCodeMaterialFilter } from '@/features/videoEdit/engine/codeGpuFilter'
import type { CodeTextMeasurer } from './contract'

const source = (body: string, width = 1920, height = 1080, parameters = '{}'): string => `export default {apiVersion:1,languageVersion:3,name:"expressions",kind:"generator",mode:"dynamic",width:${width},height:${height},durationSeconds:10,seed:42,parameters:${parameters},render(ctx){${body}}}`
const context = { time: .7, localTime: .7, sequenceTime: .7, width: 1920, height: 1080, frame: 42, fps: 60 }
const measureText: CodeTextMeasurer = request => layoutCodeText(request, text => text.length * 10)
const run = (body: string, width = 1920, height = 1080): ReturnType<typeof evaluateCodeMaterial> => {
  const program = compileCodeMaterial(source(body, width, height)); const ctx = { ...context, width, height }
  const first = evaluateCodeMaterial(program, ctx, {}, { measureText })
  expect(evaluateCodeMaterial(program, ctx, {}, { measureText })).toEqual(first)
  return first
}
const scalar = (expression: string): string => `return [rect({x:${expression},y:0,width:1,height:1})];`

describe('v3 表达式与边界', () => {
  it.each([[1920, 1080], [1080, 1920]])('数学编译求值与同帧确定性 %s×%s', (width, height) => {
    const cases: [string, number][] = [
      ['sqrt(9)', 3], ['pow(2,3)', 8], ['2**3', 8], ['7%4', 3], ['exp(0)', 1], ['log(E)', 1], ['log2(8)', 3],
      ['tan(PI/4)', 1], ['asin(1)', Math.PI / 2], ['acos(0)', Math.PI / 2], ['atan(1)', Math.PI / 4], ['atan2(1,0)', Math.PI / 2],
      ['hypot(3,4)', 5], ['hypot(1,2,2)', 3], ['sign(-2)', -1], ['fract(-1.2)', .8], ['mod(-7,4)', 1], ['mod(7,-4)', -1], ['trunc(-1.9)', -1],
      ['lerp(10,20,.25)', 12.5], ['invLerp(10,20,15)', .5], ['remap(5,0,10,20,40)', 30], ['step(.5,.5)', 1], ['degrees(PI)', 180], ['radians(180)', Math.PI],
      ['length([3,4])', 5], ['distance([0,1],[3,5])', 5], ['normalize([3,4])[0]', .6], ['length(normalize([0,0,0]))', 0], ['TAU', 2 * Math.PI],
    ]
    for (const [expression, expected] of cases) expect(run(scalar(expression), width, height)[0]).toMatchObject({ x: expect.closeTo(expected, 8) })
  })
  it.each([[1920, 1080], [1080, 1920]])('字符串、模板、数字与时间格式 %s×%s', (width, height) => {
    const cases = [
      ['"进度"+12.5+"%"', '进度12.5%'], ['`${12.5}% ${true}`', '12.5% true'], ['formatNumber(1234.5,{decimals:2,thousands:true,sign:"always"})', '+1,234.50'],
      ['formatNumber(7,{pad:3})', '007'], ['formatNumber(-.001,{decimals:2,sign:"exceptZero"})', '0.00'], ['formatNumber(1e-7)', '0.0000001'],
      ['formatTime(3661.25,"hh:mm:ss")', '01:01:01'], ['formatTime(3661,"mm:ss")', '61:01'], ['formatTime(9.259,"ss.ff")', '09.25'], ['formatTime(1.9999999999,"ss.ff")', '01.99'], ['formatTime(1.15,"ss.ff")', '01.15'],
    ]
    for (const [expression, expected] of cases) expect(run(`return [text({x:0,y:0,text:${expression},fontSize:20})];`, width, height)[0]).toMatchObject({ text: expected })
  })
  it('回弹透明度、逐字透明度、颜色混合和 HSV/HSL 自然范围夹取', () => {
    for (const ease of ['backOut', 'elasticOut']) {
      const commands = run(`const t=${ease}(.4);return [rect({x:0,y:0,width:1,height:1,opacity:t,fill:mix([0,0,0,0],[1,1,1,1],t)}),text({x:0,y:0,text:"AB",fontSize:20,perChar:(i,n)=>({opacity:t})}),rect({x:0,y:0,width:1,height:1,fill:hsv(0,2,2,2)}),rect({x:0,y:0,width:1,height:1,fill:hsl(0,-1,2,-1)})];`)
      expect(commands[0]).toMatchObject({ opacity: 1, fill: [1, 1, 1, 1] })
      expect(commands[1]).toMatchObject({ perChar: [{ opacity: 1 }, { opacity: 1 }] })
      expect(commands[2]).toMatchObject({ fill: [1, 0, 0, 1] }); expect(commands[3]).toMatchObject({ fill: [1, 1, 1, 0] })
    }
  })
  it.each(['sqrt(-1)', 'log(0)', 'log2(-1)', 'acos(2)', 'pow(-1,.5)', 'mod(1,0)', 'exp(1000)'])('非有限结果点名 %s', expression => {
    expect(() => run(scalar(expression))).toThrow(expression.split('(')[0])
  })
  it('字符串构造与重复文字不能逃过 8192 字符预算', () => {
    expect(() => run('const a=formatNumber(1,{pad:4096});return [text({x:0,y:0,text:a+a+"!",fontSize:20})];')).toThrow('8192')
    expect(() => run('const a=formatNumber(1,{pad:4096});return repeat(3,i=>text({x:0,y:0,text:a,fontSize:20}));')).toThrow('8192')
    expect(run('const a=formatNumber(1,{pad:4096});return [text({x:0,y:0,text:a+a,fontSize:1,maxWidth:4096})];')[0]).toMatchObject({ text: expect.any(String) })
  })
  it('文字、choice 和字面量拆分按最大实际长度计费', () => {
    const params = '{label:{type:"text",title:"标签",default:"ab",maxLength:5},choice:{type:"choice",title:"选项",default:"AB",options:["AB","CDEF"]}}'
    for (const expression of ['chars("AB")', 'words(ctx.params.label)', 'chars(ctx.params.choice)', 'measureText({text:ctx.params.choice,fontSize:20})']) {
      const program = compileCodeMaterial(source(`const x=${expression};return [];`, 1920, 1080, params))
      expect(program.metrics.cpuOperations).toBeLessThan(256)
      expect(evaluateCodeMaterial(program, context, {}, { measureText })).toEqual([])
    }
  })
  it.each([
    ['for(let i=0;i<2;i++){}return [];', /for.*repeat/], ['let x=1;return [];', /let.*const.*三元/],
    ['if(true){}return [];', /if.*三元/], ['return [rect({x:squrt(4),y:0,width:1,height:1})];', /squrt.*sqrt/],
    ['return [rect({x:0,y:0,width:1,height:1,typo:1})];', /typo.*可用字段.*width/],
    ['return [rect({x:0,y:0,width:1,height:1,blend:"typo"})];', /blend.*normal.*screen/],
    ['return [rect({x:pow(2),y:0,width:1,height:1})];', /期望 2.*实际 1.*pow\(base, exponent\)/],
  ])('错误包含写法、替代或签名：%s', (body, error) => expect(() => run(body)).toThrow(error))
  it('CPU 预算错误含超额数与源位置', () => {
    expect(() => compileCodeMaterial(source('return repeat(4096,i=>rect({x:noise(i)+noise(i)+noise(i)+noise(i)+noise(i)+noise(i)+noise(i)+noise(i),y:0,width:1,height:1}));'))).toThrow(/超出 \d+.*repeat.*main.ts:1:/)
  })
  it('重复别名的元素标识、嵌套路径与帧结果相互独立', () => {
    const program = compileCodeMaterial(source('const item=ellipse({id:"same",x:sin(ctx.time),y:0,width:2,height:2});const g=group({id:"g"},[item,item]);return [g,g];'))
    const first = evaluateCodeMaterial(program, context); const saved = structuredClone(first)
    const second = evaluateCodeMaterial(program, { ...context, time: 1 })
    expect(first).toEqual(saved); expect(second).not.toEqual(first)
    expect(first[0]).not.toBe(first[1])
    if (first[0].kind !== 'group' || first[1].kind !== 'group') throw new Error('expected groups')
    const children = [...first[0].children, ...first[1].children]
    expect(new Set(children.map(child => child.elementId)).size).toBe(4)
    expect(new Set(children.map(child => child.elementPath?.join('/'))).size).toBe(4)
    expect(children.every(child => child.authorElementId === 'same')).toBe(true)
  })
  it('新增数学函数与幂运算可降级为逐像素滤镜 WGSL', () => {
    const expressions = ['sqrt(ctx.u+1)', 'pow(ctx.u,2)', 'ctx.u**2', 'exp(ctx.u)', 'log(ctx.u+1)', 'log2(ctx.u+1)', 'tan(ctx.u)', 'asin(ctx.u)', 'acos(ctx.u)', 'atan(ctx.u)', 'atan2(ctx.u,1)', 'hypot(ctx.u,1)', 'sign(ctx.u)', 'fract(ctx.u)', 'mod(ctx.u,-2)', 'trunc(ctx.u)', 'lerp(0,1,ctx.u)', 'invLerp(0,2,ctx.u)', 'remap(ctx.u,0,2,0,1)', 'step(.5,ctx.u)', 'degrees(ctx.u)', 'radians(ctx.u)', 'length([ctx.u,1])', 'distance([ctx.u,1],[0,0])', 'normalize([ctx.u,1])[0]', 'length(normalize([0,0]))']
    for (const expression of expressions) {
      const filter = source(`return rgba(clamp(${expression},0,1),0,0,1);`).replace('kind:"generator"', 'kind:"filter"')
      expect(emitCodeMaterialFilter(compileCodeMaterial(filter)), expression).toContain('@fragment')
    }
    const invalid = compileCodeMaterial(source('return rgba(sqrt(-1),0,0,1);').replace('kind:"generator"', 'kind:"filter"'))
    expect(() => codeFilterFrameExpressions(invalid).map(e => evaluateCodeFrameExpression(invalid, e, context, {}))).toThrow('sqrt')
  })
})

describe('SVG 完整路径与预算', () => {
  // Lucide heart / circle-check and Bootstrap arrow-right paths (ISC / MIT).
  const icons = ['M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78Z', 'M22 11.08V12a10 10 0 1 1-5.93-9.14M22 4 12 14.01l-3-3', 'M12.146 3.146a.5.5 0 0 1 .708 0l4.5 4.5a.5.5 0 0 1 0 .708l-4.5 4.5a.5.5 0 0 1-.708-.708L15.793 8.5H1a.5.5 0 0 1 0-1h14.793l-3.647-3.646a.5.5 0 0 1 0-.708z']
  it.each([[1920, 1080], [1080, 1920]])('真实图标、相对、弧线与隐式重复确定性 %s×%s', (width, height) => {
    for (const d of [...icons, 'm1e1,1e1 20 0h10v20q5 5 10 0t10 0c5 5 10 5 15 0s10-5 15 0z']) {
      const [command] = run(`return [path({d:${JSON.stringify(d)},fill:[1,1,1,1]})];`, width, height)
      expect(command.kind === 'path' && command.points.flat().length).toBeGreaterThan(2)
    }
  })
  it('曲线细分随长度与画幅变化，缓存键包含画幅且返回独立点', () => {
    const small = parseCodePath('M0 0Q10 10 20 0', 320, 180)
    const large = parseCodePath('M0 0Q10 10 20 0', 7680, 4320)
    expect(large[0].length).toBeGreaterThan(small[0].length)
    small[0][0][0] = 999
    expect(parseCodePath('M0 0Q10 10 20 0', 320, 180)[0][0]).toEqual([0, 0])
    expect(parseCodePath('M0 0Q1000 1000 2000 0')[0].length).toBeGreaterThan(parseCodePath('M0 0Q1 1 2 0')[0].length)
  })
  it('超长曲线保留 4096 点限制，错误数据不截断接受', () => {
    expect(() => parseCodePath('M0 0' + 'C0 30000 30000 30000 0 0'.repeat(20))).toThrow('4096')
    for (const d of ['L1 2', 'M0 0A2 2 0 2 0 4 4', 'M0 0X1 2', 'M0 0C1 2 3']) expect(() => parseCodePath(d)).toThrow(CodeMaterialError)
    expect(() => parseCodePath('M0 0 A1e999 1 0 0 1 1 1')).toThrow('有限数值')
  })
})

export const particleSource = source('return repeat(4096,i=>ellipse({x:sin(i*.1+ctx.time)+cos(i*.2+ctx.time)+sin(i*.3+ctx.time)+cos(i*.4+ctx.time)+sin(i*.5+ctx.time),y:cos(i*.1+ctx.time)+sin(i*.2+ctx.time)+cos(i*.3+ctx.time)+sin(i*.4+ctx.time)+cos(i*.5+ctx.time),width:2,height:2,fill:[1,1,1,1]}));')
it('4096 粒子每粒十次三角运算纳入预算并可确定求值', () => {
  const program = compileCodeMaterial(particleSource)
  expect(program.metrics.cpuOperations).toBeLessThanOrEqual(CODE_V3_LIMITS.cpuOperations)
  const commands = evaluateCodeMaterial(program, context)
  expect(commands).toHaveLength(4096); expect(evaluateCodeMaterial(program, context)).toEqual(commands)
  if (process.env.HENJI_CODE_BENCH === '1') {
    for (let i = 0; i < 50; i++) evaluateCodeMaterial(program, { ...context, time: i / 60 })
    const times = Array.from({ length: 100 }, (_, i) => { const start = performance.now(); evaluateCodeMaterial(program, { ...context, time: i / 60 }); return performance.now() - start }).sort((a, b) => a - b)
    console.info('4096 particles / 10 trig calls:', { work: program.metrics.cpuOperations, medianMs: times[50], p95Ms: times[95], minMs: times[0] })
  }
})
