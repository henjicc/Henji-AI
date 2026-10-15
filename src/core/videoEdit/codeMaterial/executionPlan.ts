import { sampleAudioContent } from '../../audioAnalysis/contentAnalysis'
import { CODE_V3_LIMITS, CODE_BLEND_NAMES, codeBinaryCost, codeBuiltinCost, CodeMaterialError, codeColor as validateColor, codeImageReference, finiteCodeNumber } from './contract'
import type { CodeColor, CodeDrawCommand, CodeDrawMetadata, CodeExpression, CodeGradient, CodeMaterialContext, CodeMaterialProgram, CodePaint, CodeTextMeasureRequest } from './contract'
import { codeNumericPlan } from './numericPlan'
import { memoizeCodeExecution, type CodeExecutionFrame, type CodeExecutionPlan } from './executionCache'
import { CODE_EASE_NAMES, codeCubicBezier, codeEase, codeNoise, codeProgress } from './motion'
import { CODE_MATH_COSTS, codeString, codeStringPart, codeMathOperation, formatCodeNumber, formatCodeTime } from './expressions'
import { parseCodePath } from './geometry'
import { codeShaderGraph, codeShaderTime } from './shaders'
import { CODE_PARAMETER_FUNCTION_COSTS, easeCodeParameter, sampleCodeCurve, sampleCodeGradient } from './parameterSampling'


