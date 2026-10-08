import { testFilesSource } from './codeMaterial/sourceTestFixtures'
import { expect, it } from 'vitest'
import { bakeCodeElementLiterals, codeElementTextParameter, resizeCodeMaterialCanvas } from './codeElementBake'
import { BUILTIN_STYLE_KITS } from './styleKitPresets'
import { compileCodeMaterial } from './codeMaterial/compiler'
import { evaluateCodeMaterial } from './codeMaterial/evaluate'
import { codeElementBounds } from './codeMaterial/geometry'
import { layoutCodeText } from './codeMaterial/textLayout'
const source = (body: string): string => `export default {apiVersion:1,languageVersion:3,name:"写回",kind:"generator",mode:"static",width:1920,height:1080,durationSeconds:10,seed:1,parameters:{title:{type:"text",title:"文字",default:"A",maxLength:100,animatable:false}},render(ctx){${body}\n}}`
const context = { time: 0, localTime: 0, sequenceTime: 0, width: 1920, height: 1080, frame: 0, fps: 30 }
it('所有内置风格样例按目标画幅编译，空白、注释、顺序和引号变化不影响顶层尺寸替换', () => {
  for (const kit of BUILTIN_STYLE_KITS) for (const sample of kit.samples) {
    for (const dimensions of ['width: 1920, height: 1080', 'width:1920,\nheight:1080', '"height": /* h */ 1080, "width": /* w */ 1920']) {
      const original = testFilesSource(sample.source).replace('width: 1920, height: 1080', dimensions)
      const resized = resizeCodeMaterialCanvas(original, { width: 960, height: 540 })
      expect(compileCodeMaterial(resized)).toMatchObject({ width: 960, height: 540 })
      expect(resized.slice(resized.indexOf('render(ctx)'))).toBe(original.slice(original.indexOf('render(ctx)')))
    }
  }
})
it('尺寸替换不修改同名文字或图形属性，缺字段与非法画幅明确失败', () => {
  const original = source('return [rect({x:0,y:0,width:1920,height:1080,fill:[0,0,0,1]})];').replace('name:"写回"', 'name:"width:1920,height:1080"')
  const resized = resizeCodeMaterialCanvas(original, { width: 640, height: 360 })
  expect(resized).toContain('name:"width:1920,height:1080"')
  expect(resized).toContain('rect({x:0,y:0,width:1920,height:1080')
  expect(() => resizeCodeMaterialCanvas(original.replace('mode:"static",width:1920,', 'mode:"static",'), { width: 640, height: 360 })).toThrow('画幅尺寸')
  expect(() => resizeCodeMaterialCanvas(original, { width: 0, height: 360 })).toThrow('尺寸无效')
})
function element(code: string) { const program = compileCodeMaterial(code); const commands = evaluateCodeMaterial(program, context, {}, { measureText: request => layoutCodeText(request, text => text.length * request.fontSize) }); return { program, element: codeElementBounds(commands)[0] } }
it('仅替换sourceSpan中的坐标、RGBA、文字字面量；保留其它元素与注释并可重新编译', () => {
  const code = source('return [text({id:"title",x:-10,y:20,text:"原文",fontSize:30,fill:[1,1,1,1]}),rect({x:20,y:20,width:10,height:10,fill:[1,1,1,1]})]; // keep')
  const result = bakeCodeElementLiterals(code, element(code).element, { dx: 15, dy: 5, fontSize: 50, text: '引号"与换行\n', fill: [0,.5,1,1] })
  expect(result.merged).toBe(true); expect(result.source).toContain('x:5,y:25'); expect(result.source).toContain('fontSize:50'); expect(result.source).toContain('rect({x:20,y:20'); expect(result.source.endsWith('}')).toBe(true)
  expect(element(result.source).element.command).toMatchObject({ text: '引号"与换行\n', fontSize: 50, color: [0,.5,1,1] })
})
it('表达式、重复/别名、过期sourceSpan、关键帧与中心变换不作部分写回', () => {
  const code = source('return [text({id:"title",x:ctx.width/2,y:20,text:ctx.params.title,fontSize:30,fill:[1,1,1,1]})];')
  const bound = element(code).element
  for (const value of [{ dx: 10 }, { text: '改文字' }, { scale: 2 }, { curves: { dx: [{ id: 'k', sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, value: 10, interpolation: 'linear' as const }] } }]) expect(bakeCodeElementLiterals(code, bound, value)).toMatchObject({ merged: false, source: code })
  expect(bakeCodeElementLiterals(code, bound, { fontSize: 40 }, 2).merged).toBe(false)
  expect(bakeCodeElementLiterals(`\n${code}`, bound, { fontSize: 40 }).merged).toBe(false)
  const repeated = source('return repeat(1,i=>text({id:"one",x:10,y:20,text:"A",fontSize:30,fill:[1,1,1,1]}));')
  expect(bakeCodeElementLiterals(repeated, element(repeated).element, { fontSize: 40 }).merged).toBe(false)
})
it('参数文字识别只接受直接参数及别名，条件表达式保留为元素覆盖', () => {
  const code = source('const title=ctx.params.title;return [text({x:10,y:20,text:title,fontSize:30,fill:[1,1,1,1]})];'); const first = element(code)
  expect(codeElementTextParameter(first.program, first.element.sourceSpan!.start)).toBe('title')
  const second = element(source('return [text({x:10,y:20,text:ctx.params.title==="A"?ctx.params.title:"尾",fontSize:30,fill:[1,1,1,1]})];'))
  expect(codeElementTextParameter(second.program, second.element.sourceSpan!.start)).toBeUndefined()
})
