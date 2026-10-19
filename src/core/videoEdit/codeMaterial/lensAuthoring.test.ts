import { describe, expect, it } from 'vitest'
import { compileCodeMaterial } from './compiler'
import { evaluateCodeMaterial } from './evaluate'

const source = (body: string) => `export default {apiVersion:3,languageVersion:3,name:"层级焦点",kind:"generator",mode:"dynamic",width:64,height:64,durationSeconds:2,seed:1,parameters:{},render(ctx){${body}}}`
const rect = 'rect({x:20,y:20,width:8,height:8,fill:[1,0,0,1]})'
const context = { time: 0, localTime: 0, sequenceTime: 0, width: 64, height: 64, frame: 0, fps: 60 }

describe('API3 分层镜头散焦', () => {
  it('同一焦点可驱动多个层的弥散圆半径，零半径保留清晰图形', () => {
    const program = compileCodeMaterial(source(`const focus=ctx.time;return [group({blurShape:"lens",blur:abs(focus)*16},[${rect}]),group({blurShape:"lens",blur:abs(1-focus)*16},[${rect}])];`))
    for (const time of [0, .5, 1]) {
      const commands = evaluateCodeMaterial(program, { ...context, time, localTime: time, sequenceTime: time, frame: time * 60 })
      expect(commands).toMatchObject([{ kind: 'group', blurShape: 'lens', blur: time * 16 }, { kind: 'group', blurShape: 'lens', blur: (1 - time) * 16 }])
    }
  })
  it('只在API3分组开启散焦，未知形状和超范围半径明确拒绝', () => {
    const valid = source(`return [group({blurShape:"lens",blur:12},[${rect}])];`)
    expect(() => compileCodeMaterial(valid.replace('apiVersion:3', 'apiVersion:1'))).toThrow('apiVersion:3')
    expect(() => compileCodeMaterial(valid.replace('"lens"', '"unknown"'))).toThrow('blurShape')
    expect(() => evaluateCodeMaterial(compileCodeMaterial(valid.replace('blur:12', 'blur:257')), context)).toThrow('blur')
    expect(() => compileCodeMaterial(source(`return [rect({x:0,y:0,width:8,height:8,blurShape:"lens"})];`))).toThrow('blurShape')
  })
})