const codeColor = (value: unknown, label: string): CodeColor => validateColor(value, label, true)
const n = (value: unknown): number => finiteCodeNumber(value, '表达式结果')
const array = (value: unknown): unknown[] => { if (!Array.isArray(value)) throw new CodeMaterialError('TYPE', '需要数组。'); return value }
const object = (value: unknown): Record<string, unknown> => { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CodeMaterialError('TYPE', '需要字段对象。'); return value as Record<string, unknown> }
const string = (value: unknown): string => { if (typeof value !== 'string') throw new CodeMaterialError('TYPE', '需要字符串。'); return value }
const channels = (value: unknown): CodeColor => { const values = array(value); if (values.length !== 4) throw new CodeMaterialError('TYPE', '颜色需要四个通道。'); return values.map(n) as CodeColor }
const literalColors = new WeakMap<CodeExpression, CodeColor>()
const bounded = (value: unknown, min: number, max: number, label: string): number => { const result = finiteCodeNumber(value, label); if (result < min || result > max) throw new CodeMaterialError('BUDGET', `${label} 超出技术范围 ${min}–${max}。`); return result }
const saturated = (value: unknown, min: number, max: number, label: string): number => Math.min(max, Math.max(min, finiteCodeNumber(value, label)))
function keys(fields: Record<string, unknown>, allowed: string[]): void { for (const key of Object.keys(fields)) if (!allowed.includes(key)) throw new CodeMaterialError('TYPE', `未知字段：${key}；可用字段：${allowed.join('、')}。`) }
function paint(value: unknown): CodePaint {
  if (Array.isArray(value)) return codeColor(value, '颜色')
  const fields = object(value)
  if (!['linearGradient', 'radialGradient', 'conicGradient'].includes(string(fields.kind))) throw new CodeMaterialError('TYPE', '需要颜色或渐变。')
  return value as CodeGradient
}
export function codeTextRequest(fields: Record<string, unknown>): CodeTextMeasureRequest {
  const fontFamily = string(fields.fontFamily ?? 'sans-serif')
  if (!fontFamily.length || fontFamily.length > 200 || /[\r\n;{}]/.test(fontFamily)) throw new CodeMaterialError('TYPE', '字体名称无效。')
  const fontStyle = string(fields.fontStyle ?? 'normal')
  if (!['normal', 'italic', 'oblique'].includes(fontStyle)) throw new CodeMaterialError('TYPE', 'fontStyle 必须为 normal/italic/oblique。')
  const maxLines = bounded(fields.maxLines ?? 0, 0, 4096, 'maxLines')
  if (!Number.isInteger(maxLines)) throw new CodeMaterialError('TYPE', 'maxLines 必须是整数。')
  if (fields.wrap !== undefined && typeof fields.wrap !== 'boolean') throw new CodeMaterialError('TYPE', 'wrap 必须是布尔值。')
  return { text: string(fields.text), fontFamily, fontWeight: bounded(fields.fontWeight ?? 400, 1, 1000, 'fontWeight'), fontStyle, fontSize: bounded(fields.fontSize ?? 48, 1, 1024, 'fontSize'), letterSpacing: bounded(fields.letterSpacing ?? 0, -1024, 1024, 'letterSpacing'), lineHeight: bounded(fields.lineHeight ?? 1.2, .1, 10, 'lineHeight'), maxWidth: bounded(fields.maxWidth ?? 0, 0, 8192, 'maxWidth'), wrap: fields.wrap === true || fields.wrap === undefined && !!fields.maxWidth, maxLines }
}
function metadata(fields: Record<string, unknown>): CodeDrawMetadata {
  const value: CodeDrawMetadata = { opacity: saturated(fields.opacity ?? 1, 0, 1, 'opacity'), rotation: bounded(fields.rotation ?? 0, -32768, 32768, 'rotation'), scaleX: bounded(fields.scaleX ?? fields.scale ?? 1, -1024, 1024, 'scaleX'), scaleY: bounded(fields.scaleY ?? fields.scale ?? 1, -1024, 1024, 'scaleY'), anchorX: bounded(fields.anchorX ?? 0, -32768, 32768, 'anchorX'), anchorY: bounded(fields.anchorY ?? 0, -32768, 32768, 'anchorY') }
  if (fields.skewX !== undefined) value.skewX = bounded(fields.skewX, -89.9, 89.9, 'skewX')
  if (fields.skewY !== undefined) value.skewY = bounded(fields.skewY, -89.9, 89.9, 'skewY')
  value.authorAnchor = fields.anchorX !== undefined || fields.anchorY !== undefined
  if (fields.blend !== undefined) { const blend = string(fields.blend); if (!(CODE_BLEND_NAMES as readonly string[]).includes(blend)) throw new CodeMaterialError('TYPE', `未知 blend ${blend}；可用值：${CODE_BLEND_NAMES.join('、')}。`); value.blend = blend as CodeDrawMetadata['blend'] }
  if (fields.fill !== undefined) value.paint = paint(fields.fill)
  if (fields.stroke !== undefined) value.stroke = paint(fields.stroke)
  if (fields.strokeWidth !== undefined) value.strokeWidth = bounded(fields.strokeWidth, 0, 1024, 'strokeWidth')
  if (fields.lineCap !== undefined) { const cap = string(fields.lineCap); if (!['round', 'butt', 'square'].includes(cap)) throw new CodeMaterialError('TYPE', `未知 lineCap ${cap}；可用值：butt、round、square。`); value.lineCap = cap as CodeDrawMetadata['lineCap'] }
  if (fields.lineJoin !== undefined) { const join = string(fields.lineJoin); if (!['miter', 'round', 'bevel'].includes(join)) throw new CodeMaterialError('TYPE', `未知 lineJoin ${join}；可用值：miter、round、bevel。`); value.lineJoin = join as CodeDrawMetadata['lineJoin'] }
  if (fields.dash !== undefined) { value.dash = array(fields.dash).map(item => bounded(item, 0, 32768, 'dash')); if (value.dash.length > 32 || value.dash.length && value.dash.every(item => item === 0)) throw new CodeMaterialError('BUDGET', 'dash 须为 0–32 项且非全零。') }
  if (fields.trimStart !== undefined) value.trimStart = saturated(fields.trimStart, 0, 1, 'trimStart')
  if (fields.trimEnd !== undefined) value.trimEnd = saturated(fields.trimEnd, value.trimStart ?? 0, 1, 'trimEnd')
  if (fields.blur !== undefined) value.blur = bounded(fields.blur, 0, 256, 'blur')
  if (fields.shadow !== undefined) {
    const shadow = object(fields.shadow); keys(shadow, ['x', 'y', 'blur', 'color'])
    value.shadow = { x: bounded(shadow.x ?? 0, -1024, 1024, 'shadow.x'), y: bounded(shadow.y ?? 0, -1024, 1024, 'shadow.y'), blur: bounded(shadow.blur ?? 0, 0, 256, 'shadow.blur'), color: codeColor(shadow.color, 'shadow.color') }
  }
  if (fields.glow !== undefined) {
    const glow = object(fields.glow); keys(glow, ['radius', 'intensity', 'color'])
    value.glow = { radius: bounded(glow.radius ?? 16, 0, 256, 'glow.radius'), intensity: bounded(glow.intensity ?? 1, 0, 16, 'glow.intensity'), color: codeColor(glow.color ?? [1, 1, 1, 1], 'glow.color') }
  }
  return value
}
function rgbaFromHsv(h: number, s: number, v: number, alpha: number): CodeColor {
  const hue = ((h % 1) + 1) % 1 * 6; const c = v * s; const x = c * (1 - Math.abs(hue % 2 - 1)); const m = v - c
  const rgb = hue < 1 ? [c, x, 0] : hue < 2 ? [x, c, 0] : hue < 3 ? [0, c, x] : hue < 4 ? [0, x, c] : hue < 5 ? [x, 0, c] : [c, 0, x]
  return codeColor([...rgb.map(channel => channel + m), alpha], 'HSV 结果')
}

const mix = (a: unknown, b: unknown, t: number): number | CodeColor => {
  if (!Array.isArray(a)) return n(n(a) + (n(b) - n(a)) * t)
  const left = channels(a); const right = channels(b)
  return channels([left[0] + (right[0] - left[0]) * t, left[1] + (right[1] - left[1]) * t, left[2] + (right[2] - left[2]) * t, left[3] + (right[3] - left[3]) * t])
}
type Run = CodeExecutionPlan['run']
type Compile = (expression: CodeExpression) => CodeExecutionPlan

/** Only validated IR enters here. Operators and children are bound once; no author
 * source is emitted or executed. The WeakMap follows the loaded program lifetime. */
