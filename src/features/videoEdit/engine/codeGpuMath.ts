import { CodeMaterialError } from '@/core/videoEdit/codeMaterial/contract'
import type { CodeMathBuiltin } from '@/core/videoEdit/codeMaterial/contract'
import type { Range, Value } from './codeGpuFilter'

interface Proof {
  range(min: number, max?: number, integer?: boolean): Range
  scalar(value: Value): Range
  multiply(a: Range, b: Range): Range
  divide(a: Range, b: Range): Range
  operationRange(min: number, max: number): Range
}
/** WGSL numeric builtins, with the same finite-domain checks as the scalar emitter.
 * https://www.w3.org/TR/WGSL/#numeric-builtin-functions
 */
export function emitCodeMath(op: CodeMathBuiltin, args: Value[], proof: Proof): Value {
  const { range, scalar, multiply, divide, operationRange } = proof
  const codes = args.map(value => value.code)
  const a = (): Range => scalar(args[0]); const b = (): Range => scalar(args[1])
  const subtract = (a: Range, b: Range): Range => operationRange(a.min - b.max, a.max - b.min)
  const requireDomain = (condition: boolean, reason: string): void => { if (!condition) throw new CodeMaterialError('NON_FINITE', `${op}：${reason}。`) }
  const result = (code: string, bounds: Range): Value => ({ code, bounds })
  const vector = (value: Value): { code: string; bounds: Range[] } => {
    const bounds = value.items?.map(scalar) ?? (Array.isArray(value.bounds) ? value.bounds : undefined)
    if (!bounds || bounds.length < 2 || bounds.length > 4) throw new CodeMaterialError('TYPE', `${op} 需要 2–4 维数值数组。`)
    return { code: value.items ? `vec${bounds.length}f(${value.items.map(item => item.code).join(',')})` : value.code, bounds }
  }
  const magnitude = (bounds: Range[]): Range => {
    if (bounds.every(value => value.min === 0 && value.max === 0)) return range(0)
    const lo = Math.hypot(...bounds.map(x => x.min <= 0 && x.max >= 0 ? 0 : Math.min(Math.abs(x.min), Math.abs(x.max))))
    const hi = Math.hypot(...bounds.map(x => Math.max(Math.abs(x.min), Math.abs(x.max))))
    const expanded = operationRange(lo, hi)
    return range(Math.max(0, expanded.min), expanded.max, false)
  }
  if (['length', 'distance', 'normalize', 'hypot'].includes(op)) {
    const left = op === 'hypot' ? vector({ code: '', bounds: null, items: args }) : vector(args[0])
    if (op === 'normalize') {
      const length = magnitude(left.bounds)
      requireDomain(length.min > 1e-12 || length.max === 0, '逐像素向量长度必须可证明为零或大于 1e-12；帧级 normalize 支持任意零向量')
      const code = length.max === 0 ? `vec${left.bounds.length}f(0.0)` : `normalize(${left.code})`
      const bounds = left.bounds.map(() => range(-1.00001, 1.00001, false))
      return { code, bounds, ...(left.bounds.length === 4 ? {} : { items: bounds.map((bound, i) => ({ code: `(${code})[${i}]`, bounds: bound })) }) }
    }
    if (op === 'distance') {
      const right = vector(args[1]); if (left.bounds.length !== right.bounds.length) throw new CodeMaterialError('TYPE', 'distance 两个向量的维数必须相同。')
      return result(`distance(${left.code},${right.code})`, magnitude(left.bounds.map((x, i) => subtract(x, right.bounds[i]))))
    }
    return result(`length(${left.code})`, magnitude(left.bounds))
  }
  if (op === 'lerp' || op === 'invLerp' || op === 'remap') {
    if (op === 'invLerp') return result(`((${codes[2]}-${codes[0]})/(${codes[1]}-${codes[0]}))`, divide(subtract(scalar(args[2]), a()), subtract(b(), a())))
    const left = op === 'remap' ? scalar(args[3]) : a(); const right = op === 'remap' ? scalar(args[4]) : b()
    const amount = op === 'remap' ? divide(subtract(a(), b()), subtract(scalar(args[2]), b())) : scalar(args[2])
    const product = multiply(subtract(right, left), amount)
    return result(op === 'remap' ? `(${codes[3]}+((${codes[0]}-${codes[1]})/(${codes[2]}-${codes[1]}))*(${codes[4]}-${codes[3]}))` : `codeMix(${codes.join(',')})`, operationRange(left.min + product.min, left.max + product.max))
  }
  if (op === 'pow') {
    const base = a(); const exponent = b(); const integer = exponent.min === exponent.max && Number.isInteger(exponent.min)
    requireDomain(base.min > 0 || base.min === 0 && exponent.min > 0 || integer && (exponent.min >= 0 || base.min > 0 || base.max < 0), '底数与指数可能产生非有限结果')
    const values = [base.min ** exponent.min, base.min ** exponent.max, base.max ** exponent.min, base.max ** exponent.max]
    if (base.min <= 0 && base.max >= 0 && exponent.min > 0) values.push(0)
    if (exponent.min <= 0 && exponent.max >= 0) values.push(1)
    const output = integer && exponent.min === 0 ? '1.0' : integer && base.min < 0 ? `(pow(abs(${codes[0]}),${codes[1]})${Math.abs(exponent.min % 2) === 1 ? `*sign(${codes[0]})` : ''})` : `pow(${codes.join(',')})`
    return result(output, operationRange(Math.min(...values), Math.max(...values)))
  }
  if (op === 'mod') {
    divide(a(), b())
    return result(`codeMod(${codes.join(',')})`, range(Math.min(0, b().min), Math.max(0, b().max), false))
  }
  if (op === 'atan2') {
    requireDomain(!(a().min <= 0 && a().max >= 0 && b().min <= 0 && b().max >= 0), '逐像素输入不能同时为零')
    return result(`atan2(${codes.join(',')})`, range(-Math.PI - .00001, Math.PI + .00001, false))
  }
  if (op === 'step') { a(); b(); return result(`step(${codes.join(',')})`, range(0, 1, false)) }
  if (op === 'sign') return result(`sign(${codes[0]})`, range(Math.sign(a().min), Math.sign(a().max), true))
  if (op === 'fract') { a(); return result(`fract(${codes[0]})`, range(0, 1, false)) }
  if (op === 'trunc') return result(`trunc(${codes[0]})`, range(Math.trunc(a().min), Math.trunc(a().max), true))
  if (op === 'degrees' || op === 'radians') {
    const factor = op === 'degrees' ? 180 / Math.PI : Math.PI / 180
    return result(`${op}(${codes[0]})`, multiply(a(), range(factor)))
  }
  if (op === 'sqrt') requireDomain(a().min >= 0, '输入必须非负')
  if (op === 'log' || op === 'log2') requireDomain(a().min > 0, '输入必须为正')
  if (op === 'asin' || op === 'acos') requireDomain(a().min >= -1 && a().max <= 1, '输入必须位于 -1 到 1')
  if (op === 'tan') requireDomain(a().min > -Math.PI / 2 && a().max < Math.PI / 2, '输入范围不能跨越正切极点，须位于负π/2 到 π/2 内')
  const unary: Partial<Record<CodeMathBuiltin, (x: number) => number>> = { sqrt: Math.sqrt, exp: Math.exp, log: Math.log, log2: Math.log2, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan }
  const fn = unary[op]
  if (!fn) throw new CodeMaterialError('TYPE', `未知数学函数 ${op}。`)
  const x = fn(a().min); const y = fn(a().max)
  // Numeric builtin approximation has a larger error allowance than one arithmetic op.
  const error = Math.max(1, Math.abs(x), Math.abs(y)) * 1e-5
  const bounds = operationRange(Math.min(x, y) - error, Math.max(x, y) + error)
  return result(`${op}(${codes[0]})`, ['sqrt', 'exp'].includes(op) ? range(Math.max(0, bounds.min), bounds.max, false) : bounds)
}
