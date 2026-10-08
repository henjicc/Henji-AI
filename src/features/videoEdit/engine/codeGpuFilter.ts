import { VIDEO_EDIT_MAX_SEQUENCE_SECONDS, VIDEO_EDIT_MAX_SEQUENCE_FRAMES } from '@/core/videoEdit/time'
import { CodeMaterialError, CODE_MATERIAL_LIMITS, CODE_V3_LIMITS } from '@/core/videoEdit/codeMaterial/contract'
import type { CodeExpression, CodeMaterialProgram } from '@/core/videoEdit/codeMaterial/contract'
import { emitCodeV3FilterCall, CODE_V3_FILTER_HELPERS, codeMaterialFilterPasses } from './videoEditCodeCompilerFilterV3'
import { codeShaderFilterPasses, unwrapCodeShaderExpression } from '@/core/videoEdit/codeMaterial/shaders'
import { bindCodeMaterialStyle } from '@/core/videoEdit/codeMaterial/style'
import { CODE_FILTER_PARAMETER_SLOTS, codeFilterParameterReference, codeFilterParameterSlots, codeFilterParameterSlotId } from '@/core/videoEdit/codeMaterial/filterParameters'
import type { CodeParameterDeclaration } from '@/core/videoEdit/codeMaterial/contract'

