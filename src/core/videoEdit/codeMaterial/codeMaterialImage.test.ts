import { describe, expect, it, vi } from 'vitest'
import { compileCodeMaterial } from './compiler'
import { CodeMaterialError } from './contract'
import { evaluateCodeMaterial } from './evaluate'
import { checkCodeMaterialParameterCompatibility, validateCodeMaterialParameterValue, validateCodeMaterialParameters } from './parameters'

const context = { time: 1, localTime: 1, sequenceTime: 1, width: 3840, height: 2160, frame: 60, fps: 60 }
const parameters = '{logo:{type:"image",title:"图片",default:null,animatable:false}}'
const image = 'image({source:ctx.params.logo,x:ctx.time*10,y:20,width:640,height:360})'
const source = (body: string, declaration = parameters, kind = 'generator'): string => `export default {apiVersion:1,name:"图片素材",kind:"${kind}",mode:"dynamic",width:3840,height:2160,durationSeconds:10,seed:42,parameters:${declaration},render(ctx){${body}}}`

describe('受控图片作者语言', () => {
  it('仅图片参数派生语言2，引用可结构化克隆且乱序求值保持一致', () => {
    const program = compileCodeMaterial(source(`const logo=ctx.params.logo;return [${image.replace('ctx.params.logo', 'logo')}];`))
    expect(program).toMatchObject({ apiVersion: 1, languageVersion: 2, parameters: [{ key: 'logo', type: 'image', default: null, animatable: false }] })
    const values = { logo: { kind: 'image', mediaId: 'media-logo' } }
    const expected = [{ kind: 'image', source: values.logo, x: 10, y: 20, width: 640, height: 360, opacity: 1 }]
    expect(evaluateCodeMaterial(structuredClone(program), context, values)).toEqual(expected)
    evaluateCodeMaterial(program, { ...context, time: 8, frame: 480 }, values)
    expect(evaluateCodeMaterial(program, context, structuredClone(values))).toEqual(expected)
    expect(compileCodeMaterial(source('const image=4;return [rect({x:image,y:0,width:1,height:1,fill:[1,1,1,1]})];', '{}')).languageVersion).toBe(1)
  })

  it('未绑定null和重复空绘制别名不产生图形，但仍验证有限几何及opacity', () => {
    const program = compileCodeMaterial(source(`const i=${image};return [i,i];`))
    expect(validateCodeMaterialParameters(program, {})).toEqual({ logo: null })
    expect(evaluateCodeMaterial(program, context)).toEqual([])
    expect(evaluateCodeMaterial(program, context, { logo: null })).toEqual([])
    const reference = { logo: { kind: 'image', mediaId: 'logo' } }
    expect(evaluateCodeMaterial(program, context, reference)).toHaveLength(2)
    for (const opacity of ['-1', '2', '1/(ctx.time-1)']) expect(() => evaluateCodeMaterial(compileCodeMaterial(source(`return [${image.replace('height:360', `height:360,opacity:${opacity}`)}];`)), context, reference)).toThrow(CodeMaterialError)
    expect(() => evaluateCodeMaterial(compileCodeMaterial(source(`return [${image.replace('width:640', 'width:-1')}];`)), context)).toThrow(CodeMaterialError)
  })

  it('单值校验只接受明确引用/null，拒绝路径、额外字段、原型与getter而不执行getter', () => {
    const program = compileCodeMaterial(source(`return [${image}];`))
    const declaration = program.parameters[0]
    const getter = vi.fn(() => 'logo')
    const accessor = { kind: 'image', get mediaId() { return getter() } }
    const symbol = Symbol('host')
    const invalid = [undefined, false, 1, 'D:/logo.png', [], {}, { kind: 'video', mediaId: 'logo' }, { kind: 'image', mediaId: '' }, { kind: 'image', mediaId: 'x'.repeat(101) }, { kind: 'image', mediaId: 'logo', path: 'D:/logo.png' }, { kind: 'image', mediaId: 'logo', [symbol]: true }, Object.create({ kind: 'image', mediaId: 'logo' }), accessor]
    for (const value of invalid) expect(() => validateCodeMaterialParameterValue(declaration, value)).toThrow(CodeMaterialError)
    expect(getter).not.toHaveBeenCalled()
    expect(validateCodeMaterialParameterValue(declaration, null)).toBeNull()
    expect(validateCodeMaterialParameterValue(declaration, { kind: 'image', mediaId: 'logo' })).toEqual({ kind: 'image', mediaId: 'logo' })
    const normalized = validateCodeMaterialParameters(program, { logo: { kind: 'image', mediaId: 'logo' } })
    expect(() => validateCodeMaterialParameters(program, { ...normalized, other: null })).toThrow('未声明')
  })

  it('图片默认值只能null且不可动画，滤镜即使不使用图片声明也拒绝', () => {
    for (const declaration of [parameters.replace('default:null', 'default:"logo"'), parameters.replace('default:null', 'default:{kind:"image",mediaId:"logo"}'), parameters.replace('default:null,', ''), parameters.replace('animatable:false', 'animatable:true')]) expect(() => compileCodeMaterial(source(`return [${image}];`, declaration))).toThrow(CodeMaterialError)
    expect(() => compileCodeMaterial(source('return sample(ctx.u,ctx.v);', parameters, 'filter'))).toThrow('图片资源参数仅用于生成器')
    expect(() => compileCodeMaterial(source('return image({source:ctx.params.logo,x:0,y:0,width:1,height:1});', parameters, 'filter'))).toThrow(CodeMaterialError)
  })

  it('资源不能访问路径、动态索引、条件、算术、比较或作为输出/采样参数逃逸', () => {
    const invalid = [
      'const p=ctx.params.logo.path;return [];', 'const p=ctx.params.logo.mediaId;return [];', 'const p=ctx.params.logo["path"];return [];',
      'const p=ctx.time>0?ctx.params.logo:ctx.params.logo;return [];', 'const p=ctx.params.logo+1;return [];', 'const p=ctx.params.logo===ctx.params.logo;return [];', 'const p=!ctx.params.logo;return [];',
      'return [ctx.params.logo];', 'return [sample(ctx.params.logo,0)];', 'return [image({source:"D:/logo.png",x:0,y:0,width:1,height:1})];', 'return [image({source:null,x:0,y:0,width:1,height:1})];',
      'return [image({source:ctx.params.logo,x:0,y:0,width:1,height:1,path:"D:/logo.png"})];',
    ]
    for (const body of invalid) expect(() => compileCodeMaterial(source(body))).toThrow(CodeMaterialError)
  })

  it('版本固定与参数演进保留绑定，删除/改类型显式拒绝', () => {
    const previous = compileCodeMaterial(source(`return [${image}];`))
    const values = { logo: { kind: 'image', mediaId: 'logo' } }
    const next = compileCodeMaterial(source(`return [${image}];`, parameters.replace('图片', '标志')))
    expect(checkCodeMaterialParameterCompatibility(previous, next, values)).toEqual(values)
    expect(() => checkCodeMaterialParameterCompatibility(previous, compileCodeMaterial(source('return [];', '{}')), values)).toThrow('显式迁移')
    expect(() => checkCodeMaterialParameterCompatibility(previous, compileCodeMaterial(source('return [];', '{logo:{type:"text",title:"图片",default:"",maxLength:10}}')), values)).toThrow('显式迁移')
    expect(() => evaluateCodeMaterial({ ...previous, languageVersion: 1 }, context, values)).toThrow('作者语言版本不一致')
    expect(() => validateCodeMaterialParameterValue(compileCodeMaterial(source('return [];', '{x:{type:"number",title:"x",default:1,min:0,max:2,step:1}}')).parameters[0], null)).toThrow(CodeMaterialError)
  })
})
