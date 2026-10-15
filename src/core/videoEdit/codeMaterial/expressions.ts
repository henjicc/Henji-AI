import { CODE_V3_LIMITS, CodeMaterialError, finiteCodeNumber } from './contract'
import type { CodeMathBuiltin } from './contract'

/** Weighted work units shared by static expansion and the frame evaluator. */
export const CODE_MATH_COSTS: Record<CodeMathBuiltin, number> = {
  sqrt: 8, pow: 24, exp: 16, log: 16, log2: 16, tan: 24, asin: 24, acos: 24, atan: 24, atan2: 24,
  hypot: 24, sign: 1, fract: 2, mod: 5, trunc: 1, lerp: 3, invLerp: 3, remap: 6, step: 1,
  degrees: 1, radians: 1, length: 24, distance: 28, normalize: 28,
}
export const CODE_EXPRESSION_SIGNATURES: Record<string, string[]> = {
  sin: ['radians'], cos: ['radians'], abs: ['x'], floor: ['x'], ceil: ['x'], round: ['x'], min: ['a', 'b'], max: ['a', 'b'],
  clamp: ['value', 'min', 'max'], mix: ['a', 'b', 't'], smoothstep: ['edge0', 'edge1', 'x'], random: ['index'], rgba: ['r', 'g', 'b', 'a'], sample: ['u', 'v'],
  sampleGradient: ['gradient', 't'], sampleCurve: ['curve', 't'], ease: ['easing', 't'], linearGradient: ['options'], radialGradient: ['options'], measureText: ['options'], chars: ['text'], words: ['text'],
  progress: ['time', 'start', 'duration'], tween: ['time', 'start', 'duration', 'from', 'to', 'easing'], stagger: ['index', 'delay'], keyframes: ['time', 'frames'], cubicBezier: ['x1', 'y1', 'x2', 'y2', 't'], noise: ['x', 'y?', 'z?'],
  sampleOffset: ['x', 'y'], blur: ['radius'], glow: ['threshold', 'radius', 'intensity'], luma: ['color'], contrast: ['color', 'amount'], saturate: ['color', 'amount'], hsv: ['h', 's', 'v', 'alpha?'], hsl: ['h', 's', 'l', 'alpha?'], toHsv: ['color'], toHsl: ['color'], average: ['colors'], backOut: ['t', 'overshoot?'],
  sqrt: ['x'], pow: ['base', 'exponent'], exp: ['x'], log: ['x'], log2: ['x'], tan: ['radians'], asin: ['x'], acos: ['x'], atan: ['x'], atan2: ['y', 'x'],
  hypot: ['x', 'y', 'z?', 'w?'], sign: ['x'], fract: ['x'], mod: ['value', 'divisor'], trunc: ['x'], lerp: ['a', 'b', 't'], invLerp: ['a', 'b', 'value'], remap: ['value', 'a', 'b', 'c', 'd'], step: ['edge', 'x'],
  degrees: ['radians'], radians: ['degrees'], length: ['vector'], distance: ['a', 'b'], normalize: ['vector'],
  formatNumber: ['n', 'options?'], formatTime: ['seconds', 'format'],
}
export function codeMathVector(value: unknown, label: string): number[] {
  if (!Array.isArray(value) || value.length < 2 || value.length > 4) throw new CodeMaterialError('TYPE', `${label} 需要 2–4 维数值数组。`)
  return value.map(item => finiteCodeNumber(item, label))
}
export function evaluateCodeMath(op: CodeMathBuiltin, args: unknown[]): number | number[] {
  const n = (index: number): number => finiteCodeNumber(args[index], `${op} 参数 ${index + 1}`)
  const vector = (index: number): number[] => codeMathVector(args[index], op)
  let result: number
  switch (op) {
    case 'length': result = Math.hypot(...vector(0)); break
    case 'distance': {
      const a = vector(0); const b = vector(1)
      if (a.length !== b.length) throw new CodeMaterialError('TYPE', 'distance 两个向量的维数必须相同。')
      result = Math.hypot(...a.map((value, i) => value - b[i])); break
    }
    case 'normalize': {
      const value = vector(0); const magnitude = finiteCodeNumber(Math.hypot(...value), 'normalize 长度')
      return value.map(item => magnitude === 0 ? 0 : item / magnitude)
    }
    case 'sqrt': result = Math.sqrt(n(0)); break
    case 'pow': result = Math.pow(n(0), n(1)); break
    case 'exp': result = Math.exp(n(0)); break
    case 'log': result = Math.log(n(0)); break
    case 'log2': result = Math.log2(n(0)); break
    case 'tan': result = Math.tan(n(0)); break
    case 'asin': result = Math.asin(n(0)); break
    case 'acos': result = Math.acos(n(0)); break
    case 'atan': result = Math.atan(n(0)); break
    case 'atan2': result = Math.atan2(n(0), n(1)); break
    case 'hypot': result = Math.hypot(...args.map((_, i) => n(i))); break
    case 'sign': result = Math.sign(n(0)); break
    case 'fract': result = n(0) - Math.floor(n(0)); break
    case 'mod': { const remainder = n(0) % n(1); result = remainder === 0 ? (n(1) < 0 ? -0 : 0) : Math.sign(remainder) === Math.sign(n(1)) ? remainder : remainder + n(1); break }
    case 'trunc': result = Math.trunc(n(0)); break
    case 'lerp': result = n(0) + (n(1) - n(0)) * n(2); break
    case 'invLerp': result = (n(2) - n(0)) / (n(1) - n(0)); break
    case 'remap': result = n(3) + (n(0) - n(1)) / (n(2) - n(1)) * (n(4) - n(3)); break
    case 'step': result = n(1) < n(0) ? 0 : 1; break
    case 'degrees': result = n(0) * (180 / Math.PI); break
    case 'radians': result = n(0) * (Math.PI / 180); break
  }
  return finiteCodeNumber(result, `${op} 结果`)
}

