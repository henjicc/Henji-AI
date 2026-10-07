import { describe, expect, it } from 'vitest'
import { compileCodeMaterial } from './compiler'
import { evaluateCodeMaterial, evaluateCodeMaterialBounds, hitTestCodeMaterial } from './evaluate'
import { layoutCodeText } from './textLayout'
import { CODE_EASE_NAMES, codeEase } from './motion'
import { CodeMaterialError } from './contract'
import { emitCodeMaterialFilter } from '@/features/videoEdit/engine/codeGpuFilter'
import type { CodeTextMeasurer } from './contract'

export const v3Source = (body: string, parameters = '{}', kind = 'generator', top = ''): string => `${top}export default {apiVersion:1,languageVersion:3,name:"v3",kind:"${kind}",mode:"dynamic",width:3840,height:2160,durationSeconds:10,seed:42,parameters:${parameters},render(ctx){${body}}}`
export const v3Context = { time: .4, localTime: .4, sequenceTime: .4, width: 3840, height: 2160, frame: 24, fps: 60 }
export const testMeasure: CodeTextMeasurer = request => layoutCodeText(request, (text, font) => Array.from(text).reduce((sum, c) => sum + (/\p{Script=Latin}|\s/u.test(c) ? .6 : 1) * Number(font.match(/([\d.]+)px/)![1]), 0))
export const V3_EXAMPLES = [
  v3Source('const size=measureText({text:"痕迹 AI",fontSize:96}); const x=tween(ctx.time,0,.6,-900,160,"expoOut"); return [group({id:"title",x:x,y:170},[rect({x:0,y:0,width:size.width+96,height:size.height+48,radius:20,fill:[.04,.08,.16,1]}),text({x:48,y:24,text:"痕迹 AI",fontSize:96,color:[1,1,1,1],baseline:"top"})])];'),
  v3Source('const fill=linearGradient({x1:100,y1:0,x2:900,y2:0,stops:[[0,[.1,.8,1,1]],[1,[.9,.2,1,1]]]}); return [text({id:"headline",x:100,y:180,text:"灵感即刻发生",fontSize:110,fontWeight:800,fill:fill,stroke:linearGradient({x1:100,y1:0,x2:900,y2:0,stops:[[0,[1,1,1,1]],[1,[.4,.6,1,1]]]}),strokeWidth:3,glow:{radius:18,intensity:1.4,color:[.2,.6,1,1]},perChar:(i,n)=>({y:tween(ctx.time,stagger(i,.04),.6,100,0,"expoOut"),opacity:progress(ctx.time,stagger(i,.04),.3),scale:1,rotation:0})})];'),
  v3Source('return repeat(1000,i=>ellipse({id:"particle",x:(random(i)*ctx.width+ctx.time*120+noise(i*.03,ctx.time)*180)%ctx.width,y:(random(i+1000)*ctx.height+sin(ctx.time+i*.1)*50+ctx.height)%ctx.height,width:6,height:6,fill:mix([.1,.4,1,.7],[.8,.2,1,.7],random(i+2000))}));'),
] as const