const programs = new WeakMap<CodeMaterialProgram, Compile>()
export function codeExecutionCompiler(program: CodeMaterialProgram): Compile {
  const existing = programs.get(program)
  if (existing) return existing
  const plans = new WeakMap<CodeExpression, CodeExecutionPlan>()
  let nextCacheSlot = 0
  const compile: Compile = expression => {
    const existing = plans.get(expression)
    if (existing) { existing.uses++; return existing }
    const children: CodeExecutionPlan[] = []
    const child = (value: CodeExpression): Run => { const plan = compile(value); children.push(plan); return plan.run }
    const numeric = codeNumericPlan(expression)
    let body: Run
    if (expression.kind === 'literal') {
      const value = expression.value
      body = frame => { frame.charge(); return value }
    } else if (numeric) {
      body = (frame, depth) => {
        if (depth + numeric.height > CODE_V3_LIMITS.depth) throw new CodeMaterialError('BUDGET', 'IR 深度超出 64。')
        frame.charge(numeric.cost); return numeric.run(frame)
      }
    } else {
      const node = compileNode(expression, child, program)
      body = (frame, depth) => {
        if (!frame.prepaid) {
          frame.charge()
          if (depth > CODE_V3_LIMITS.depth) throw new CodeMaterialError('BUDGET', 'IR 深度超出 64。')
        }
        return node(frame, depth)
      }
    }
    const measured = expression.sourceSpan && ['draw', 'repeat', 'v3call', 'call', 'binary'].includes(expression.kind)
    const span = expression.sourceSpan
    const profileKey = span ? `${span.file}:${span.start}:${expression.kind}` : ''
    const profileKind = expression.kind === 'draw' ? expression.shape : expression.kind === 'v3call' || expression.kind === 'call' ? expression.op : expression.kind
    const guarded: Run = !span ? body : (frame, depth) => {
      try { return body(frame, depth) } catch (error) {
        if (error instanceof CodeMaterialError && !error.sourceSpan) throw new CodeMaterialError(error.code, error.message, span)
        throw error
      }
    }
    const run: Run = !measured || !span ? guarded : (frame, depth) => {
      if (!frame.profile) return guarded(frame, depth)
      const started = performance.now()
      try { return guarded(frame, depth) } finally {
        const entry = frame.profile.get(profileKey) ?? { kind: profileKind, cpuMs: 0, sourceSpan: span }
        entry.cpuMs += performance.now() - started; frame.profile.set(profileKey, entry)
      }
    }
    const plan = memoizeCodeExecution(expression, children, numeric, run, () => nextCacheSlot++)
    plans.set(expression, plan)
    return plan
  }
  programs.set(program, compile)
  program.bindings.forEach(binding => compile(binding.expression))
  compile(program.result)
  return compile
}