export interface Range { min: number; max: number; integer: boolean }
export type Bounds = Range | Range[] | null
export interface Value { code: string; bounds: Bounds; items?: Value[]; text?: string; fields?: Record<string, Value> }
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
  program = bindCodeMaterialStyle(program)
  const shaders = codeShaderFilterPasses(program)
  const limits = program.languageVersion === 3 ? CODE_V3_LIMITS : CODE_MATERIAL_LIMITS
  if (program.kind !== 'filter' || ![1, 3].includes(program.languageVersion) || program.languageVersion === 1 && program.parameters.length > 32 || program.metrics.samples > limits.filterSamples || program.metrics.scalarOperations > limits.filterScalarOperations) throw new CodeMaterialError('BUDGET', '滤镜版本或资源预算无效。')
  const slots = new Map(codeFilterParameterSlots(program).map(slot => [codeFilterParameterSlotId(slot.key, slot.field), slot]))
  const uniformValue = (key: string, parameter: CodeParameterDeclaration, field?: string): Value => {
    if (parameter.type === 'custom') return { code: '', bounds: null, fields: Object.fromEntries(Object.entries(parameter.fields).filter(([name]) => slots.has(codeFilterParameterSlotId(key, name))).map(([name, member]) => [name, uniformValue(key, member, name)])) }
    const slot = slots.get(codeFilterParameterSlotId(key, field))
    if (!slot) throw new CodeMaterialError('TYPE', `滤镜参数 ${key}${field ? '.' + field : ''} 缺少 GPU 槽位。`)
    const code = `p.parameters[${slot.index}]`
    if (parameter.type === 'number' || parameter.type === 'angle') return { code: `${code}.x`, bounds: range(parameter.min, parameter.max) }
    if (parameter.type === 'seed') return { code: `${code}.x`, bounds: range(0, 4294967295) }
    if (parameter.type === 'boolean') return { code: `(${code}.x != 0.0)`, bounds: null }
    if (parameter.type === 'color') return { code, bounds: [range(0, 1, false), range(0, 1, false), range(0, 1, false), parameter.alpha === false ? range(1) : range(0, 1, false)] }
    const member = (channel: string, min: number, max: number): Value => ({ code: `${code}.${channel}`, bounds: range(min, max) })
    if (parameter.type === 'point') {
      const x = member('x', parameter.min.x, parameter.max.x); const y = member('y', parameter.min.y, parameter.max.y)
      return { code: `${code}.xy`, bounds: [scalar(x), scalar(y)], fields: { x, y } }
    }
    if (parameter.type === 'range') {
      const a = member('x', parameter.min, parameter.max); const b = member('y', parameter.min, parameter.max)
      return { code: `${code}.xy`, bounds: [scalar(a), scalar(b)], items: [a, b] }
    }
    if (parameter.type === 'grade') return { code: `${code}.xyz`, bounds: [range(0, 360), range(0, 1), range(-1, 1)], fields: { hue: member('x', 0, 360), strength: member('y', 0, 1), luminance: member('z', -1, 1) } }
    throw new CodeMaterialError('TYPE', `参数 ${key}（${parameter.type}）不能用于逐像素 GPU 表达式。`)
  }
  const bindings: Value[] = []; const locals = new Map<number, Value>(); const passes = codeMaterialFilterPasses(program); let nodes = 0
  const emit = (expression: CodeExpression, depth = 0): Value => {
    if (++nodes > limits.astNodes || depth > limits.depth) throw new CodeMaterialError('BUDGET', '滤镜表达式超出预算。')
    const next = (value: CodeExpression): Value => emit(value, depth + 1)
    if (expression.kind === 'field') {
      const reference = codeFilterParameterReference(program, expression)
      if (reference) {
        let result = uniformValue(reference.key, reference.parameter, reference.field)
        for (const key of reference.projection) {
          const member = result.fields?.[key]
          if (member) result = member
          else if (key === 'length' && result.items) result = { code: `${result.items.length}.0`, bounds: range(result.items.length) }
          else throw new CodeMaterialError('TYPE', `滤镜参数不存在字段 ${key}。`)
        }
        return result
      }
    }
    switch (expression.kind) {
      case 'literal': {
        if (typeof expression.value === 'boolean') return { code: String(expression.value), bounds: null }
        if (typeof expression.value === 'string' && program.languageVersion === 3) return { code: '', bounds: null, text: expression.value }
        if (typeof expression.value !== 'number') throw new CodeMaterialError('TYPE', '滤镜不支持文字。')
        const bounds = range(expression.value)
        const value = Math.fround(expression.value)
        const code = Number.isInteger(value) ? `${value}.0f` : `${value}f`
        return { code, bounds }
      }
      case 'color': { const values = expression.values.map(next); return { code: `vec4f(${values.map(value => value.code).join(',')})`, bounds: values.map(scalar) } }
      case 'local': { const value = locals.get(expression.slot); if (!value) throw new CodeMaterialError('TYPE', '无效滤镜展开索引。'); return value }
      case 'array': return { code: '', bounds: null, items: expression.values.map(next) }
      case 'object': return { code: '', bounds: null, fields: Object.fromEntries(Object.entries(expression.properties).map(([key, value]) => [key, next(value)])) }
      case 'repeat': {
        const count = scalar(next(expression.count))
        if (count.min !== count.max || !count.integer || count.min < 1 || count.max > 64) throw new CodeMaterialError('BUDGET', '滤镜 repeat 次数须为 1–64 的编译期整数常量。')
        const items: Value[] = []
        for (let i = 0; i < count.max; i++) { locals.set(expression.slot, { code: `${i}.0`, bounds: range(i) }); items.push(next(expression.body)) }
        locals.delete(expression.slot); return { code: '', bounds: null, items }
      }
      case 'index': {
        const value = next(expression.value); const index = scalar(next(expression.index))
        if (expression.value.type === 'color' && index.min === index.max && index.integer && index.min >= 0 && index.max < 4) return { code: `(${value.code})[${index.min}]`, bounds: colors(value)[index.min] }
        if (!value.items || index.min !== index.max || !index.integer || index.min < 0 || index.max >= value.items.length) throw new CodeMaterialError('TYPE', '滤镜表索引须为预算内静态整数。')
        return value.items[index.min]
      }
      case 'field': { const value = next(expression.value); if (value.fields?.[expression.key]) return value.fields[expression.key]; if (expression.key === 'length' && value.items) return { code: `${value.items.length}.0`, bounds: range(value.items.length) }; throw new CodeMaterialError('TYPE', '滤镜不支持此字段。') }
      case 'v3call': {
        if (expression.op === 'shaderFilter') {
          const index = shaders.findIndex(pass => pass.expression === unwrapCodeShaderExpression(program, expression))
          if (index < 0) throw new CodeMaterialError('TYPE', '缺少可信着色器工序。', expression.sourceSpan)
          return { code: `codeUnpremultiply(textureSampleLevel(codeShader${index},inputSampler,uv,0.0))`, bounds: Array.from({ length: 4 }, () => range(0, 1, false)) }
        }
        try { return emitCodeV3FilterCall(expression, expression.args.map(next), passes, { range, scalar, colors, union, multiply, divide, operationRange }) }
        catch (error) { if (error instanceof CodeMaterialError && !error.sourceSpan && expression.sourceSpan) throw new CodeMaterialError(error.code, error.message, expression.sourceSpan); throw error }
      }
      case 'context': {
        if (!contextRanges[expression.key]) throw new CodeMaterialError('TYPE', '未知滤镜时间字段。')
        return { code: contextCode[expression.key], bounds: expression.key === 'localTime' && transitionHandles ? range(-VIDEO_EDIT_MAX_SEQUENCE_SECONDS, VIDEO_EDIT_MAX_SEQUENCE_SECONDS, false) : contextRanges[expression.key] }
      }
      case 'parameter': {
        const parameter = program.parameters.find(item => item.key === expression.key)
        if (!parameter) throw new CodeMaterialError('PARAMETERS', '滤镜参数不存在。')
        return uniformValue(expression.key, parameter)
      }
      case 'binding': {
        const value = bindings[expression.slot]
        if (!value) throw new CodeMaterialError('TYPE', '滤镜绑定不存在。')
        return value.items || value.fields ? value : { code: `b${expression.slot}`, bounds: value.bounds, text: value.text }
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
  // Frame uniforms are evaluated on CPU. Do not range-prove/emit unused host-only bindings per pixel.
  const pixelBindings = new Set<number>()
  const pixelUse = (value: CodeExpression): void => {
    if (value.kind === 'v3call' && value.op === 'shaderFilter') return
    if (value.kind === 'binding') { if (!pixelBindings.has(value.slot)) { pixelBindings.add(value.slot); pixelUse(program.bindings[value.slot].expression) } return }
    for (const item of Object.values(value)) {
      if (Array.isArray(item)) item.forEach(child => { if (child && typeof child === 'object' && 'kind' in child) pixelUse(child as CodeExpression) })
      else if (item && typeof item === 'object' && 'kind' in item) pixelUse(item as CodeExpression)
    }
    if (value.kind === 'object') Object.values(value.properties).forEach(pixelUse)
  }
  pixelUse(program.result)
  const declarations: string[] = []
  for (const binding of program.bindings) { const value = pixelBindings.has(bindings.length) ? emit(binding.expression) : { code: '', bounds: null, text: '' }; if (!value.items && !value.fields && value.text === undefined) declarations.push(`let b${bindings.length} = ${value.code};`); bindings.push(value) }
  const result = emit(program.result)
  if (colors(result).some(channel => channel.min < -1e-5 || channel.max > 1 + 1e-5)) throw new CodeMaterialError('PARAMETERS', '滤镜输出必须始终位于0到1；请在可能越界的颜色通道显式使用clamp。')
  return `
struct Params { context0:vec4f, context1:vec3f, seed:u32, parameters:array<vec4f,${CODE_FILTER_PARAMETER_SLOTS}>, flags:vec4f }
@group(0) @binding(0) var inputTexture: texture_2d<f32>;
@group(0) @binding(1) var inputSampler: sampler;
@group(0) @binding(2) var<uniform> p: Params;
${passes.map((_, i) => `@group(0) @binding(${3 + i}) var codeBlur${i}:texture_2d<f32>;`).join('\n')}
${shaders.map((_, i) => `@group(0) @binding(${3 + passes.length + i}) var codeShader${i}:texture_2d<f32>;`).join('\n')}
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
${program.languageVersion === 3 ? CODE_V3_FILTER_HELPERS : ''}
@fragment fn fs(v:Vertex)->@location(0) vec4f {
 let uv = v.position.xy/vec2f(p.context0.w,p.context1.x);
 ${declarations.join('\n')}
 let color = clamp(${result.code},vec4f(0),vec4f(1));
 return vec4f(color.rgb*color.a,color.a);
}`
}
