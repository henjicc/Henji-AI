import { describe, expect, it } from 'vitest'
import { compileCodeMaterial } from './codeMaterial/compiler'
import { hitTestCodeMaterial } from './codeMaterial/evaluate'
import { layoutCodeText } from './codeMaterial/textLayout'
import { codeElementAtSource, codeElementAuthorPoint, codeElementFramePolygon, codeElementLabel, cycleCodeElement, hitCodeElementIndex, prepareCodeElementIndex } from './codeElementSelection'
import { videoEditClipToFrame } from './clipGeometry'
import type { CodeTextMeasurer } from './codeMaterial/contract'
import { videoEditAnnotationTargetSchema } from './annotations'

const source = (body: string, parameters = '{}'): string => `export default {apiVersion:1,languageVersion:3,name:"选中",kind:"generator",mode:"dynamic",width:3840,height:2160,durationSeconds:10,seed:42,parameters:${parameters},render(ctx){${body}}}`
const context = { time: 0, localTime: 0, sequenceTime: 0, width: 3840, height: 2160, frame: 0, fps: 60 }
const measure: CodeTextMeasurer = request => layoutCodeText(request, text => text.length * request.fontSize)
describe('代码元素点选共享几何', () => {
  it('重复作者ID和图形变量别名仍可逐个选择并绑定，不显示实例路径', () => {
    const name = '作者元素'.repeat(40)
    const program = compileCodeMaterial(source(`const shape=rect({id:"${name}",x:0,y:0,width:100,height:100,fill:[1,1,1,1]}); return [shape,shape];`))
    const index = prepareCodeElementIndex(program, context, {}, measure)
    const hits = hitCodeElementIndex(index, 50, 50)
    expect(hits).toHaveLength(2); expect(hits[0].elementId).not.toBe(hits[1].elementId)
    expect(cycleCodeElement(hits, hits[0].elementId, true)).toBe(hits[1])
    expect(index.byId.get(hits[1].elementId)).toBe(hits[1]); expect(codeElementLabel(hits[0])).toBe(name)
    expect(videoEditAnnotationTargetSchema.parse({ kind: 'element', elementId: hits[0].elementId })).toMatchObject({ elementId: hits[0].elementId })
  })
  it('缩放旋转及非中心锚点逆映射到作者画布，选框四角随片段变换', () => {
    const placement = { x: .1, y: -.1, scale: .6, rotation: 37, anchorX: .2, anchorY: .7 }
    const picture = { width: 1920, height: 1080 }; const frame = { width: 3840, height: 2160 }
    const point = videoEditClipToFrame(placement, picture, frame, .3, .4)
    const author = codeElementAuthorPoint(placement, picture, frame, point)
    expect(author.x).toBeCloseTo(576); expect(author.y).toBeCloseTo(432)
    const polygon = codeElementFramePolygon({ x: 576, y: 432, width: 50, height: 30 }, placement, picture, frame)
    expect(polygon[0].x).toBeCloseTo(point.x); expect(polygon[0].y).toBeCloseTo(point.y)
    expect(codeElementAuthorPoint(placement, picture, frame, polygon[2]).x).toBeCloseTo(626)
  })
  it('精确命中复用t62，依次选子元素、内外父组和下层，循环回顶层', () => {
    const program = compileCodeMaterial(source('return [rect({id:"底板",x:0,y:0,width:600,height:600,fill:[1,1,1,1]}),group({id:"外组",x:100,y:100},[group({id:"内组",x:50,y:50},[ellipse({id:"粒子",x:0,y:0,width:100,height:100,fill:[1,0,0,1]})])])];'))
    const index = prepareCodeElementIndex(program, context, {}, measure)
    const hits = hitCodeElementIndex(index, 200, 200)
    expect(hits.map(hit => hit.elementId)).toEqual(['粒子', '内组', '外组', '底板'])
    expect(hits[0].elementId).toBe(hitTestCodeMaterial(program, context, {}, { x: 200, y: 200 }, { measureText: measure })?.elementId)
    expect(cycleCodeElement(hits, '粒子', true)?.elementId).toBe('内组')
    expect(cycleCodeElement(hits, '底板', true)?.elementId).toBe('粒子')
    expect(hitCodeElementIndex(index, 151, 151)[0].elementId).toBe('底板')
  })
  it('遵守组裁切、透明度及路径真实轮廓，不以AABB冒充精确命中', () => {
    const program = compileCodeMaterial(source('return [rect({id:"背景",x:0,y:0,width:100,height:100,fill:[1,1,1,1]}),group({id:"裁切组",x:0,y:0,clip:{x:0,y:0,width:20,height:20}},[rect({id:"被裁切",x:0,y:0,width:100,height:100,fill:[1,0,0,1]})]),path({id:"三角",d:"M 50 50 L 100 50 L 50 100 Z",fill:[1,0,0,1]}),rect({id:"透明",x:0,y:0,width:100,height:100,opacity:0,fill:[1,1,1,1]})];'))
    const index = prepareCodeElementIndex(program, context, {}, measure)
    expect(hitCodeElementIndex(index, 15, 15)[0].elementId).toBe('被裁切')
    expect(hitCodeElementIndex(index, 30, 30)[0].elementId).toBe('背景')
    expect(hitCodeElementIndex(index, 60, 60)[0].elementId).toBe('三角')
    expect(hitCodeElementIndex(index, 95, 95)[0].elementId).toBe('背景')
  })
  it('源码位置优先最内层调用，提取绑定参数并隐藏生成ID', () => {
    const text = source('const title=ctx.params.title; return [group({x:0,y:0},[text({x:10,y:10,text:title,fontSize:24,baseline:"top",fill:[1,1,1,1]})])];', '{title:{type:"text",title:"标题",description:"",default:"你好",maxLength:100,animatable:false}}')
    const index = prepareCodeElementIndex(compileCodeMaterial(text), context, {}, measure)
    const element = codeElementAtSource(index, text.indexOf('fontSize'))!
    expect(element.command.kind).toBe('text'); expect(index.parameters.get(element.elementId)).toEqual(['title'])
    expect(codeElementLabel(element)).toBe('文字：你好'); expect(codeElementAtSource(index, 0)).toBeUndefined()
  })
  it('4K的1000粒子当前帧包围盒粗筛，热命中P95低于4ms', () => {
    const program = compileCodeMaterial(source('return repeat(1000,i=>ellipse({id:"粒子",x:(i%50)*70,y:floor(i/50)*90,width:12,height:12,fill:[1,1,1,1]}));'))
    const index = prepareCodeElementIndex(program, context, {}, measure)
    expect(index.bounds).toHaveLength(1000)
    for (let i = 0; i < 30; i++) hitCodeElementIndex(index, 6, 6)
    const durations: number[] = []
    for (let i = 0; i < 200; i++) { const at = performance.now(); const hits = hitCodeElementIndex(index, i % 50 * 70 + 6, Math.floor(i / 50) * 90 + 6); durations.push(performance.now() - at); expect(hits[0]).toBeDefined() }
    durations.sort((a, b) => a - b)
    expect(durations[Math.floor(durations.length * .95)]).toBeLessThan(4)
  })
})