function compileNode(expression: CodeExpression, child: (value: CodeExpression) => Run, program: CodeMaterialProgram): Run {
  switch (expression.kind) {
    case 'literal': return () => expression.value
    case 'context': {
      const key = expression.key
      if (key === 'u' || key === 'v') return () => { throw new CodeMaterialError('TYPE', 'CPU 生成器不能读像素坐标。') }
      return frame => frame.context[key as keyof CodeMaterialContext]
    }
    case 'parameter': { const key = expression.key; return frame => frame.parameters[key] }
    case 'binding': {
      const slot = expression.slot
      if (slot < 0 || slot >= program.bindings.length) return () => { throw new CodeMaterialError('TYPE', '无效 const 绑定。') }
      const value = child(program.bindings[slot].expression)
      return (frame, depth) => { if (!(slot in frame.bindings)) frame.bindings[slot] = value(frame, depth + 1); return frame.bindings[slot] }
    }
    case 'local': {
      const slot = expression.slot
      return frame => { if (!frame.locals.has(slot)) throw new CodeMaterialError('TYPE', '无效 repeat/字符索引。'); return frame.locals.get(slot) }
    }
    case 'color': {
      const values = expression.values.map(child)
      const literal = expression.values.every(value => value.kind === 'literal')
      return (frame, depth) => {
        const cached = literalColors.get(expression); if (cached) return cached
        if (values.length !== 4) throw new CodeMaterialError('TYPE', '四通道表需要四个数值。')
        const color = values.map(value => n(value(frame, depth + 1))) as CodeColor
        if (literal) literalColors.set(expression, color)
        return color
      }
    }
    case 'array': { const values = expression.values.map(child); return (frame, depth) => values.map(value => value(frame, depth + 1)) }
    case 'object': {
      const names = Object.keys(expression.properties); const values = names.map(key => child(expression.properties[key]))
      return (frame, depth) => {
        const result: Record<string, unknown> = {}
        for (let i = 0; i < names.length; i++) result[names[i]] = values[i](frame, depth + 1)
        return result
      }
    }
    case 'component': { const value = child(expression.value); const index = expression.index; return (frame, depth) => channels(value(frame, depth + 1))[index] }
    case 'field': {
      const value = child(expression.value); const key = expression.key
      return (frame, depth) => { const result = value(frame, depth + 1); return key === 'length' && (Array.isArray(result) || typeof result === 'string') ? result.length : object(result)[key] }
    }
    case 'index': {
      const value = child(expression.value); const index = child(expression.index)
      return (frame, depth) => {
        const result = value(frame, depth + 1); const at = n(index(frame, depth + 1)); const table = typeof result === 'string' ? Array.from(result) : array(result)
        if (!Number.isInteger(at) || at < 0 || at >= table.length) throw new CodeMaterialError('TYPE', '数组索引越界或不是整数。')
        return table[at]
      }
    }
    case 'unary': {
      const value = child(expression.value)
      if (expression.op === '!') return (frame, depth) => { const result = value(frame, depth + 1); if (typeof result !== 'boolean') throw new CodeMaterialError('TYPE', '需要布尔值。'); return !result }
      return expression.op === '-' ? (frame, depth) => -n(value(frame, depth + 1)) : (frame, depth) => n(value(frame, depth + 1))
    }
    case 'binary': {
      const left = child(expression.left); const right = child(expression.right)
      const cost = codeBinaryCost(expression.op) - 1
      if (expression.op === '&&') return (frame, depth) => { frame.charge(cost); const a = left(frame, depth + 1); if (typeof a !== 'boolean') throw new CodeMaterialError('TYPE', '需要布尔值。'); return a && right(frame, depth + 1) }
      if (expression.op === '||') return (frame, depth) => { frame.charge(cost); const a = left(frame, depth + 1); if (typeof a !== 'boolean') throw new CodeMaterialError('TYPE', '需要布尔值。'); return a || right(frame, depth + 1) }
      const operation = binaryOperation(expression.op)
      return (frame, depth) => { frame.charge(cost); return operation(left(frame, depth + 1), right(frame, depth + 1), frame) }
    }
    case 'conditional': {
      const condition = child(expression.condition); const yes = child(expression.yes); const no = child(expression.no)
      return (frame, depth) => { const result = condition(frame, depth + 1); if (typeof result !== 'boolean') throw new CodeMaterialError('TYPE', '条件需要布尔值。'); return (result ? yes : no)(frame, depth + 1) }
    }
    case 'repeat': {
      const count = child(expression.count); const body = child(expression.body); const slot = expression.slot; const flatten = expression.type === 'draws'; const max = expression.max
      return (frame, depth) => {
        const length = n(count(frame, depth + 1))
        if (!Number.isInteger(length) || length < 0 || length > max || length > CODE_V3_LIMITS.draws) throw new CodeMaterialError('BUDGET', 'repeat 次数不是预算内非负整数。')
        const result: unknown[] = []
        for (let i = 0; i < length; i++) { frame.locals.set(slot, i); frame.indices.push(i); const value = body(frame, depth + 1); frame.indices.pop(); if (flatten && Array.isArray(value)) result.push(...value); else result.push(value) }
        frame.locals.delete(slot); return result
      }
    }
    case 'textAnimation': return () => { throw new CodeMaterialError('TYPE', 'perChar 只能作为 text 字段。') }
    case 'draws': {
      const values = expression.values.map(child)
      return (frame, depth) => values.flatMap(value => { const result = value(frame, depth + 1); return result === null ? [] : Array.isArray(result) ? result : [result] })
    }
    case 'call': case 'v3call': {
      const args = expression.args.map(child); const operation = compileCall(expression, program)
      const cost = expression.kind === 'call' ? codeBuiltinCost(expression.op, expression.type).cpu : 0
      return (frame, depth) => { const values = args.map(value => value(frame, depth + 1)); if (cost) frame.charge(cost); return operation(values, frame) }
    }
    case 'draw': return compileDraw(expression, child, program)
  }
}

function binaryOperation(op: string): (a: unknown, b: unknown, frame: CodeExecutionFrame) => unknown {
  switch (op) {
    case '===': return (a, b) => a === b
    case '!==': return (a, b) => a !== b
    case '+': return (a, b, frame) => { if (typeof a === 'string' || typeof b === 'string') { const result = codeString(codeStringPart(a) + codeStringPart(b)); frame.charge(result.length); return result } return n(n(a) + n(b)) }
    case '**': return (a, b) => finiteCodeNumber(n(a) ** n(b), '** 结果')
    case '-': return (a, b) => n(n(a) - n(b))
    case '*': return (a, b) => n(n(a) * n(b))
    case '/': return (a, b) => n(n(a) / n(b))
    case '%': return (a, b) => n(n(a) % n(b))
    case '<': return (a, b) => n(a) < n(b)
    case '<=': return (a, b) => n(a) <= n(b)
    case '>': return (a, b) => n(a) > n(b)
    case '>=': return (a, b) => n(a) >= n(b)
    default: return () => { throw new CodeMaterialError('TYPE', '未知 IR。') }
  }
}

