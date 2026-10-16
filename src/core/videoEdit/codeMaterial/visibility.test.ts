import { describe, expect, it } from 'vitest'
import { compileCodeMaterial } from './compiler'
import { evaluateCodeMaterial, evaluateCodeMaterialBounds, hitTestCodeMaterial } from './evaluate'
import { codeCommandSignature, codeInvisible } from './visibility'
import { CODE_IDENTITY, codeTransform } from './geometry'
import { codeFramePerformanceSchema, codePerformanceMessage, codeStructureCosts } from './performance'
import type { CodeDrawCommand } from './contract'

const context = { time: 0, localTime: 0, sequenceTime: 0, frame: 0, fps: 30, width: 64, height: 64 }
const source = (body: string) => `export default {apiVersion:1,languageVersion:3,name:"剔除",kind:"generator",mode:"dynamic",width:64,height:64,durationSeconds:6,seed:42,parameters:{},render(ctx){${body}}}`
const rect = 'rect({id:"child",x:10,y:10,width:8,height:8,fill:[1,0,0,1]})'
describe('保守可见性与确定性', () => {
  it.each(['opacity:0', 'clip:{x:0,y:0,width:0,height:20}', 'clip:{x:100,y:0,width:20,height:20}', 'mask:{shape:rect({x:0,y:0,width:8,height:8,fill:[1,1,1,1],opacity:0})}'])('%s 不展开子树，只对实际执行工作计费', fields => {
    const program = compileCodeMaterial(source(`return [group({id:"hidden",${fields}},repeat(200,i=>rect({id:"child",x:random(i)*64,y:10,width:8,height:8,fill:[1,0,0,1]}))),${rect}];`))
    let before = 0; let after = 0; let culled = 0
    const full = evaluateCodeMaterial(program, context, {}, { onEvaluation: v => { before = v.operations } })
    const commands = evaluateCodeMaterial(program, context, {}, { cullInvisible: true, onEvaluation: v => { after = v.operations; culled = v.culledGroups } })
    expect(commands[0]).toMatchObject({ kind: 'group', children: [] })
    expect(commands[1].elementPath).toEqual(full[1].elementPath)
    expect(after).toBeLessThan(before / 10); expect(culled).toBe(1)
    expect(evaluateCodeMaterial(program, context, {}, { cullInvisible: true })).toEqual(commands)
  })
  it('任意寻帧恢复相同随机值和路径；覆盖可以重新显示透明组', () => {
    const program = compileCodeMaterial(source(`return [group({id:"g",opacity:ctx.time},[${rect}])];`))
    expect(evaluateCodeMaterial(program, context, {}, { cullInvisible: true })[0]).toMatchObject({ children: [] })
    const visible = { ...context, time: 1, frame: 30 }
    expect(evaluateCodeMaterial(program, visible, {}, { cullInvisible: true })).toEqual(evaluateCodeMaterial(program, visible, {}))
    const options = { cullInvisible: true, elementOverrides: { g: { opacity: 1 } }, sourceTime: { sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 } }, measureText: () => { throw new Error('not text') } }
    expect(hitTestCodeMaterial(program, context, {}, { x: 12, y: 12 }, options)?.elementId).toBe('child')
  })
  it('组移动使 clip 回到画幅；反转空 mask 不剔除；父级变换不误剔除', () => {
    for (const body of [
      `return [group({x:-100,clip:{x:100,y:0,width:20,height:20}},[${rect}])];`,
      `return [group({mask:{shape:rect({x:0,y:0,width:8,height:8,fill:[1,1,1,1],opacity:0}),invert:true}},[${rect}])];`,
      `return [group({x:-100},[group({clip:{x:100,y:0,width:20,height:20}},[${rect}])])];`,
    ]) {
      const program = compileCodeMaterial(source(body))
      expect(evaluateCodeMaterial(program, context, {}, { cullInvisible: true })).toEqual(evaluateCodeMaterial(program, context, {}))
    }
  })
  it('透明、画外图形被剔除，描边/阴影/辉光/变换可能进入画面时保留', () => {
    const shape: CodeDrawCommand = { kind: 'rect', x: 80, y: 8, width: 5, height: 5, radius: 0, fill: [1, 0, 0, 1] }
    expect(codeInvisible(shape, CODE_IDENTITY, 64, 64)).toBe(true)
    for (const value of [{ ...shape, strokeWidth: 8, stroke: [1, 0, 0, 1] }, { ...shape, blur: 8 }, { ...shape, glow: { radius: 8, intensity: 1, color: [1, 0, 0, 1] } }, { ...shape, shadow: { x: -30, y: 0, blur: 0, color: [1, 0, 0, 1] } }] as CodeDrawCommand[]) expect(codeInvisible(value, codeTransform(value), 64, 64)).toBe(false)
    expect(codeInvisible(shape, [1, 0, 0, 1, -30, 0], 64, 64)).toBe(false)
    expect(codeInvisible({ ...shape, opacity: 0 }, [1, 0, 0, 1, -30, 0], 64, 64)).toBe(true)
  })
  it('稳定哈希有精确比较依据，极小变化不合并', () => {
    expect(codeCommandSignature([1, 2])).toEqual(codeCommandSignature([1, 2]))
    expect(codeCommandSignature([1 + Number.EPSILON, 2])).not.toEqual(codeCommandSignature([1, 2]))
  })
  it('隐藏组的绘制绑定按需展开，重复实例保持声明处索引与稳定路径', () => {
    const program = compileCodeMaterial(source(`const parts=repeat(200,i=>rect({id:"part",x:random(i)*10,y:8,width:2,height:2,fill:[1,0,0,1]}));return [group({opacity:ctx.time},parts)];`))
    let before = 0; let after = 0
    evaluateCodeMaterial(program, context, {}, { onEvaluation: value => { before = value.operations } })
    evaluateCodeMaterial(program, context, {}, { cullInvisible: true, onEvaluation: value => { after = value.operations } })
    expect(after).toBeLessThan(before / 10)
    const aliases = compileCodeMaterial(source(`const part=group({clip:{x:100,y:0,width:20,height:20}},[rect({id:"part",x:110,y:8,width:2,height:2,fill:[1,0,0,1]})]);return repeat(2,i=>group({x:-100},[part]));`))
    expect(evaluateCodeMaterial(aliases, context, {}, { cullInvisible: true })).toEqual(evaluateCodeMaterial(aliases, context, {}))
  })
  it('恒空蒙版与画外元素保留重复 ID 路径但标为不可见，嵌套裁切在求值前剔除', () => {
    const program = compileCodeMaterial(source(`return [group({id:"masked",mask:{shape:rect({x:0,y:0,width:64,height:64,fill:[0,0,0,1]}),mode:"luma"}},[${rect}]),rect({id:"child",x:100,y:0,width:8,height:8,fill:[1,0,0,1]})];`))
    const original = evaluateCodeMaterial(program, context, {})
    const bounds = evaluateCodeMaterialBounds(program, context)
    expect(bounds.every(value => value.opacity === 0)).toBe(true)
    expect(bounds[1].elementId).toBe((original[0] as Extract<CodeDrawCommand, { kind: 'group' }>).children[0].elementId)
    expect(hitTestCodeMaterial(program, context, {}, { x: 12, y: 12 })).toBeUndefined()
    const nested = compileCodeMaterial(source(`return [group({x:100},[group({clip:{x:0,y:0,width:20,height:20}},[${rect}])])];`))
    const outer = evaluateCodeMaterial(nested, context, {}, { cullInvisible: true })[0] as Extract<CodeDrawCommand, { kind: 'group' }>
    expect(outer.children[0]).toMatchObject({ kind: 'group', children: [] })
    const effect = compileCodeMaterial(source(`return [group({x:100,shadow:{x:-100,y:0,blur:0,color:[1,0,0,1]}},[group({clip:{x:0,y:0,width:20,height:20}},[${rect}])])];`))
    expect(evaluateCodeMaterial(effect, context, {}, { cullInvisible: true })).toEqual(evaluateCodeMaterial(effect, context, {}))
  })
  it('前五项成本含源码位置、占比、复用统计，超预算文本不丢详情', () => {
    const span = { file: 'main.ts', start: 0, end: 10, startLine: 2, startColumn: 3, endLine: 2, endColumn: 13 }
    const structures = codeStructureCosts([{ kind: 'group', cpuMs: 20, sourceSpan: span }], [{ kind: 'group', cpuMs: 0, gpuMs: 30, sourceSpan: span }])
    const value = codeFramePerformanceSchema.parse({ frame: 0, cpuMs: 20, gpuMs: 30, budgetMs: 33, structures, attribution: 'inclusive-queue-wall', reuse: { operations: 1, culledGroups: 2, culledDraws: 3, frameHits: 1, subtreeHits: 2, subtreeMisses: 1 } })
    expect(value.structures?.[0]).toMatchObject({ cpuShare: 1, gpuShare: 1 })
    expect(codePerformanceMessage(value)).toContain('main.ts:2:3')
    expect(codePerformanceMessage(value)).toContain('整帧复用 1')
  })
})
