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
type MathOperation = (args: unknown[]) => number | number[]
function scalarMath(op: CodeMathBuiltin, calculate: (n: (index: number) => number, args: unknown[]) => number): MathOperation {
  return args => finiteCodeNumber(calculate(index => finiteCodeNumber(args[index], `${op} 参数 ${index + 1}`), args), `${op} 结果`)
}
const codeMathOperations: Record<CodeMathBuiltin, MathOperation> = {
  length: args => finiteCodeNumber(Math.hypot(...codeMathVector(args[0], 'length')), 'length 结果'),
  distance: args => {
    const a = codeMathVector(args[0], 'distance'); const b = codeMathVector(args[1], 'distance')
    if (a.length !== b.length) throw new CodeMaterialError('TYPE', 'distance 两个向量的维数必须相同。')
    return finiteCodeNumber(Math.hypot(...a.map((value, i) => value - b[i])), 'distance 结果')
  },
  normalize: args => {
    const value = codeMathVector(args[0], 'normalize'); const magnitude = finiteCodeNumber(Math.hypot(...value), 'normalize 长度')
    return value.map(item => magnitude === 0 ? 0 : item / magnitude)
  },
  sqrt: scalarMath('sqrt', n => Math.sqrt(n(0))),
  pow: scalarMath('pow', n => Math.pow(n(0), n(1))),
  exp: scalarMath('exp', n => Math.exp(n(0))),
  log: scalarMath('log', n => Math.log(n(0))),
  log2: scalarMath('log2', n => Math.log2(n(0))),
  tan: scalarMath('tan', n => Math.tan(n(0))),
  asin: scalarMath('asin', n => Math.asin(n(0))),
  acos: scalarMath('acos', n => Math.acos(n(0))),
  atan: scalarMath('atan', n => Math.atan(n(0))),
  atan2: scalarMath('atan2', n => Math.atan2(n(0), n(1))),
  hypot: scalarMath('hypot', (n, args) => Math.hypot(...args.map((_, i) => n(i)))),
  sign: scalarMath('sign', n => Math.sign(n(0))),
  fract: scalarMath('fract', n => n(0) - Math.floor(n(0))),
  mod: scalarMath('mod', n => {
    const remainder = n(0) % n(1)
    return remainder === 0 ? (n(1) < 0 ? -0 : 0) : Math.sign(remainder) === Math.sign(n(1)) ? remainder : remainder + n(1)
  }),
  trunc: scalarMath('trunc', n => Math.trunc(n(0))),
  lerp: scalarMath('lerp', n => n(0) + (n(1) - n(0)) * n(2)),
  invLerp: scalarMath('invLerp', n => (n(2) - n(0)) / (n(1) - n(0))),
  remap: scalarMath('remap', n => n(3) + (n(0) - n(1)) / (n(2) - n(1)) * (n(4) - n(3))),
  step: scalarMath('step', n => n(1) < n(0) ? 0 : 1),
  degrees: scalarMath('degrees', n => n(0) * (180 / Math.PI)),
  radians: scalarMath('radians', n => n(0) * (Math.PI / 180)),
}
/** Prebind the closed math operation once when compiling an expression. */
export function codeMathOperation(op: CodeMathBuiltin): (args: unknown[]) => number | number[] { return codeMathOperations[op] }
export function evaluateCodeMath(op: CodeMathBuiltin, args: unknown[]): number | number[] { return codeMathOperations[op](args) }

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
