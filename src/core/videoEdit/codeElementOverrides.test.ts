import { testCodeAssetSource } from './codeMaterial/sourceTestFixtures'
import { expect, it } from 'vitest'
import { compileCodeMaterial } from './codeMaterial/compiler'
import { evaluateCodeMaterial } from './codeMaterial/evaluate'
import { layoutCodeText } from './codeMaterial/textLayout'
import { codeElementBounds, codePoint, hitCodeCommands } from './codeMaterial/geometry'
import { codeElementOverrideStatus, codeElementOverridesSchema, evaluateCodeElementOverride, readCodeElementOverride } from './codeElementOverrides'
import { codeElementSourceIds } from './codeElementBake'
import { resizeCodeElement, snapCodeElementMove } from './codeElementManipulation'
import { decodeCodeAsset, encodeCodeAsset } from './codeAsset'
import { createVideoEditTestDocument } from './testFixtures'
import { makeVideoEditItemClip } from './projectItems'

const source = (body: string): string => `export default {apiVersion:1,languageVersion:3,name:"编辑",kind:"generator",mode:"dynamic",width:1920,height:1080,durationSeconds:10,seed:1,parameters:{},render(ctx){${body}}}`
const context = { time: 0, localTime: 0, sequenceTime: 0, width: 1920, height: 1080, frame: 0, fps: 30 }
const time = (sourceInUs: number) => ({ sourceInUs, sourceRemainder: { numerator: 0, denominator: 1 } })
const measure = (request: Parameters<typeof layoutCodeText>[0]) => layoutCodeText(request, text => text.length * request.fontSize)
const rect = 'rect({id:"box",x:100,y:100,width:200,height:100,fill:[1,1,1,1]})'
it('作者变换之后绕元素中心缩放、旋转，最后平移；绘制命中与包围盒一致且不改IR', () => {
  const program = compileCodeMaterial(source(`return [${rect}];`)); const before = JSON.stringify(program)
  const commands = evaluateCodeMaterial(program, context, {}, { measureText: measure, sourceTime: time(0), elementOverrides: { box: { scale: 2, rotation: 90, dx: 10, dy: 20 } } })
  const bound = codeElementBounds(commands)[0]
  expect(bound.x).toBeCloseTo(110); expect(bound.y).toBeCloseTo(-30); expect(bound.width).toBeCloseTo(200); expect(bound.height).toBeCloseTo(400)
  expect(hitCodeCommands(commands, 210, 170)?.elementId).toBe('box'); expect(JSON.stringify(program)).toBe(before)
})
it('分组父变换、作者锚点、覆盖隐藏与透明度共享命中契约', () => {
  const program = compileCodeMaterial(source(`return [group({id:"group",x:40,y:20,scale:2},[rect({id:"box",x:100,y:100,width:200,height:100,anchorX:0,anchorY:0,fill:[1,1,1,1]})])];`))
  const commands = evaluateCodeMaterial(program, context, {}, { measureText: measure, sourceTime: time(0), elementOverrides: { box: { scaleX: 2, dx: 10 } } })
  const bound = codeElementBounds(commands).find(value => value.elementId === 'box')!
  expect(bound.x).toBe(260); expect(bound.width).toBe(800)
  const hidden = evaluateCodeMaterial(program, context, {}, { measureText: measure, sourceTime: time(0), elementOverrides: { box: { hidden: true } } })
  expect(codeElementBounds(hidden).find(value => value.elementId === 'box')!.opacity).toBe(0); expect(hitCodeCommands(hidden, 260, 220)).toBeUndefined()
})
it('曲线使用源时间、保持字符串和bool、RGBA和ease插值；非法属性/重复时刻拒绝', () => {
  const curve = (value: number, id: string, sourceInUs: number) => ({ id, ...time(sourceInUs), value, interpolation: 'ease' as const })
  const override = codeElementOverridesSchema.parse({ box: { dx: 10, curves: { dx: [curve(0, 'a', 0), curve(100, 'b', 1e6)], text: [{ id: 'text', ...time(0), value: 'A', interpolation: 'hold' }] } } }).box
  expect(evaluateCodeElementOverride(override, time(250000)).dx).toBeCloseTo(15.625)
  expect(evaluateCodeElementOverride(override, time(2e6))).toMatchObject({ dx: 100, text: 'A' })
  expect(codeElementOverridesSchema.safeParse({ box: { curves: { unknown: [curve(0, 'x', 0)] } } }).success).toBe(false)
  expect(codeElementOverridesSchema.safeParse({ box: { curves: { dx: [curve(0, 'x', 0), curve(1, 'y', 0)] } } }).success).toBe(false)
  expect(codeElementOverridesSchema.safeParse({ box: { curves: { text: [curve(0, 'x', 0)] } } }).success).toBe(false)
})
it('替换文字/字号/字体/字距/行距重新度量；重复别名只改选中实例', () => {
  const program = compileCodeMaterial(source('const title=text({id:"title",x:100,y:100,text:"A",fontSize:20,fill:[1,1,1,1]});return [title,title];'))
  const initial = evaluateCodeMaterial(program, context, {}, { measureText: measure }); const id = initial[0].elementId!
  const commands = evaluateCodeMaterial(program, context, {}, { measureText: measure, sourceTime: time(0), elementOverrides: { [id]: { text: 'new', fontSize: 40, fontFamily: 'serif', letterSpacing: 2, lineHeight: 2, fill: [1,0,0,1] } } })
  expect(commands[0]).toMatchObject({ text: 'new', fontSize: 40, fontFamily: 'serif', color: [1,0,0,1] })
  expect(commands[1]).toMatchObject({ text: 'A', fontSize: 20 }); expect(codeElementBounds(commands)[0].width).toBeGreaterThan(codeElementBounds(initial)[0].width)
})
it('源码移除才标记失效，动态隐藏帧和repeat仍保留覆盖', () => {
  const program = compileCodeMaterial(source(`return ctx.time>1?[${rect}]:[];`))
  const ids = codeElementSourceIds(program, ['box', 'gone'])
  expect(codeElementOverrideStatus({ box: { dx: 1 }, gone: { fill: [1,0,0,1] } }, ids)).toEqual([{ elementId: 'box', missing: false }, { elementId: 'gone', missing: true }])
})
it('任意作者ID不读取字典原型；危险对象保留名称显式拒绝', () => {
  expect(readCodeElementOverride({}, 'constructor')).toBeUndefined()
  const program = compileCodeMaterial(source('return [rect({id:"constructor",x:10,y:20,width:50,height:50,fill:[1,1,1,1]})];'))
  const commands = evaluateCodeMaterial(program, context, {}, { measureText: measure, sourceTime: time(0), elementOverrides: codeElementOverridesSchema.parse({ constructor: { dx: 10 } }) })
  expect(codeElementBounds(commands)[0].x).toBe(20)
  expect(codeElementOverridesSchema.safeParse(JSON.parse('{"__proto__":{"dx":10}}')).success).toBe(false)
})
it('缩放固定对角，Shift保持当前长宽比例；画面中心/安全边/其它边缘以屏幕阈值吸附', () => {
  const program = compileCodeMaterial(source(`return [${rect}];`)); const command = evaluateCodeMaterial(program, context, {}, { measureText: measure })[0]; const bound = codeElementBounds([command])[0]
  const patch = resizeCodeElement(bound, {}, 2, { x: 500, y: 250 }, true)
  expect(patch.scaleX).toBe(patch.scaleY)
  const resized = evaluateCodeMaterial(program, context, {}, { measureText: measure, sourceTime: time(0), elementOverrides: { box: patch } }); const next = codeElementBounds(resized)[0]
  expect(codePoint(next.matrix, 100, 100)).toEqual([100, 100])
  const snapped = snapCodeElementMove([{ x: .1, y: .1 }, { x: .3, y: .3 }], { x: .297, y: .648 }, { x: [.5], y: [.95] }, { x: .006, y: .006 })
  expect(snapped.delta.x).toBeCloseTo(.3); expect(snapped.delta.y).toBeCloseTo(.65); expect(snapped.guides).toEqual({ x: .5, y: .95 })
})
it('作者已有旋转时非等比角点缩放沿元素轴，固定对角且不产生剪切', () => {
  const program = compileCodeMaterial(source('return [rect({id:"box",x:100,y:100,width:200,height:100,rotation:30,fill:[1,1,1,1]})];'))
  const initial = codeElementBounds(evaluateCodeMaterial(program, context, {}, { measureText: measure }))[0]
  const to = codePoint(initial.matrix, 500, 200)
  const values = resizeCodeElement(initial, {}, 2, { x: to[0], y: to[1] }, false)
  const next = codeElementBounds(evaluateCodeMaterial(program, context, {}, { measureText: measure, sourceTime: time(0), elementOverrides: { box: values } }))[0]
  const original = codePoint(initial.matrix, 100, 100); const opposite = codePoint(next.matrix, 100, 100)
  expect(opposite[0]).toBeCloseTo(original[0]); expect(opposite[1]).toBeCloseTo(original[1])
  expect(values.scaleX).toBeCloseTo(2); expect(values.scaleY).toBeCloseTo(1)
  expect(next.matrix[0] * next.matrix[2] + next.matrix[1] * next.matrix[3]).toBeCloseTo(0)
})
it('代码资产编码/导入默认值/新片段复制保留覆盖，并保持片段编辑独立', () => {
  const code = source(`return [${rect}];`); const program = compileCodeMaterial(code)
  const asset = decodeCodeAsset(encodeCodeAsset({ format: 'henji-code-asset', version: 1, name: '编辑', ...testCodeAssetSource(code, 3), parameters: {}, images: [], elementOverrides: { box: { dx: 20 } } }))
  const document = createVideoEditTestDocument('导入'); document.codeSources = asset.codeSources; document.codeMaterials = [{ id: 'd', name: '编辑', defaultVersionId: 'v', versions: [{ id: 'v', ...asset.sourceVersion }] }]; document.items.push({ id: 'i', name: '编辑', kind: 'code', code: { definitionId: 'd', versionId: 'v', parameters: {} }, elementOverrides: asset.elementOverrides })
  const clip = makeVideoEditItemClip(document, 'i', document.sequences[0].id, { frame: 0 }, () => program)
  expect(clip.elementOverrides).toEqual(asset.elementOverrides); clip.elementOverrides!.box.dx = 90; expect(asset.elementOverrides!.box.dx).toBe(20)
})