function compileCall(expression: Extract<CodeExpression, { kind: 'call' | 'v3call' }>, program: CodeMaterialProgram): (args: unknown[], frame: CodeExecutionFrame) => unknown {
  const op = expression.op
  if (op.startsWith('audio.')) {
    const method = op.slice(6)
    return (args, frame) => sampleAudioContent(frame.context.audio, method, (frame.context.audioTime ?? frame.context.localTime) + (method === 'band' ? args[1] === undefined ? 0 : n(args[1]) : args[0] === undefined ? 0 : n(args[0])), method === 'band' ? String(args[0]) : undefined)
  }
  if (op in CODE_MATH_COSTS) {
    const cost = CODE_MATH_COSTS[op as keyof typeof CODE_MATH_COSTS]
    const operation = codeMathOperation(op as keyof typeof CODE_MATH_COSTS)
    return (args, frame) => { frame.charge(cost); return operation(args) }
  }
  if (CODE_EASE_NAMES.includes(op)) return (args, frame) => { frame.charge(64); return codeEase(op, n(args[0]), args[1] === undefined ? undefined : n(args[1])) }
  switch (op) {
    case 'sampleGradient': return (args, frame) => {
      frame.charge(CODE_PARAMETER_FUNCTION_COSTS[op]);
      return sampleCodeGradient(args[0], n(args[1]))
    }
    case 'sampleCurve': return (args, frame) => {
      frame.charge(CODE_PARAMETER_FUNCTION_COSTS[op]);
      return sampleCodeCurve(args[0], n(args[1]))
    }
    case 'ease': return (args, frame) => {
      frame.charge(CODE_PARAMETER_FUNCTION_COSTS[op]);
      return easeCodeParameter(args[0], n(args[1]))
    }
    case 'sin': return (args, _frame) => {
      return Math.sin(n(args[0]));
    }
    case 'cos': return (args, _frame) => {
      return Math.cos(n(args[0]));
    }
    case 'abs': return (args, _frame) => {
      return Math.abs(n(args[0]));
    }
    case 'floor': return (args, _frame) => {
      return Math.floor(n(args[0]));
    }
    case 'ceil': return (args, _frame) => {
      return Math.ceil(n(args[0]));
    }
    case 'round': return (args, _frame) => {
      return Math.round(n(args[0]))
    }
    case 'min': return (args, _frame) => {
      return Math.min(n(args[0]), n(args[1]));
    }
    case 'max': return (args, _frame) => {
      return Math.max(n(args[0]), n(args[1]));
    }
    case 'rgba': return (args, _frame) => {
      return channels(args)
    }
    case 'random': return (args, frame) => {
      { const index = bounded(n(args[0]), 0, 4294967295, 'random'); if (!Number.isInteger(index)) throw new CodeMaterialError('TYPE', 'random 索引必须是整数。'); let hash = (frame.context.seed ?? program.seed) ^ index; hash = Math.imul(hash ^ hash >>> 16, 0x7feb352d); hash = Math.imul(hash ^ hash >>> 15, 0x846ca68b); return ((hash ^ hash >>> 16) >>> 0) / 4294967296 }
    }
    case 'mix': return (args, _frame) => {
      return mix(args[0], args[1], n(args[2]))
    }
    case 'clamp': return (args, _frame) => {
      { if (n(args[1]) > n(args[2])) throw new CodeMaterialError('TYPE', 'clamp 上下限颠倒。'); const clamp = (v: number): number => Math.min(n(args[2]), Math.max(n(args[1]), v)); return Array.isArray(args[0]) ? channels(channels(args[0]).map(clamp)) : clamp(n(args[0])) }
    }
    case 'smoothstep': return (args, _frame) => {
      { if (n(args[0]) >= n(args[1])) throw new CodeMaterialError('TYPE', 'smoothstep 边界必须递增。'); const t = Math.min(1, Math.max(0, (n(args[2]) - n(args[0])) / (n(args[1]) - n(args[0])))); return t * t * (3 - 2 * t) }
    }
    case 'progress': return (args, _frame) => {
      return codeProgress(n(args[0]), n(args[1]), n(args[2]))
    }
    case 'stagger': return (args, _frame) => {
      return n(n(args[0]) * n(args[1]))
    }
    case 'tween': return (args, frame) => {
      frame.charge(64);
      return mix(args[3], args[4], easeCodeParameter(args[5], codeProgress(n(args[0]), n(args[1]), n(args[2]))))
    }
    case 'cubicBezier': return (args, frame) => {
      frame.charge(64);
      return codeCubicBezier(n(args[0]), n(args[1]), n(args[2]), n(args[3]), n(args[4]))
    }
    case 'noise': return (args, frame) => {
      frame.charge(64);
      return codeNoise(n(args[0]), args[1] === undefined ? 0 : n(args[1]), args[2] === undefined ? 0 : n(args[2]), frame.context.seed ?? program.seed)
    }
    case 'chars': case 'words': return (args, frame) => {
      { const text = codeString(string(args[0])); frame.charge(text.length); return op === 'chars' ? Array.from(text) : text.trim().split(/\s+/u).filter(Boolean) }
    }
    case 'formatNumber': return (args, frame) => {
      { const text = formatCodeNumber(args[0], args[1]); frame.charge(64 + text.length); return text }
    }
    case 'formatTime': return (args, frame) => {
      { const text = formatCodeTime(args[0], args[1]); frame.charge(64 + text.length); return text }
    }
    case 'average': return (args, frame) => {
      {
        const items = array(args[0]).map(channels)
        if (!items.length || items.length > 64) throw new CodeMaterialError('BUDGET', 'average 需要 1–64 个颜色。')
        frame.charge(items.length * 4)
        return channels([0, 1, 2, 3].map(i => items.reduce((sum, item) => sum + item[i], 0) / items.length))
      }
    }
    case 'measureText': return (args, frame) => {
      { const fields = object(args[0]); keys(fields, ['text', 'fontFamily', 'fontStyle', 'fontWeight', 'fontSize', 'letterSpacing', 'lineHeight', 'maxWidth', 'wrap', 'maxLines']); return frame.measure(fields) }
    }
    case 'keyframes': return (args, frame) => {
      {
        const frames = array(args[1]).map(array)
        if (!frames.length || frames.length > 256 || frames.some((row, i) => row.length < 2 || row.length > 3 || i > 0 && n(row[0]) <= n(frames[i - 1][0]))) throw new CodeMaterialError('TYPE', '关键帧须为 1–256 项严格递增的 [秒,数值,可选缓动]。')
        frame.charge(frames.length)
        if (n(args[0]) <= n(frames[0][0])) return n(frames[0][1]); if (n(args[0]) >= n(frames.at(-1)![0])) return n(frames.at(-1)![1])
        const index = frames.findIndex(row => n(row[0]) > n(args[0])); const left = frames[index - 1]; const right = frames[index]
        return mix(left[1], right[1], codeEase(string(left[2] ?? 'linear'), codeProgress(n(args[0]), n(left[0]), n(right[0]) - n(left[0]))))
      }
    }
    case 'linearGradient': case 'radialGradient': case 'conicGradient': return (args, _frame) => {
      {
        const fields = object(args[0]); keys(fields, op === 'linearGradient' ? ['x1', 'y1', 'x2', 'y2', 'stops'] : op === 'conicGradient' ? ['cx', 'cy', 'angle', 'stops'] : ['cx', 'cy', 'r', 'stops'])
        const stops = array(fields.stops).map(item => { const row = array(item); if (row.length !== 2) throw new CodeMaterialError('TYPE', '渐变 stop 必须为 [位置,RGBA]。'); return [bounded(row[0], 0, 1, 'stop'), codeColor(row[1], 'stop.color')] as [number, CodeColor] })
        if (stops.length < 2 || stops.length > CODE_V3_LIMITS.gradientStops || stops.some((row, i) => i > 0 && row[0] < stops[i - 1][0])) throw new CodeMaterialError('BUDGET', '渐变 stops 须为 2–32 项递增位置。')
        if (op === 'linearGradient') { const x1 = n(fields.x1); const y1 = n(fields.y1); const x2 = n(fields.x2); const y2 = n(fields.y2); if (x1 === x2 && y1 === y2) throw new CodeMaterialError('TYPE', '渐变起终点不能相同。'); return { kind: op, x1, y1, x2, y2, stops } }
        if (op === 'conicGradient') return { kind: op, cx: n(fields.cx), cy: n(fields.cy), angle: n(fields.angle ?? 0), stops }
        return { kind: op, cx: n(fields.cx), cy: n(fields.cy), r: bounded(fields.r, .000001, 32768, 'gradient.r'), stops }
      }
    }
    case 'hsv': return (args, _frame) => {
      return rgbaFromHsv(n(args[0]), saturated(args[1], 0, 1, `${op}.s`), saturated(args[2], 0, 1, 'hsv.v'), args[3] === undefined ? 1 : saturated(args[3], 0, 1, `${op}.alpha`))
    }
    case 'hsl': return (args, _frame) => {
      { const light = saturated(args[2], 0, 1, 'hsl.l'); const saturation = saturated(args[1], 0, 1, `${op}.s`); const v = light + saturation * Math.min(light, 1 - light); return rgbaFromHsv(n(args[0]), v ? 2 * (1 - light / v) : 0, v, args[3] === undefined ? 1 : saturated(args[3], 0, 1, `${op}.alpha`)) }
    }
    case 'toHsv': case 'toHsl': return (args, _frame) => {
      {
        const color = codeColor(args[0], op); const max = Math.max(...color.slice(0, 3)); const min = Math.min(...color.slice(0, 3)); const delta = max - min
        const h = delta === 0 ? 0 : ((max === color[0] ? (color[1] - color[2]) / delta : max === color[1] ? (color[2] - color[0]) / delta + 2 : (color[0] - color[1]) / delta + 4) / 6 + 1) % 1
        const l = (max + min) / 2; return [h, op === 'toHsv' ? max ? delta / max : 0 : delta ? delta / (1 - Math.abs(2 * l - 1)) : 0, op === 'toHsv' ? max : l, color[3]]
      }
    }
    case 'luma': case 'saturate': case 'contrast': return (args, _frame) => {
      {
        const color = codeColor(args[0], op); const luma = color[0] * .2126 + color[1] * .7152 + color[2] * .0722
        if (op === 'luma') return luma
        return [...color.slice(0, 3).map(v => Math.min(1, Math.max(0, op === 'contrast' ? (v - .5) * n(args[1]) + .5 : luma + (v - luma) * n(args[1])))), color[3]]
      }
    }
    default: return (_args, _frame) => {
      throw new CodeMaterialError('TYPE', `CPU 不允许函数 ${op}。`)
    }

  }
}

