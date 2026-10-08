import { describe, expect, it } from 'vitest'
import { compileCodeMaterial } from './compiler'
import { codeMaterialAuthoringHints } from './authoringHints'

const source = (parameters: string, body: string): string => `export default {apiVersion:1,languageVersion:3,name:"体检",kind:"generator",mode:"dynamic",width:1920,height:1080,durationSeconds:4,seed:1,parameters:${parameters},render(ctx){${body}}}`
const codes = (parameters: string, body: string): string[] => codeMaterialAuthoringHints(compileCodeMaterial(source(parameters, body))).map(hint => hint.code)

describe('参数化体检', () => {
  it('没有参数、写死文字与重复颜色都给出提示', () => {
    const hints = codeMaterialAuthoringHints(compileCodeMaterial(source('{}', 'return [rect({x:0,y:0,width:10,height:10,fill:[1,0,0,1]}),rect({x:20,y:0,width:10,height:10,fill:[1,0,0,1]}),rect({x:40,y:0,width:10,height:10,fill:[1,0,0,1]}),text({x:5,y:5,text:"新品发布",fontSize:40,color:[1,1,1,1]})];')))
    expect(hints.map(hint => hint.code)).toEqual(['NO_PARAMETERS', 'LITERAL_TEXT', 'REPEATED_COLOR'])
    expect(hints[1].message).toContain('新品发布')
    expect(hints[2].message).toContain('3 个元素')
  })
  it('参数化写法没有提示；声明了却没用的参数要指出', () => {
    expect(codes('{title:{type:"text",title:"标题",default:"A",maxLength:20},accent:{type:"color",title:"主色",default:[1,0,0,1]}}', 'return [rect({x:0,y:0,width:10,height:10,fill:ctx.params.accent}),text({x:5,y:5,text:ctx.params.title,fontSize:40,color:ctx.params.accent})];')).toEqual([])
    expect(codes('{size:{type:"number",title:"字号",default:40,min:10,max:100,step:1}}', 'return [rect({x:0,y:0,width:10,height:10,fill:[0,0,0,1]})];')).toEqual(['UNUSED_PARAMETER'])
  })
  it('经由 const 别名读取的参数算已使用', () => {
    expect(codes('{size:{type:"number",title:"字号",default:40,min:10,max:100,step:1}}', 'const s=ctx.params.size*2; return [rect({x:0,y:0,width:s,height:s,fill:[0,0,0,1]})];')).toEqual([])
  })
})
