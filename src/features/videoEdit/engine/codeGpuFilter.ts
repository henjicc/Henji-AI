import { VIDEO_EDIT_MAX_SEQUENCE_SECONDS, VIDEO_EDIT_MAX_SEQUENCE_FRAMES } from '@/core/videoEdit/time'
import { CodeMaterialError, CODE_MATERIAL_LIMITS } from '@/core/videoEdit/codeMaterial/contract'
import type { CodeExpression, CodeMaterialProgram } from '@/core/videoEdit/codeMaterial/contract'

interface Range { min: number; max: number; integer: boolean }
type Bounds = Range | Range[] | null
interface Value { code: string; bounds: Bounds }
const float = new Float32Array(1)
const bits = new Uint32Array(float.buffer)
const MIN_NORMAL = 1.1754943508222875e-38
function includeSubnormals(min: number, max: number, integer: boolean): Range {
  // WGSL allows flushing and exceptional min/max/clamp results for subnormals.
  // Cover the entire subnormal band whenever either side can enter it.
  const overlaps = !integer && (min < MIN_NORMAL && max > 0 || min < 0 && max > -MIN_NORMAL)
  return overlaps ? { min: Math.min(min, -MIN_NORMAL), max: Math.max(max, MIN_NORMAL), integer: false } : { min, max, integer }
}
function adjacent(value: number, upward: boolean): number {
  float[0] = value
  if (value === 0) { bits[0] = upward ? 1 : 0x80000001; return float[0] }
  bits[0] += (value > 0) === upward ? 1 : -1
  return float[0]
}
const range = (min: number, max = min, integer = Number.isInteger(min) && min === max): Range => {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min > max || Math.max(Math.abs(min), Math.abs(max)) > 1e18) throw new CodeMaterialError('NON_FINITE', '滤镜数值范围无法安全表达，请缩小数值或显式限制计算范围。')
  // Constants and uniforms are uploaded as f32, including fixed parameter ranges.
  const low = Math.fround(min); const high = Math.fround(max)
  return includeSubnormals(low, high, integer)
}
const operationRange = (min: number, max: number, integer = false, ulps = 1): Range => {
  const value = range(min, max, integer)
  // Arithmetic is rounded; division permits 2.5 ULP under the WGSL contract.
  let low = value.min; let high = value.max
  for (let index = 0; index < ulps; index++) { low = adjacent(low, false); high = adjacent(high, true) }
  return includeSubnormals(low, high, integer)
}
const scalar = (value: Value): Range => {
  if (!value.bounds || Array.isArray(value.bounds)) throw new CodeMaterialError('TYPE', '滤镜需要数值表达式。')
  return value.bounds
}
const colors = (value: Value): Range[] => {
  if (!Array.isArray(value.bounds) || value.bounds.length !== 4) throw new CodeMaterialError('TYPE', '滤镜需要四通道颜色。')
  return value.bounds
}
const union = (a: Range, b: Range): Range => range(Math.min(a.min, b.min), Math.max(a.max, b.max), a.integer && b.integer)
const multiply = (a: Range, b: Range): Range => {
  const products = [a.min * b.min, a.min * b.max, a.max * b.min, a.max * b.max]
  return operationRange(Math.min(...products), Math.max(...products), a.integer && b.integer)
}
const divide = (a: Range, b: Range): Range => {
  if (b.min <= 0 && b.max >= 0 || Math.min(Math.abs(b.min), Math.abs(b.max)) < 1e-12) throw new CodeMaterialError('NON_FINITE', '滤镜除数可能为零或过小，请显式限制为安全范围。')
  const values = [a.min / b.min, a.min / b.max, a.max / b.min, a.max / b.max]
  return operationRange(Math.min(...values), Math.max(...values), false, 3)
}
const contextRanges: Record<string, Range> = {
  time: range(0, VIDEO_EDIT_MAX_SEQUENCE_SECONDS, false), localTime: range(0, VIDEO_EDIT_MAX_SEQUENCE_SECONDS, false), sequenceTime: range(0, VIDEO_EDIT_MAX_SEQUENCE_SECONDS, false),
  width: range(1, 8192, true), height: range(1, 8192, true), frame: range(0, VIDEO_EDIT_MAX_SEQUENCE_FRAMES, true), fps: range(1, 240, false), u: range(0, 1, false), v: range(0, 1, false),
}
const contextCode: Record<string, string> = { time: 'p.context0.x', localTime: 'p.context0.y', sequenceTime: 'p.context0.z', width: 'p.context0.w', height: 'p.context1.x', frame: 'p.context1.y', fps: 'p.context1.z', u: 'uv.x', v: 'uv.y' }