export function codeString(value: string): string {
  if (value.length > CODE_V3_LIMITS.textCharacters) throw new CodeMaterialError('BUDGET', `字符串长度 ${value.length} 超过文字字符预算 ${CODE_V3_LIMITS.textCharacters}（超出 ${value.length - CODE_V3_LIMITS.textCharacters}）。`)
  return value
}
export function formatCodeNumber(value: unknown, options: unknown = {}): string {
  const n = finiteCodeNumber(value, 'formatNumber.n')
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new CodeMaterialError('TYPE', 'formatNumber(n, {decimals?, pad?, thousands?, sign?}) 需要格式对象。')
  const fields = options as Record<string, unknown>
  for (const key of Object.keys(fields)) if (!['decimals', 'pad', 'thousands', 'sign'].includes(key)) throw new CodeMaterialError('TYPE', `formatNumber 未知字段 ${key}；可用字段：decimals、pad、thousands、sign。`)
  const integer = (key: string, fallback: number, max: number): number => {
    const result = finiteCodeNumber(fields[key] ?? fallback, `formatNumber.${key}`)
    if (!Number.isInteger(result) || result < 0 || result > max) throw new CodeMaterialError('TYPE', `formatNumber.${key} 必须是 0–${max} 的整数。`)
    return result
  }
  const decimals = fields.decimals === undefined ? undefined : integer('decimals', 0, 20)
  const pad = integer('pad', 0, CODE_V3_LIMITS.textCharacters)
  if (fields.thousands !== undefined && typeof fields.thousands !== 'boolean') throw new CodeMaterialError('TYPE', 'formatNumber.thousands 必须是布尔值。')
  const sign = fields.sign ?? 'auto'
  if (!['auto', 'always', 'never', 'exceptZero'].includes(String(sign))) throw new CodeMaterialError('TYPE', 'formatNumber.sign 可用值：auto、always、never、exceptZero。')
  // Explicit decimal expansion keeps output independent of locale and ICU data.
  const raw = decimals === undefined ? String(Math.abs(n)) : Math.abs(n).toFixed(decimals)
  const [mantissa, exponent] = raw.toLowerCase().split('e')
  let [whole, fraction = ''] = mantissa.split('.')
  if (exponent !== undefined) {
    const digits = whole + fraction; const position = whole.length + Number(exponent)
    whole = position <= 0 ? '0' : digits.slice(0, position).padEnd(position, '0')
    fraction = position <= 0 ? '0'.repeat(-position) + digits : digits.slice(position)
  }
  if (decimals !== undefined) fraction = fraction.padEnd(decimals, '0')
  whole = whole.padStart(pad, '0')
  if (fields.thousands) whole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const zero = Number(whole.replaceAll(',', '') + '.' + fraction) === 0
  const prefix = sign === 'never' || sign === 'exceptZero' && zero ? '' : n < 0 ? '-' : sign === 'always' || sign === 'exceptZero' ? '+' : ''
  return codeString(prefix + whole + (fraction ? '.' + fraction : ''))
}
export function formatCodeTime(value: unknown, format: unknown): string {
  const seconds = finiteCodeNumber(value, 'formatTime.seconds')
  if (!['mm:ss', 'hh:mm:ss', 'ss.ff'].includes(String(format))) throw new CodeMaterialError('TYPE', 'formatTime(seconds, format) 可用格式：mm:ss、hh:mm:ss、ss.ff。')
  const absolute = Math.abs(seconds)
  if (absolute > Number.MAX_SAFE_INTEGER / 100) throw new CodeMaterialError('BUDGET', 'formatTime.seconds 超过可精确表示的时间范围。')
  const whole = Math.floor(absolute); const two = (n: number): string => String(n).padStart(2, '0')
  const body = format === 'ss.ff' ? `${two(whole)}.${(formatCodeNumber(absolute).split('.')[1] ?? '').padEnd(2, '0').slice(0, 2)}` : format === 'mm:ss' ? `${two(Math.floor(whole / 60))}:${two(whole % 60)}` : `${two(Math.floor(whole / 3600))}:${two(Math.floor(whole / 60) % 60)}:${two(whole % 60)}`
  return (seconds < 0 ? '-' : '') + body
}
export function codeStringPart(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number') return formatCodeNumber(value)
  if (typeof value === 'boolean') return String(value)
  throw new CodeMaterialError('TYPE', '字符串插值只接受字符串、数字或布尔值。')
}