describe('v3 作者封闭语言', () => {
  it('三个交付示例实际编译、求值、逐位确定并保留源码标识', () => {
    V3_EXAMPLES.forEach(source => {
      const program = compileCodeMaterial(source); expect(program.languageVersion).toBe(3)
      const first = evaluateCodeMaterial(program, v3Context, {}, { measureText: testMeasure })
      const second = evaluateCodeMaterial(structuredClone(program), v3Context, {}, { measureText: testMeasure })
      expect(JSON.stringify(first)).toBe(JSON.stringify(second))
      expect(first[0].sourceSpan?.startLine).toBe(1); expect(first[0].elementId).toBeTruthy()
    })
    expect(evaluateCodeMaterial(compileCodeMaterial(V3_EXAMPLES[2]), v3Context)).toHaveLength(1000)
  })
  it('纯函数、局部常量、常量表索引与嵌套 repeat 使用封闭 IR', () => {
    const source = v3Source('const palette=[[1,0,0,1],[0,1,0,1]]; const twice=(x)=>{const y=x*2;return y;};return repeat(2,i=>repeat(3,j=>rect({x:twice(j),y:i,width:1,height:1,fill:palette[i]})));', '{}', 'generator', 'const pure=(x)=>x+1;')
    const program = compileCodeMaterial(source); expect(program.metrics.draws).toBe(6)
    const commands = evaluateCodeMaterial(program, v3Context)
    expect(commands).toHaveLength(6); expect(commands[4]).toMatchObject({ x: 2, y: 1, fill: [0, 1, 0, 1] })
    expect(commands[0].elementId).not.toBe(commands[1].elementId)
  })
  it('拒绝宿主访问、递归、循环、动态 repeat、原型与危险字段，带行列', () => {
    for (const body of ['return repeat(ctx.frame,i=>[]);', 'const f=(x)=>f(x);return [];', 'const f=(x)=>fetch(x);return [];', 'while(true){}return [];', 'return [ctx.constructor];', 'return [new Function("x")()];', 'return [...[]];', 'return repeat(2,i=>{let x=i;return [];});']) {
      expect(() => compileCodeMaterial(v3Source(body))).toThrow(CodeMaterialError)
    }
    try { compileCodeMaterial(v3Source('\nreturn repeat(ctx.time,i=>[]);')) } catch (error) { expect((error as CodeMaterialError).sourceSpan?.startLine).toBe(2) }
  })
  it('重复上界按参数 max 和嵌套乘积计费，4096 边界接受，越界拒绝', () => {
    const shape = 'rect({x:i,y:0,width:1,height:1,fill:[1,1,1,1]})'
    expect(evaluateCodeMaterial(compileCodeMaterial(v3Source(`return repeat(4096,i=>${shape});`)), v3Context)).toHaveLength(4096)
    expect(() => compileCodeMaterial(v3Source(`return repeat(4097,i=>${shape});`))).toThrow('4096')
    expect(() => compileCodeMaterial(v3Source(`return repeat(65,i=>repeat(65,j=>${shape}));`))).toThrow('4096')
    const parameters = '{count:{type:"number",title:"数量",default:5,min:0,max:1000,step:1}}'
    expect(evaluateCodeMaterial(compileCodeMaterial(v3Source(`return repeat(ctx.params.count,i=>${shape});`, parameters)), v3Context)).toHaveLength(5)
    expect(() => evaluateCodeMaterial(compileCodeMaterial(v3Source(`return repeat(ctx.params.count,i=>${shape});`, parameters)), v3Context, { count: 2.5 })).toThrow('整数')
  })
  it('文字按中文字符与英文词换行、去尾空格、maxLines 缩字号不压宽度', () => {
    const program = compileCodeMaterial(v3Source('const m=measureText({text:"hello world 中文测试",fontSize:50,maxWidth:180,lineHeight:1.3});return [text({x:m.width,y:0,text:"hello world 中文测试",fontSize:50,maxWidth:180,maxLines:2,wrap:true,color:[1,1,1,1]})];'))
    const [command] = evaluateCodeMaterial(program, v3Context, {}, { measureText: testMeasure })
    expect(command.kind).toBe('text')
    if (command.kind !== 'text') return
    expect(command.layout!.lines.length).toBeLessThanOrEqual(2); expect(command.fontSize).toBeLessThan(50); expect(command.layout!.width).toBeLessThanOrEqual(180)
    expect(command.layout!.lines.every(line => !/\s$/.test(line))).toBe(true)
    const tight = evaluateCodeMaterial(compileCodeMaterial(v3Source('return [text({x:0,y:0,text:"AB",fontSize:20,letterSpacing:-2})];')), v3Context, {}, { measureText: testMeasure })[0]
    expect(tight.kind === 'text' && tight.layout?.width).toBe(22)
  })
  it('所有缓动端点与噪声确定，颜色 mix 与关键帧可用于作者表达式', () => {
    CODE_EASE_NAMES.forEach(name => { expect(codeEase(name, 0)).toBe(0); expect(codeEase(name, 1)).toBe(1) })
    const program = compileCodeMaterial(v3Source('return [rect({x:keyframes(ctx.time,[[0,0,"sineOut"],[1,100,"linear"]]),y:cubicBezier(.2,0,.8,1,.5),width:10,height:10,fill:hsv(noise(.4,.2,.1),.5,.8)})];'))
    expect(evaluateCodeMaterial(program, v3Context)).toEqual(evaluateCodeMaterial(program, v3Context))
  })
  it('旋转与缩放下的 bounds 和最上层命中使用相同矩阵；透明元素穿透', () => {
    const program = compileCodeMaterial(v3Source('return [group({id:"g",x:100,y:100,rotation:90,scale:2},[rect({id:"box",x:0,y:0,width:20,height:10,fill:[1,1,1,1]}),rect({id:"transparent",x:0,y:0,width:20,height:10,opacity:0,fill:[1,1,1,1]})])];'))
    expect(hitTestCodeMaterial(program, v3Context, {}, { x: 90, y: 120 })?.elementId).toBe('box')
    const box = evaluateCodeMaterialBounds(program, v3Context).find(element => element.elementId === 'box')!
    expect(box.x).toBeCloseTo(80); expect(box.width).toBeCloseTo(20); expect(box.height).toBeCloseTo(40)
  })
  it('贝塞尔路径填充、描边 trim 与源偏移一致', () => {
    const source = v3Source('return [path({id:"curve",d:"M 0 0 L 100 0 Q 100 100 0 100 Z",fill:[1,0,0,1],stroke:[1,1,1,1],strokeWidth:2,trimStart:0,trimEnd:.5})];')
    const program = compileCodeMaterial(source); const [command] = evaluateCodeMaterial(program, v3Context)
    expect(source.slice(command.sourceSpan!.start, command.sourceSpan!.end)).toContain('path({')
    expect(hitTestCodeMaterial(program, v3Context, {}, { x: 10, y: 10 })?.elementId).toBe('curve')
    expect(hitTestCodeMaterial(program, v3Context, {}, { x: 200, y: 200 })).toBeUndefined()
  })
  it('缺失字体由度量与返回命令暴露，不能静默回退', () => {
    const missing = testMeasure({ text: 'A', fontFamily: 'sans-serif', fontSize: 50, fontWeight: 400, fontStyle: 'normal', letterSpacing: 0, lineHeight: 1.2, maxWidth: 0, wrap: false, maxLines: 0 }); missing.missingFont = '不存在的字体'
    const diagnostics: unknown[] = []
    const [command] = evaluateCodeMaterial(compileCodeMaterial(v3Source('return [text({x:0,y:0,text:"A",fontSize:50,fontFamily:"不存在的字体",color:[1,1,1,1]})];')), v3Context, {}, { measureText: () => missing, onDiagnostic: diagnostic => diagnostics.push(diagnostic) })
    expect(command).toMatchObject({ layout: { missingFont: '不存在的字体' } }); expect(diagnostics).toHaveLength(1)
  })
  it.each([
    'return [rect({x:0,y:0,width:40,height:40,radii:[1,2,3,4],stroke:[1,1,1,1],strokeWidth:3})];',
    'return [ellipse({x:0,y:0,width:40,height:20,fill:radialGradient({cx:20,cy:10,r:20,stops:[[0,[1,0,0,1]],[1,[0,0,1,1]]]})})];',
    'return [line({x1:0,y1:0,x2:100,y2:0,width:4,lineCap:"round",dash:[10,5],trimStart:.2,trimEnd:.8})];',
    'return [path({points:[[0,0],[40,0],[20,40]],closed:true,lineJoin:"bevel",stroke:[1,1,1,1],strokeWidth:2})];',
    'const letters=chars("中文A");const wordsList=words("hello world 中文");return repeat(3,i=>text({x:i*20,y:0,text:letters[i],fontSize:20}));',
    'const c=clamp(mix([0,0,0,1],[1,1,1,1],backOut(.8)),0,1);return [rect({x:0,y:0,width:4,height:4,fill:c})];',
    'return [rect({x:0,y:0,width:4,height:4,fill:toHsl(hsl(.6,.4,.5))})];',
  ])('新增图形与数组接口可编译且求值确定：%s', body => {
    const program = compileCodeMaterial(v3Source(body)); const a = evaluateCodeMaterial(program, v3Context, {}, { measureText: testMeasure }); const b = evaluateCodeMaterial(program, v3Context, {}, { measureText: testMeasure })
    expect(a).toEqual(b); expect(a.length).toBeGreaterThan(0)
  })
  it.each([
    'return [path({d:"m 0 0 l 1 1"})];',
    'return [rect({x:0,y:0,width:1,height:1,fill:linearGradient({x1:0,y1:0,x2:1,y2:0,stops:[[0,[1,1,1,1]]]})})];',
    'return [rect({x:0,y:0,width:1,height:1,fill:linearGradient({x1:0,y1:0,x2:1,y2:0,stops:[[0,[1,1,1,1]],[.1,[1,1,1,1]],[.2,[1,1,1,1]],[.3,[1,1,1,1]],[.4,[1,1,1,1]],[.5,[1,1,1,1]],[.6,[1,1,1,1]],[.7,[1,1,1,1]],[1,[1,1,1,1]]]})})];',
    'return repeat(1,i=>repeat(1,j=>repeat(1,k=>repeat(1,l=>repeat(1,m=>[])))));',
    'const f=(x)=>x+x;return [rect({x:0,y:0,width:f(f(f(f(f(f(f(f(f(f(f(f(f(f(f(f(f(f(1)))))))))))))))))),height:1})];',
    'return repeat(1000,i=>path({d:"M0 0 C10 20 30 40 50 60 C60 70 80 90 100 110"}));',
    'return [text({x:0,y:0,fontSize:20,text:"A",perChar:(i,n)=>({z:2})})];',
  ])('静态不合法语法或超限拒绝：%s', body => { expect(() => compileCodeMaterial(v3Source(body))).toThrow(CodeMaterialError) })
  it('RGBA 表保留四个数值，圆角、数组越界与非有限值在实际调用处报错', () => {
    for (const body of ['return [rect({x:0,y:0,width:10,height:10,radii:[1,2,3,4,5]})];', 'const a=[1,2];return [rect({x:0,y:0,width:a[2],height:1})];', 'return [rect({x:0,y:0,width:1/0,height:1})];']) {
      expect(() => evaluateCodeMaterial(compileCodeMaterial(v3Source(body)), v3Context)).toThrow(CodeMaterialError)
    }
    const source = v3Source('\nconst x=progress(1,0,0);\nreturn [];')
    try { evaluateCodeMaterial(compileCodeMaterial(source), v3Context); expect.fail('应拒绝零时长') } catch (error) { expect((error as CodeMaterialError).sourceSpan?.startLine).toBe(2) }
  })
  it('裁切、描边、虚线、圆角与逐字透明度命中保持一致', () => {
    const program = compileCodeMaterial(v3Source('return [group({clip:{x:0,y:0,width:20,height:20}},[rect({id:"stroke",x:0,y:0,width:40,height:40,fill:[0,0,0,0],stroke:[1,1,1,1],strokeWidth:4})]),ellipse({id:"ring",x:50,y:0,width:40,height:40,fill:[0,0,0,0],stroke:[1,1,1,1],strokeWidth:4}),line({id:"dash",x1:0,y1:60,x2:100,y2:60,width:4,dash:[10,10]}),rect({id:"rounded",x:110,y:0,width:40,height:40,radius:20,fill:[1,1,1,1]})];'))
    expect(hitTestCodeMaterial(program, v3Context, {}, { x: 1, y: 10 })?.elementId).toBe('stroke')
    expect(hitTestCodeMaterial(program, v3Context, {}, { x: 39, y: 10 })).toBeUndefined()
    expect(hitTestCodeMaterial(program, v3Context, {}, { x: 90, y: 20 })?.elementId).toBe('ring')
    expect(hitTestCodeMaterial(program, v3Context, {}, { x: 70, y: 20 })).toBeUndefined()
    expect(hitTestCodeMaterial(program, v3Context, {}, { x: 5, y: 60 })?.elementId).toBe('dash')
    expect(hitTestCodeMaterial(program, v3Context, {}, { x: 15, y: 60 })).toBeUndefined()
    expect(hitTestCodeMaterial(program, v3Context, {}, { x: 111, y: 1 })).toBeUndefined()
    expect(evaluateCodeMaterialBounds(program, v3Context).find(b => b.elementId === 'stroke')).toMatchObject({ x: 0, y: 0, width: 20, height: 20 })
    const text = compileCodeMaterial(v3Source('return [text({id:"chars",x:0,y:0,text:"AB",fontSize:20,baseline:"top",perChar:(i,n)=>({opacity:i===0?0:1,x:20})})];'))
    expect(hitTestCodeMaterial(text, v3Context, {}, { x: 25, y: 10 }, { measureText: testMeasure })).toBeUndefined()
    expect(hitTestCodeMaterial(text, v3Context, {}, { x: 38, y: 10 }, { measureText: testMeasure })?.elementId).toBe('chars')
  })
  it('滤镜64采样边界、静态循环与可信多遍计划', () => {
    const accepted = compileCodeMaterial(v3Source('return average(repeat(64,i=>sampleOffset(i,0)));', '{}', 'filter'))
    expect(accepted.metrics.samples).toBe(64); expect(emitCodeMaterialFilter(accepted)).toContain('@fragment')
    expect(() => compileCodeMaterial(v3Source('const double=(c)=>mix(c,c,.5);return average(repeat(64,i=>double(sampleOffset(i,0))));', '{}', 'filter'))).toThrow('采样')
    expect(() => compileCodeMaterial(v3Source('return average(repeat(65,i=>sampleOffset(i,0)));', '{}', 'filter'))).toThrow('预算')
    for (const body of ['return blur(ctx.u);', 'return glow(ctx.v,4,1);', 'return average(repeat(ctx.frame,i=>sample()));']) {
      expect(() => emitCodeMaterialFilter(compileCodeMaterial(v3Source(body, '{}', 'filter')))).toThrow(CodeMaterialError)
    }
    expect(emitCodeMaterialFilter(compileCodeMaterial(v3Source('return mix(blur(4),glow(.2,8,1),.5);', '{}', 'filter')))).toContain('codeBlur1')
  })
})