/** Emit only checked scalar/color IR. Conservative range analysis rejects unsafe
 * denominators and overflow before a pipeline reaches the GPU; no author WGSL. */
export function emitCodeMaterialFilter(program: CodeMaterialProgram, transitionHandles = false): string {
  if (program.kind !== 'filter' || program.languageVersion !== 1 || program.parameters.length > 32 || program.metrics.samples > 4 || program.metrics.scalarOperations > 128) throw new CodeMaterialError('BUDGET', '滤镜版本或资源预算无效。')
  const bindings: Value[] = []; let nodes = 0
  const emit = (expression: CodeExpression, depth = 0): Value => {
    if (++nodes > CODE_MATERIAL_LIMITS.astNodes || depth > CODE_MATERIAL_LIMITS.depth) throw new CodeMaterialError('BUDGET', '滤镜表达式超出预算。')
    const next = (value: CodeExpression): Value => emit(value, depth + 1)
    switch (expression.kind) {
      case 'literal': {
        if (typeof expression.value === 'boolean') return { code: String(expression.value), bounds: null }
        if (typeof expression.value !== 'number') throw new CodeMaterialError('TYPE', '滤镜不支持文字。')
        const bounds = range(expression.value)
        const value = Math.fround(expression.value)
        const code = Number.isInteger(value) ? `${value}.0f` : `${value}f`
        return { code, bounds }
      }
      case 'color': { const values = expression.values.map(next); return { code: `vec4f(${values.map(value => value.code).join(',')})`, bounds: values.map(scalar) } }
      case 'context': {
        if (!contextRanges[expression.key]) throw new CodeMaterialError('TYPE', '未知滤镜时间字段。')
        return { code: contextCode[expression.key], bounds: expression.key === 'localTime' && transitionHandles ? range(-VIDEO_EDIT_MAX_SEQUENCE_SECONDS, VIDEO_EDIT_MAX_SEQUENCE_SECONDS, false) : contextRanges[expression.key] }
      }
      case 'parameter': {
        const index = program.parameters.findIndex(item => item.key === expression.key); const parameter = program.parameters[index]
        if (!parameter) throw new CodeMaterialError('PARAMETERS', '滤镜参数不存在。')
        const code = `p.parameters[${index}]`
        if (parameter.type === 'number') return { code: `${code}.x`, bounds: range(parameter.min, parameter.max) }
        if (parameter.type === 'boolean') return { code: `(${code}.x != 0.0)`, bounds: null }
        if (parameter.type === 'color') return { code, bounds: Array.from({ length: 4 }, () => range(0, 1, false)) }
        throw new CodeMaterialError('TYPE', '滤镜不支持文字或选项参数。')
      }
      case 'binding': {
        const value = bindings[expression.slot]
        if (!value) throw new CodeMaterialError('TYPE', '滤镜绑定不存在。')
        return { code: `b${expression.slot}`, bounds: value.bounds }
      }
      case 'component': { const value = next(expression.value); return { code: `(${value.code})[${expression.index}]`, bounds: colors(value)[expression.index] } }
      case 'unary': {
        const value = next(expression.value)
        if (expression.op === '!') return { code: `!(${value.code})`, bounds: null }
        const a = scalar(value)
        return { code: expression.op === '+' ? value.code : `-(${value.code})`, bounds: expression.op === '+' ? a : range(-a.max, -a.min, a.integer) }
      }
      case 'binary': {
        const a = next(expression.left); const b = next(expression.right)
        let bounds: Bounds = null
        if (expression.type === 'number') {
          const x = scalar(a); const y = scalar(b)
          if (expression.op === '+') bounds = operationRange(x.min + y.min, x.max + y.max, x.integer && y.integer)
          else if (expression.op === '-') bounds = operationRange(x.min - y.max, x.max - y.min, x.integer && y.integer)
          else if (expression.op === '*') bounds = multiply(x, y)
          else if (expression.op === '/' || expression.op === '%') {
            const divided = divide(x, y)
            if (expression.op === '/') bounds = divided
            else {
              const product = multiply(range(Math.trunc(divided.min), Math.trunc(divided.max), true), y)
              bounds = operationRange(x.min - product.max, x.max - product.min, x.integer && y.integer)
            }
          } else throw new CodeMaterialError('TYPE', '未知滤镜数值操作。')
        }
        const op = expression.op === '===' ? '==' : expression.op === '!==' ? '!=' : expression.op
        // JS remainder truncates toward zero; WGSL float remainder is expressed explicitly.
        const code = op === '%' ? `codeRemainder(${a.code},${b.code})` : `(${a.code} ${op} ${b.code})`
        return { code, bounds }
      }
      case 'conditional': {
        const test = next(expression.condition); const yes = next(expression.yes); const no = next(expression.no)
        const bounds = expression.type === 'color' ? colors(yes).map((value, index) => union(value, colors(no)[index])) : expression.type === 'number' ? union(scalar(yes), scalar(no)) : null
        return { code: `select(${no.code},${yes.code},${test.code})`, bounds }
      }
      case 'call': {
        const args = expression.args.map(next); const code = args.map(value => value.code)
        const a = (): Range => scalar(args[0]); const b = (): Range => scalar(args[1]); const c = (): Range => scalar(args[2])
        let bounds: Bounds; let output = `${expression.op}(${code.join(',')})`
        switch (expression.op) {
          case 'sample': return { code: `codeSample(vec2f(${code.join(',')}))`, bounds: Array.from({ length: 4 }, () => range(0, 1, false)) }
          case 'rgba': return { code: `vec4f(${code.join(',')})`, bounds: args.map(scalar) }
          case 'sin': case 'cos': {
            if (a().min < -Math.PI || a().max > Math.PI) throw new CodeMaterialError('NON_FINITE', '滤镜三角函数输入须可证明位于负π到π，避免未规定的GPU误差范围。')
            bounds = range(-1 - 2 ** -11, 1 + 2 ** -11, false)
            break
          }
          case 'abs': bounds = range(a().min <= 0 && a().max >= 0 ? 0 : Math.min(Math.abs(a().min), Math.abs(a().max)), Math.max(Math.abs(a().min), Math.abs(a().max)), a().integer); break
          case 'floor': case 'ceil': case 'round': {
            const input = expression.op === 'round' ? operationRange(a().min + .5, a().max + .5) : a()
            const fn = expression.op === 'ceil' ? Math.ceil : Math.floor
            bounds = range(fn(input.min), fn(input.max), true)
            if (expression.op === 'round') output = `floor(${code[0]}+0.5)` // The f32 addition is included in the proof above.
            break
          }
          case 'min': bounds = range(Math.min(a().min, b().min), Math.min(a().max, b().max), a().integer && b().integer); break
          case 'max': bounds = range(Math.max(a().min, b().min), Math.max(a().max, b().max), a().integer && b().integer); break
          case 'random': {
            if (!a().integer || a().min < 0 || a().max > 16777215) throw new CodeMaterialError('TYPE', '滤镜随机索引必须可证明为0到16777215的整数。')
            output = `codeRandom(u32(${code[0]}))`; bounds = range(0, 1, false); break
          }
          case 'clamp': {
            if (b().max > c().min) throw new CodeMaterialError('TYPE', '滤镜clamp上下限可能颠倒。')
            const limit = (x: Range): Range => range(Math.min(Math.max(x.min, b().min), c().min), Math.min(Math.max(x.max, b().max), c().max), false)
            bounds = expression.type === 'color' ? colors(args[0]).map(limit) : limit(a())
            if (expression.type === 'color') output = `clamp(${code[0]},vec4f(${code[1]}),vec4f(${code[2]}))`
            break
          }
          case 'mix': {
            const mix = (x: Range, y: Range): Range => {
              const delta = operationRange(y.min - x.max, y.max - x.min, false); const product = multiply(delta, c())
              const computed = operationRange(x.min + product.min, x.max + product.max, false)
              if (c().min < 0 || c().max > 1) return computed
              // Retain the convex mathematical bound plus accumulated f32 error.
              // The helper uses exactly subtraction, multiplication and addition.
              const magnitude = Math.max(Math.abs(x.min), Math.abs(x.max), Math.abs(y.min), Math.abs(y.max))
              const error = (adjacent(Math.fround(magnitude), true) - Math.fround(magnitude)) * 16
              const convex = union(x, y)
              return operationRange(Math.max(computed.min, convex.min - error), Math.min(computed.max, convex.max + error), false)
            }
            bounds = expression.type === 'color' ? colors(args[0]).map((x, index) => mix(x, colors(args[1])[index])) : mix(a(), b())
            output = `${expression.type === 'color' ? 'codeMixColor' : 'codeMix'}(${code.join(',')})`; break
          }
          case 'smoothstep': {
            const denominator = operationRange(b().min - a().max, b().max - a().min)
            if (denominator.min < 1e-12) throw new CodeMaterialError('TYPE', '滤镜smoothstep边界必须始终递增。')
            divide(operationRange(c().min - a().max, c().max - a().min), denominator)
            output = `codeSmooth(${code.join(',')})`; bounds = range(0, 1, false); break
          }
          default: throw new CodeMaterialError('TYPE', '滤镜函数不在白名单。')
        }
        return { code: output, bounds }
      }
      default: throw new CodeMaterialError('TYPE', '滤镜不得输出图形或其他宿主值。')
    }
  }
  const declarations: string[] = []
  for (const binding of program.bindings) { const value = emit(binding.expression); declarations.push(`let b${bindings.length} = ${value.code};`); bindings.push(value) }
  const result = emit(program.result)
  if (colors(result).some(channel => channel.min < -1e-5 || channel.max > 1 + 1e-5)) throw new CodeMaterialError('PARAMETERS', '滤镜输出必须始终位于0到1；请在可能越界的颜色通道显式使用clamp。')
  return `
struct Params { context0:vec4f, context1:vec3f, seed:u32, parameters:array<vec4f,32>, flags:vec4f }
@group(0) @binding(0) var inputTexture: texture_2d<f32>;
@group(0) @binding(1) var inputSampler: sampler;
@group(0) @binding(2) var<uniform> p: Params;
struct Vertex { @builtin(position) position: vec4f }
@vertex fn vs(@builtin(vertex_index) i:u32)->Vertex {
 let q = array<vec2f,3>(vec2f(0,0),vec2f(0,2),vec2f(2,0))[i];
 return Vertex(vec4f(q.x*2-1,1-q.y*2,0,1));
}
fn codeSample(uv:vec2f)->vec4f {
 let c = textureSampleLevel(inputTexture,inputSampler,clamp(uv,vec2f(0),vec2f(1)),0);
 if (p.flags.x != 0.0) { return vec4f(clamp(c.rgb/max(c.a,0.000001),vec3f(0),vec3f(1)),c.a); }
 return c;
}
fn codeRandom(index:u32)->f32 {
 var n = p.seed^index;
 n = (n^(n>>16u))*0x7feb352du; n = (n^(n>>15u))*0x846ca68bu;
 return f32(n^(n>>16u))/4294967296.0;
}
fn codeRemainder(a:f32,b:f32)->f32 { return a-trunc(a/b)*b; }
fn codeMix(a:f32,b:f32,t:f32)->f32 { return a+(b-a)*t; }
fn codeMixColor(a:vec4f,b:vec4f,t:f32)->vec4f { return a+(b-a)*t; }
fn codeSmooth(a:f32,b:f32,x:f32)->f32 {
 let t=clamp((x-a)/(b-a),0.0,1.0);
 return clamp(t*t*(3.0-2.0*t),0.0,1.0);
}
@fragment fn fs(v:Vertex)->@location(0) vec4f {
 let uv = v.position.xy/vec2f(p.context0.w,p.context1.x);
 ${declarations.join('\n')}
 let color = clamp(${result.code},vec4f(0),vec4f(1));
 return vec4f(color.rgb*color.a,color.a);
}`
}
