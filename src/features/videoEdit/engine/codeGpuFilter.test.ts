import { describe, expect, it } from 'vitest'
import { compileCodeMaterial } from '@/core/videoEdit/codeMaterial/compiler'
import { emitCodeMaterialFilter } from './codeGpuFilter'

function filter(body: string, parameters = '{}'): string { return `export default {apiVersion:1,name:"滤镜",kind:"filter",mode:"dynamic",width:3840,height:2160,durationSeconds:10,seed:42,parameters:${parameters},render(ctx){${body}}}` }
describe('可信GPU滤镜白名单与预算', () => {
  it('参数投影和局部采样保持一次求值，不把参数写入管线源码', () => {
    const program = compileCodeMaterial(filter('const pixel=sample(ctx.u,ctx.v);return rgba(clamp(pixel.r*ctx.params.amount,0,1),pixel.g,pixel.b,pixel.a);', '{amount:{type:"number",title:"强度",default:.5,min:0,max:2,step:.01}}'))
    const shader = emitCodeMaterialFilter(program)
    expect(shader.match(/codeSample\(vec2f/g)).toHaveLength(1)
    expect(shader).toContain('p.parameters[0].x')
    expect(shader).toContain('color.rgb*color.a')
    expect(program.metrics.samples).toBe(1)
  })
  it('拒绝可能除零、非有限中间值和未限制的越界颜色，失败不会被clamp掩盖', () => {
    expect(() => emitCodeMaterialFilter(compileCodeMaterial(filter('return rgba(clamp(1/ctx.u,0,1),0,0,1);')))).toThrow('除数')
    expect(() => emitCodeMaterialFilter(compileCodeMaterial(filter('return rgba(clamp(1e18*1e18,0,1),0,0,1);')))).toThrow('范围')
    expect(() => emitCodeMaterialFilter(compileCodeMaterial(filter('return rgba(ctx.time,0,0,1);')))).toThrow('输出')
    expect(() => emitCodeMaterialFilter(compileCodeMaterial(filter('return rgba(smoothstep(ctx.u,ctx.v,0.5),0,0,1);')))).toThrow('边界')
  })
  it('嵌套余数保持线性源码和一次采样，使用JS舍入及余数语义', () => {
    const expression = `${'('.repeat(12)}sample(ctx.u,ctx.v).r${'%0.5)'.repeat(12)}`
    const shader = emitCodeMaterialFilter(compileCodeMaterial(filter(`return rgba(clamp(${expression},0,1),clamp(round(-.5),0,1),0,1);`)))
    expect(shader.match(/codeSample\(vec2f/g)).toHaveLength(1)
    expect(shader.length).toBeLessThan(3000)
    expect(shader).toContain('codeRemainder')
    expect(shader).toContain('floor(-(0.5f)+0.5)')
  })
  it('随机只允许可证明的有界整数索引，使用真实u32种子', () => {
    const shader = emitCodeMaterialFilter(compileCodeMaterial(filter('return rgba(random(ctx.frame),0,0,1);')))
    expect(shader).toContain('p.seed^index')
    expect(() => emitCodeMaterialFilter(compileCodeMaterial(filter('return rgba(random(ctx.u),0,0,1);')))).toThrow('整数')
  })
  it('按实际f32上传和每次运算证明有限性，拒绝量化消失的分母', () => {
    const parameters = '{a:{type:"number",title:"A",default:16777216,min:16777216,max:16777216,step:1},b:{type:"number",title:"B",default:16777217,min:16777217,max:16777217,step:1}}'
    expect(() => emitCodeMaterialFilter(compileCodeMaterial(filter('return rgba(clamp(1/(ctx.params.b-ctx.params.a),0,1),0,0,1);', parameters)))).toThrow('除数')
    expect(() => emitCodeMaterialFilter(compileCodeMaterial(filter('return rgba(clamp(1/(16777217-16777216),0,1),0,0,1);')))).toThrow('除数')
    const tiny = '{x:{type:"number",title:"X",default:1e-38,min:1e-38,max:1e-38,step:1e-38}}'
    expect(() => emitCodeMaterialFilter(compileCodeMaterial(filter('return rgba(clamp(1/(ctx.params.x*1e18*1e18),0,1),0,0,1);', tiny)))).toThrow('除数')
    const fixed = '{a:{type:"number",title:"A",default:.1,min:.1,max:.1,step:.1},c:{type:"number",title:"C",default:.1,min:.1,max:.1,step:.1}}'
    expect(() => emitCodeMaterialFilter(compileCodeMaterial(filter('return rgba(clamp(1/(mix(ctx.params.a,ctx.params.a,ctx.params.c)-0.09999999403953552),0,1),0,0,1);', fixed)))).toThrow('除数')
    const boundary = '{a:{type:"number",title:"A",default:.49999997,min:.49999997,max:.49999997,step:.01}}'
    expect(Math.floor(Math.fround(Math.fround(.49999997) + .5))).toBe(1)
    expect(() => emitCodeMaterialFilter(compileCodeMaterial(filter('return rgba(clamp(1/(1-round(ctx.params.a)),0,1),0,0,1);', boundary)))).toThrow('除数')
    const subnormals = '{a:{type:"number",title:"A",default:1e-38,min:1e-38,max:1e-38,step:1e-38},b:{type:"number",title:"B",default:1.1e-38,min:1.1e-38,max:1.1e-38,step:1e-38}}'
    expect(() => emitCodeMaterialFilter(compileCodeMaterial(filter('return rgba(clamp(1/(0.010999999940395355-min(ctx.params.a,ctx.params.b)*1e18*1e18),0,1),0,0,1);', subnormals)))).toThrow('除数')
    expect(() => emitCodeMaterialFilter(compileCodeMaterial(filter('return rgba(clamp(1/(1.0001-sin(1.5707963)),0,1),0,0,1);')))).toThrow('除数')
    expect(() => emitCodeMaterialFilter(compileCodeMaterial(filter('return rgba(clamp(sin(ctx.time),0,1),0,0,1);')))).toThrow('三角函数输入')
    expect(emitCodeMaterialFilter(compileCodeMaterial(filter('return rgba(clamp(sin(clamp(ctx.time,0,3)),0,1),0,0,1);')))).toContain('sin(clamp(')
  })
})