function compileDraw(expression: Extract<CodeExpression, { kind: 'draw' }>, child: (value: CodeExpression) => Run, program: CodeMaterialProgram): Run {
  const propertyNames = Object.keys(expression.properties).filter(key => key !== 'perChar')
  const properties = propertyNames.map(key => child(expression.properties[key]))
  const runChildren = expression.children ? child(expression.children) : undefined
  const animation = expression.properties.perChar
  const animate = animation?.kind === 'textAnimation' ? child(animation.body) : undefined
  const draw = compileDrawShape(expression, program, runChildren, animate)
  return (frame, depth) => {
    if (++frame.draws > CODE_V3_LIMITS.draws) throw new CodeMaterialError('BUDGET', '本帧图形超过 4096。')
    const fields: Record<string, unknown> = {}
    for (let i = 0; i < propertyNames.length; i++) fields[propertyNames[i]] = properties[i](frame, depth + 1)
    const elementId = string(fields.id ?? `call:${expression.sourceSpan?.file ?? 'main.ts'}:${expression.sourceSpan?.start ?? 0}`) + (frame.indices.length ? `:${frame.indices.join('.')}` : '')
    const meta = metadata(fields)
    meta.elementId = elementId;
    meta.sourceSpan = expression.sourceSpan;
    meta.elementPath = []
    return draw(fields, meta, frame, depth)
  }
}
const coordinate = (fields: Record<string, unknown>, key: string): number => bounded(fields[key] ?? 0, -32768, 32768, key)
const size = (fields: Record<string, unknown>, key: string): number => bounded(fields[key], 0, 32768, key)
const drawFill = (fields: Record<string, unknown>, meta: CodeDrawMetadata): CodeColor => fields.fill === undefined ? [0, 0, 0, 0] : Array.isArray(meta.paint) ? meta.paint : [1, 1, 1, 1]
function compileDrawShape(expression: Extract<CodeExpression, { kind: 'draw' }>, program: CodeMaterialProgram, runChildren: Run | undefined, animate: Run | undefined): (fields: Record<string, unknown>, meta: CodeDrawMetadata, frame: CodeExecutionFrame, depth: number) => unknown {
  const animation = expression.properties.perChar
  if (expression.shape === 'shader') return (fields, meta, _frame, _depth) => {
    return { ...meta, kind: 'shader', graph: codeShaderGraph(program, { name: fields.name, params: fields.params, layers: fields.layers }, 'layer'), time: codeShaderTime(fields.time), x: coordinate(fields, 'x'), y: coordinate(fields, 'y'), width: size(fields, 'width'), height: size(fields, 'height') }
  }
  if (expression.shape === 'group') return (fields, meta, frame, depth) => {
    let clip: { x: number; y: number; width: number; height: number } | undefined
    if (fields.clip !== undefined) { const raw = object(fields.clip); keys(raw, ['x', 'y', 'width', 'height']); clip = { x: n(raw.x), y: n(raw.y), width: bounded(raw.width, 0, 32768, 'clip.width'), height: bounded(raw.height, 0, 32768, 'clip.height') } }
    let mask: Extract<CodeDrawCommand, { kind: 'group' }>['mask']
    if (fields.mask !== undefined) {
      const raw = object(fields.mask); keys(raw, ['shape', 'mode', 'invert'])
      const mode = string(raw.mode ?? 'alpha')
      if (!['alpha', 'luma'].includes(mode) || raw.invert !== undefined && typeof raw.invert !== 'boolean') throw new CodeMaterialError('TYPE', 'mask.mode 须为 alpha/luma，invert 须为 boolean。')
      mask = { shape: raw.shape as CodeDrawCommand | null, mode: mode as 'alpha' | 'luma', invert: raw.invert === true }
    }
    const children = array(runChildren!(frame, depth + 1)) as CodeDrawCommand[]
    return { ...meta, kind: 'group', x: coordinate(fields, 'x'), y: coordinate(fields, 'y'), children, ...(clip ? { clip } : {}), ...(mask ? { mask } : {}) }
  }
  if (expression.shape === 'path') return (fields, meta, frame, _depth) => {
    const fill = drawFill(fields, meta)
    const points = fields.d === undefined ? [array(fields.points).map(item => { const pair = array(item); if (pair.length !== 2) throw new CodeMaterialError('TYPE', '路径点须为 [x,y]。'); return [bounded(pair[0], -32768, 32768, 'point.x'), bounded(pair[1], -32768, 32768, 'point.y')] as [number, number] })] : parseCodePath(string(fields.d), frame.context.width, frame.context.height)
    const closed = fields.closed === true
    if (closed) points.forEach(path => { if (path.length && (path.at(-1)![0] !== path[0][0] || path.at(-1)![1] !== path[0][1])) path.push([...path[0]]) })
    const pointCount = points.reduce((sum, path) => sum + path.length, 0);
    frame.charge(pointCount * 4)
    if (pointCount > CODE_V3_LIMITS.pathPoints) throw new CodeMaterialError('BUDGET', '路径点数超出 4096。')
    return { ...meta, kind: 'path', points, closed, fill }
  }
  if (expression.shape === 'image') return (fields, meta, _frame, _depth) => {
    return fields.source === null ? null : { ...meta, kind: 'image', source: codeImageReference(fields.source, '图片'), x: coordinate(fields, 'x'), y: coordinate(fields, 'y'), width: size(fields, 'width'), height: size(fields, 'height'), opacity: meta.opacity! }
  }
  if (expression.shape === 'line') return (fields, meta, _frame, _depth) => {
    return { ...meta, kind: 'line', x1: coordinate(fields, 'x1'), y1: coordinate(fields, 'y1'), x2: coordinate(fields, 'x2'), y2: coordinate(fields, 'y2'), width: bounded(fields.width ?? fields.strokeWidth ?? 1, 0, 1024, 'line.width'), color: fields.color === undefined ? [1, 1, 1, 1] : codeColor(fields.color, 'color') }
  }
  if (expression.shape === 'rect') return (fields, meta, _frame, _depth) => {
    const fill = drawFill(fields, meta)
    if (fields.radii && ![1, 2, 3, 4].includes(array(fields.radii).length)) throw new CodeMaterialError('TYPE', 'radii 需要 1–4 个半径。')
    const command = Object.assign(meta, { kind: 'rect', x: coordinate(fields, 'x'), y: coordinate(fields, 'y'), width: size(fields, 'width'), height: size(fields, 'height'), fill })
    Object.assign(command, { radius: bounded(fields.radius ?? 0, 0, 32768, 'radius') })
    if (fields.radii) Object.assign(command, { radii: array(fields.radii).map(value => bounded(value, 0, 32768, 'radii')) })
    return command

  }
  if (expression.shape === 'ellipse') return (fields, meta, _frame, _depth) => {
    const fill = drawFill(fields, meta)
    if (fields.radii && ![1, 2, 3, 4].includes(array(fields.radii).length)) throw new CodeMaterialError('TYPE', 'radii 需要 1–4 个半径。')
    const command = Object.assign(meta, { kind: 'ellipse', x: coordinate(fields, 'x'), y: coordinate(fields, 'y'), width: size(fields, 'width'), height: size(fields, 'height'), fill })
    return command

  }
  return (fields, meta, frame, depth) => {
    const fill = drawFill(fields, meta)
    if (fields.radii && ![1, 2, 3, 4].includes(array(fields.radii).length)) throw new CodeMaterialError('TYPE', 'radii 需要 1–4 个半径。')
    const request = codeTextRequest(fields);
    frame.characters += request.text.length
    if (frame.characters > CODE_V3_LIMITS.textCharacters) throw new CodeMaterialError('BUDGET', '本帧文本字符总数超过 8192。')
    const layout = frame.measure(fields);
    const align = string(fields.align ?? 'left');
    const baseline = string(fields.baseline ?? 'middle')
    if (!['left', 'center', 'right'].includes(align) || !['top', 'middle', 'bottom', 'alphabetic'].includes(baseline)) throw new CodeMaterialError('TYPE', '未知 align/baseline。')
    let perChar: Extract<CodeDrawCommand, { kind: 'text' }>['perChar']

    if (animation?.kind === 'textAnimation') {
      perChar = layout.glyphs.map((_, index) => {
        frame.locals.set(animation.slot, index); frame.locals.set(animation.countSlot, layout.glyphs.length); const transform = object(animate!(frame, depth + 1)); keys(transform, ['x', 'y', 'opacity', 'scale', 'rotation', 'skewX', 'fill', 'blur', 'glow'])
        const style = metadata(transform)
        return { x: bounded(transform.x ?? 0, -32768, 32768, 'perChar.x'), y: bounded(transform.y ?? 0, -32768, 32768, 'perChar.y'), opacity: saturated(transform.opacity ?? 1, 0, 1, 'perChar.opacity'), scale: bounded(transform.scale ?? 1, 0, 1024, 'perChar.scale'), rotation: bounded(transform.rotation ?? 0, -32768, 32768, 'perChar.rotation'), ...(style.skewX !== undefined ? { skewX: style.skewX } : {}), ...(style.paint ? { fill: style.paint } : {}), ...(style.blur !== undefined ? { blur: style.blur } : {}), ...(style.glow ? { glow: style.glow } : {}) }
      })
      frame.locals.delete(animation.slot); frame.locals.delete(animation.countSlot)
    }
    return { ...meta, kind: 'text', x: coordinate(fields, 'x'), y: coordinate(fields, 'y'), ...request, fontSize: layout.fontSize, color: fields.color ? codeColor(fields.color, 'text.color') : fields.fill ? fill : [1, 1, 1, 1], align: align as 'left' | 'center' | 'right', baseline, layout, ...(perChar ? { perChar } : {}) }
  }
}
