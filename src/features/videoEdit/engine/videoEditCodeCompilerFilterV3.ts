import { CodeMaterialError } from '@/core/videoEdit/codeMaterial/contract'
import type { CodeExpression, CodeMaterialProgram } from '@/core/videoEdit/codeMaterial/contract'
import { CODE_EASE_NAMES } from '@/core/videoEdit/codeMaterial/motion'
import type { Range, Value } from './codeGpuFilter'
interface Proof {
  range(min: number, max?: number, integer?: boolean): Range; scalar(value: Value): Range; colors(value: Value): Range[]; union(a: Range, b: Range): Range; multiply(a: Range, b: Range): Range; divide(a: Range, b: Range): Range; operationRange(min: number, max: number): Range
}
export interface CodeFilterPass { radius: CodeExpression; threshold?: CodeExpression }
export function codeMaterialFilterPasses(program: CodeMaterialProgram): CodeFilterPass[] {
  const passes: CodeFilterPass[] = []; const seen = new Set<string>()
  const walk = (expression: CodeExpression): void => {
    if (expression.kind === 'v3call' && ['blur', 'glow'].includes(expression.op)) {
      const radius = expression.args[expression.op === 'glow' ? 1 : 0]
      const uniform = (value: CodeExpression): boolean => value.kind === 'literal' && typeof value.value === 'number' || value.kind === 'parameter' && value.type === 'number' || value.kind === 'binding' && uniform(program.bindings[value.slot].expression)
      if (!uniform(radius)) throw new CodeMaterialError('TYPE', '滤镜 blur/glow 半径须为数值常量或数值参数。', expression.sourceSpan)
      const threshold = expression.op === 'glow' ? expression.args[0] : undefined
      if (threshold && !uniform(threshold)) throw new CodeMaterialError('TYPE', '滤镜 glow 阈值须为数值常量或数值参数。', expression.sourceSpan)
      const key = JSON.stringify([radius, threshold]); if (!seen.has(key)) { seen.add(key); passes.push({ radius, ...(threshold ? { threshold } : {}) }) }
    }
    for (const value of Object.values(expression)) {
      if (Array.isArray(value)) value.forEach(item => { if (item && typeof item === 'object' && 'kind' in item) walk(item as CodeExpression) })
      else if (value && typeof value === 'object' && 'kind' in value) walk(value as CodeExpression)
    }
  }
  program.bindings.forEach(binding => walk(binding.expression)); walk(program.result); return passes
}
export function codeFilterRadius(program: CodeMaterialProgram, expression: CodeExpression, parameters: Readonly<Record<string, unknown>>): number {
  const value = expression.kind === 'literal' ? expression.value : expression.kind === 'parameter' ? parameters[expression.key] : expression.kind === 'binding' ? codeFilterRadius(program, program.bindings[expression.slot].expression, parameters) : undefined
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 256) throw new CodeMaterialError('BUDGET', '可信滤镜半径须在 0–256 像素。')
  return value
}
export function emitCodeV3FilterCall(expression: Extract<CodeExpression, { kind: 'v3call' }>, args: Value[], passes: CodeFilterPass[], proof: Proof): Value {
  const { range, scalar, colors, union, multiply, divide, operationRange } = proof
  const code = args.map(value => value.code)
  const boundedColors = (value: Value): Range[] => {
    const channels = colors(value)
    if (channels.some(channel => channel.min < -1e-5 || channel.max > 1 + 1e-5)) throw new CodeMaterialError('TYPE', '色彩原语输入必须可证明位于 0–1。')
    return channels
  }
  const numberResult = (output: string, min: number, max: number): Value => ({ code: output, bounds: range(min, max, false) })
  const colorResult = (output: string): Value => ({ code: output, bounds: Array.from({ length: 4 }, () => range(0, 1, false)) })
  if (CODE_EASE_NAMES.includes(expression.op)) {
    const overshoot = expression.op === 'backOut' && args[1] ? scalar(args[1]) : range(1.70158)
    if (overshoot.min < 0 || overshoot.max > 10) throw new CodeMaterialError('TYPE', 'backOut 过冲须在 0–10。')
    return numberResult(`codeEase(${CODE_EASE_NAMES.indexOf(expression.op)}u,${code[0]},${args[1] ? code[1] : '1.70158'})`, expression.op === 'backOut' ? -10 : 0, ['backOut', 'elasticOut'].includes(expression.op) ? 12 : 1)
  }
  switch (expression.op) {
    case 'sampleOffset': return colorResult(`codeSample(uv+vec2f(${code.join(',')})/vec2f(p.context0.w,p.context1.x))`)
    case 'blur': case 'glow': {
      const pass = passes.findIndex(value => JSON.stringify([value.radius, value.threshold]) === JSON.stringify([expression.args[expression.op === 'glow' ? 1 : 0], expression.op === 'glow' ? expression.args[0] : undefined]))
      if (pass < 0) throw new CodeMaterialError('TYPE', '缺少可信模糊原语。')
      if (expression.op === 'blur') return colorResult(`codeUnpremultiply(textureSampleLevel(codeBlur${pass},inputSampler,uv,0.0))`)
      scalar(args[0]); scalar(args[2]); return colorResult(`codeGlow(uv,${code[0]},${code[2]},textureSampleLevel(codeBlur${pass},inputSampler,uv,0.0))`)
    }
    case 'average': {
      const items = args[0].items
      if (!items?.length || items.length > 64) throw new CodeMaterialError('BUDGET', 'average 需要 1–64 个颜色。')
      const bounds = [0, 1, 2, 3].map(index => range(items.reduce((sum, value) => sum + colors(value)[index].min, 0) / items.length, items.reduce((sum, value) => sum + colors(value)[index].max, 0) / items.length, false))
      return { code: `((${items.map(value => value.code).join('+')})/${items.length}.0)`, bounds }
    }
    case 'progress': {
      const duration = scalar(args[2]); if (duration.min <= 0) throw new CodeMaterialError('NON_FINITE', 'progress duration 必须可证明始终大于零。')
      divide(operationRange(scalar(args[0]).min - scalar(args[1]).max, scalar(args[0]).max - scalar(args[1]).min), duration)
      return numberResult(`clamp((${code[0]}-${code[1]})/${code[2]},0.0,1.0)`, 0, 1)
    }
    case 'stagger': return { code: `(${code[0]}*${code[1]})`, bounds: multiply(scalar(args[0]), scalar(args[1])) }
    case 'tween': {
      const ease = args[5].text
      if (!ease || !CODE_EASE_NAMES.includes(ease) || scalar(args[2]).min <= 0) throw new CodeMaterialError('TYPE', 'tween 需要静态缓动名称与正 duration。')
      const amount = `codeEase(${CODE_EASE_NAMES.indexOf(ease)}u,clamp((${code[0]}-${code[1]})/${code[2]},0.0,1.0),1.70158)`
      const a = args[3]; const b = args[4]
      const bounds = expression.type === 'color' ? colors(a).map((v, i) => union(v, colors(b)[i])) : union(scalar(a), scalar(b))
      if (['backOut', 'elasticOut'].includes(ease)) throw new CodeMaterialError('TYPE', '滤镜 tween 的过冲缓动请展开并显式 clamp。')
      return { code: `${expression.type === 'color' ? 'codeMixColor' : 'codeMix'}(${code[3]},${code[4]},${amount})`, bounds }
    }
    case 'cubicBezier': {
      if ([0, 2].some(i => scalar(args[i]).min < 0 || scalar(args[i]).max > 1)) throw new CodeMaterialError('TYPE', '贝塞尔 x 控制点须在 0–1。')
      return numberResult(`codeBezier(${code.join(',')})`, Math.min(0, scalar(args[1]).min, scalar(args[3]).min), Math.max(1, scalar(args[1]).max, scalar(args[3]).max))
    }
    case 'noise': {
      args.forEach(value => { if (Math.max(Math.abs(scalar(value).min), Math.abs(scalar(value).max)) > 1e6) throw new CodeMaterialError('NON_FINITE', '滤镜 noise 坐标须在正负一百万内。') })
      return numberResult(`codeNoise(vec3f(${code[0]},${code[1] ?? '0.0'},${code[2] ?? '0.0'}))`, 0, 1)
    }
    case 'luma': boundedColors(args[0]); return numberResult(`dot((${code[0]}).rgb,vec3f(.2126,.7152,.0722))`, 0, 1)
    case 'contrast': case 'saturate': boundedColors(args[0]); scalar(args[1]); return colorResult(`codeColorAdjust(${code[0]},${code[1]},${expression.op === 'contrast' ? 'true' : 'false'})`)
    case 'hsv': case 'hsl': args.forEach(scalar); return colorResult(`codeFromColor(vec3f(${code.slice(0, 3).join(',')}),${code[3] ?? '1.0'},${expression.op === 'hsl' ? 'true' : 'false'})`)
    case 'toHsv': case 'toHsl': boundedColors(args[0]); return colorResult(`codeToColor(${code[0]},${expression.op === 'toHsl' ? 'true' : 'false'})`)
    case 'keyframes': {
      const frames = args[1].items
      if (!frames?.length || frames.length > 256 || frames.some(frame => !frame.items || frame.items.length < 2 || frame.items.length > 3)) throw new CodeMaterialError('TYPE', 'keyframes 需要静态表。')
      let output = frames.at(-1)!.items![1].code; let minimum = scalar(frames[0].items![1]).min; let maximum = minimum
      for (let i = frames.length - 2; i >= 0; i--) {
        const a = frames[i].items!; const b = frames[i + 1].items!; const left = scalar(a[0]); const right = scalar(b[0]); const ease = a[2]?.text ?? 'linear'
        if (left.min !== left.max || right.min !== right.max || right.min <= left.max || !CODE_EASE_NAMES.includes(ease) || ['backOut', 'elasticOut'].includes(ease)) throw new CodeMaterialError('TYPE', '滤镜关键帧需要递增常量时刻与无过冲缓动。')
        minimum = Math.min(minimum, scalar(a[1]).min, scalar(b[1]).min); maximum = Math.max(maximum, scalar(a[1]).max, scalar(b[1]).max)
        output = `select(${output},codeMix(${a[1].code},${b[1].code},codeEase(${CODE_EASE_NAMES.indexOf(ease)}u,clamp((${code[0]}-${a[0].code})/(${b[0].code}-${a[0].code}),0.0,1.0),1.70158)),${code[0]}<${b[0].code})`
      }
      return numberResult(output, minimum, maximum)
    }
    default: throw new CodeMaterialError('TYPE', `滤镜不支持 ${expression.op}。`)
  }
}
export const CODE_V3_FILTER_HELPERS = `
fn codeUnpremultiply(c:vec4f)->vec4f { return vec4f(clamp(c.rgb/max(c.a,.000001),vec3f(0),vec3f(1)),c.a); }
fn codeGlow(uv:vec2f,threshold:f32,intensity:f32,blurred:vec4f)->vec4f {
 let base=codeSample(uv); let halo=clamp(blurred*clamp(intensity,0.0,16.0),vec4f(0),vec4f(1));
 let alpha=base.a+halo.a*(1.0-base.a);
 return vec4f(clamp((base.rgb*base.a+halo.rgb)/max(alpha,.000001),vec3f(0),vec3f(1)),alpha);
}
fn codeEase(k:u32,x:f32,over:f32)->f32 {
 let t=clamp(x,0.0,1.0); if(t==0.0 || t==1.0) { return t; }
 if(k==0u) { return t; }
 if(k==1u) { let q=t-1.0; return 1.0+(over+1.0)*q*q*q+over*q*q; }
 if(k==2u) { return exp2(-10.0*t)*sin((10.0*t-.75)*2.0943951024)+1.0; }
 if(k==3u) { if(t<.3636363636) { return 7.5625*t*t; } if(t<.7272727273) { return 7.5625*(t-.5454545455)*(t-.5454545455)+.75; } if(t<.9090909091) { return 7.5625*(t-.8181818182)*(t-.8181818182)+.9375; } return 7.5625*(t-.9545454545)*(t-.9545454545)+.984375; }
 let family=(k-4u)/3u; let mode=(k-4u)%3u; var u=t;
 if(mode==1u) { u=1.0-t; } if(mode==2u) { u=select(2.0*t,2.0-2.0*t,t>=.5); }
 var r=u; if(family==0u) { r=1.0-cos(u*1.5707963268); }
 else if(family<=4u) { r=pow(u,f32(family+1u)); }
 else if(family==5u) { r=select(exp2(10.0*u-10.0),0.0,u==0.0); }
 else { r=1.0-sqrt(max(0.0,1.0-u*u)); }
 if(mode==1u) { return 1.0-r; } if(mode==2u) { return select(r*.5,1.0-r*.5,t>=.5); } return r;
}
fn codeCurve(u:f32,a:f32,b:f32)->f32 { return 3.0*(1.0-u)*(1.0-u)*u*a+3.0*(1.0-u)*u*u*b+u*u*u; }
fn codeBezier(x1:f32,y1:f32,x2:f32,y2:f32,x:f32)->f32 { let t=clamp(x,0.0,1.0); if(t==0.0 || t==1.0) { return t; } var lo=0.0; var hi=1.0; for(var i=0u;i<24u;i++) { let mid=(lo+hi)*.5; if(codeCurve(mid,x1,x2)<t) { lo=mid; } else { hi=mid; } } return codeCurve((lo+hi)*.5,y1,y2); }
fn codeHash(q:vec3i)->f32 { var n=p.seed^(bitcast<u32>(q.x)*73856093u)^(bitcast<u32>(q.y)*19349663u)^(bitcast<u32>(q.z)*83492791u); n=(n^(n>>16u))*0x7feb352du; n=(n^(n>>15u))*0x846ca68bu; return f32(n^(n>>16u))/4294967296.0; }
fn codeNoise(q:vec3f)->f32 { let base=vec3i(floor(q)); let f=fract(q); let w=f*f*(3.0-2.0*f); var result=0.0; for(var i=0u;i<8u;i++) { let c=vec3i(i32(i&1u),i32((i>>1u)&1u),i32((i>>2u)&1u)); let weight=select(1.0-w,w,c==vec3i(1)); result+=codeHash(base+c)*weight.x*weight.y*weight.z; } return clamp(result,0.0,1.0); }
fn codeColorAdjust(c:vec4f,amount:f32,contrast:bool)->vec4f { let l=dot(c.rgb,vec3f(.2126,.7152,.0722)); return vec4f(clamp(select(vec3f(l)+(c.rgb-vec3f(l))*amount,(c.rgb-.5)*amount+.5,contrast),vec3f(0),vec3f(1)),c.a); }
fn codeFromColor(c:vec3f,a:f32,hsl:bool)->vec4f { var v=c.z; var s=c.y; if(hsl) { v=c.z+c.y*min(c.z,1.0-c.z); s=select(0.0,2.0*(1.0-c.z/max(v,.000001)),v>0.0); } let rgb=clamp(abs(fract(vec3f(c.x)+vec3f(0.0,2.0/3.0,1.0/3.0))*6.0-3.0)-1.0,vec3f(0),vec3f(1)); return vec4f(clamp(v*mix(vec3f(1),rgb,s),vec3f(0),vec3f(1)),clamp(a,0.0,1.0)); }
fn codeToColor(c:vec4f,hsl:bool)->vec4f { let hi=max(c.r,max(c.g,c.b)); let lo=min(c.r,min(c.g,c.b)); let d=hi-lo; var h=0.0; if(d>0.0) { if(hi==c.r) { h=(c.g-c.b)/d; } else if(hi==c.g) { h=(c.b-c.r)/d+2.0; } else { h=(c.r-c.g)/d+4.0; } h=fract(h/6.0+1.0); } let l=(hi+lo)*.5; var s=select(0.0,d/max(hi,.000001),hi>0.0); if(hsl) { s=select(0.0,d/max(1.0-abs(2.0*l-1.0),.000001),d>0.0); } return vec4f(h,s,select(hi,l,hsl),c.a); }
`
