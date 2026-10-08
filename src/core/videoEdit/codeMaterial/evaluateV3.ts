import { CODE_V3_LIMITS, CodeMaterialError, codeColor, codeImageReference, finiteCodeNumber } from './contract'
import type { CodeColor, CodeDrawCommand, CodeDrawMetadata, CodeExpression, CodeGradient, CodeMaterialContext, CodeMaterialProgram, CodePaint, CodeTextMeasurer, CodeTextMeasureRequest } from './contract'
import { validateCodeMaterialParameters } from './parameters'
import { CODE_EASE_NAMES, codeCubicBezier, codeEase, codeNoise, codeProgress } from './motion'
import { parseCodePath } from './geometry'
import { readCodeStyleToken, validatedCodeStyle } from './style'
import { codeShaderGraph, codeShaderTime } from './shaders'
import { CODE_PARAMETER_FUNCTION_COSTS, easeCodeParameter, sampleCodeCurve, sampleCodeGradient } from './parameterSampling'

const n = (value: unknown): number => finiteCodeNumber(value, '表达式结果')
const array = (value: unknown): unknown[] => { if (!Array.isArray(value)) throw new CodeMaterialError('TYPE', '需要数组。'); return value }
const object = (value: unknown): Record<string, unknown> => { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CodeMaterialError('TYPE', '需要字段对象。'); return value as Record<string, unknown> }
const string = (value: unknown): string => { if (typeof value !== 'string') throw new CodeMaterialError('TYPE', '需要字符串。'); return value }
const channels = (value: unknown): CodeColor => { const values = array(value); if (values.length !== 4) throw new CodeMaterialError('TYPE', '颜色需要四个通道。'); return values.map(n) as CodeColor }
const literalColors = new WeakMap<CodeExpression, CodeColor>()
const bounded = (value: unknown, min: number, max: number, label: string): number => { const result = n(value); if (result < min || result > max) throw new CodeMaterialError('BUDGET', `${label} 超出技术范围 ${min}–${max}。`); return result }
function keys(fields: Record<string, unknown>, allowed: string[]): void { for (const key of Object.keys(fields)) if (!allowed.includes(key)) throw new CodeMaterialError('TYPE', `未知字段：${key}`) }
function paint(value: unknown): CodePaint {
  if (Array.isArray(value)) return codeColor(value, '颜色')
  const fields = object(value)
  if (!['linearGradient', 'radialGradient'].includes(string(fields.kind))) throw new CodeMaterialError('TYPE', '需要颜色或渐变。')
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
  const value: CodeDrawMetadata = { opacity: bounded(fields.opacity ?? 1, 0, 1, 'opacity'), rotation: bounded(fields.rotation ?? 0, -32768, 32768, 'rotation'), scaleX: bounded(fields.scaleX ?? fields.scale ?? 1, -1024, 1024, 'scaleX'), scaleY: bounded(fields.scaleY ?? fields.scale ?? 1, -1024, 1024, 'scaleY'), anchorX: bounded(fields.anchorX ?? 0, -32768, 32768, 'anchorX'), anchorY: bounded(fields.anchorY ?? 0, -32768, 32768, 'anchorY') }
  value.authorAnchor = fields.anchorX !== undefined || fields.anchorY !== undefined
  if (fields.blend !== undefined) { const blend = string(fields.blend); if (!['normal', 'multiply', 'screen', 'overlay', 'add', 'lighten', 'darken'].includes(blend)) throw new CodeMaterialError('TYPE', '未知 blend。'); value.blend = blend as CodeDrawMetadata['blend'] }
  if (fields.fill !== undefined) value.paint = paint(fields.fill)
  if (fields.stroke !== undefined) value.stroke = paint(fields.stroke)
  if (fields.strokeWidth !== undefined) value.strokeWidth = bounded(fields.strokeWidth, 0, 1024, 'strokeWidth')
  if (fields.lineCap !== undefined) { const cap = string(fields.lineCap); if (!['round', 'butt', 'square'].includes(cap)) throw new CodeMaterialError('TYPE', '未知 lineCap。'); value.lineCap = cap as CodeDrawMetadata['lineCap'] }
  if (fields.lineJoin !== undefined) { const join = string(fields.lineJoin); if (!['miter', 'round', 'bevel'].includes(join)) throw new CodeMaterialError('TYPE', '未知 lineJoin。'); value.lineJoin = join as CodeDrawMetadata['lineJoin'] }
  if (fields.dash !== undefined) { value.dash = array(fields.dash).map(item => bounded(item, 0, 32768, 'dash')); if (value.dash.length > 32 || value.dash.length && value.dash.every(item => item === 0)) throw new CodeMaterialError('BUDGET', 'dash 须为 0–32 项且非全零。') }
  if (fields.trimStart !== undefined) value.trimStart = bounded(fields.trimStart, 0, 1, 'trimStart')
  if (fields.trimEnd !== undefined) value.trimEnd = bounded(fields.trimEnd, value.trimStart ?? 0, 1, 'trimEnd')
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
export interface CodeEvaluationOptions { measureText?: CodeTextMeasurer; onDiagnostic?: (diagnostic: { code: 'MISSING_FONT'; fontFamily: string; elementId?: string }) => void }
function evaluateV3(program: CodeMaterialProgram, context: CodeMaterialContext, values: Readonly<Record<string, unknown>>, options: CodeEvaluationOptions = {}, root?: CodeExpression): unknown {
  const parameters = validateCodeMaterialParameters(program, values); const bindings: unknown[] = []; const locals = new Map<number, unknown>()
  const style = validatedCodeStyle(context.style)
  let operations = 0; let draws = 0; let characters = 0; const indices: number[] = []
  const charge = (cost = 1): void => { operations += cost; if (operations > CODE_V3_LIMITS.cpuOperations) throw new CodeMaterialError('BUDGET', '本次求值超出 v3 CPU 操作预算。') }
  const measure = (fields: Record<string, unknown>): ReturnType<CodeTextMeasurer> => {
    if (!options.measureText) throw new CodeMaterialError('CONTEXT', 'v3 文字需要宿主提供与渲染共享的字体度量。')
    const request = codeTextRequest(fields); charge(request.text.length * (request.maxLines ? 32 : 2))
    const result = options.measureText(request)
    if (result.missingFont) options.onDiagnostic?.({ code: 'MISSING_FONT', fontFamily: result.missingFont })
    return result
  }
  const mix = (a: unknown, b: unknown, t: number): number | CodeColor => {
    if (!Array.isArray(a)) return n(n(a) + (n(b) - n(a)) * t)
    const left = channels(a); const right = channels(b)
    return channels([left[0] + (right[0] - left[0]) * t, left[1] + (right[1] - left[1]) * t, left[2] + (right[2] - left[2]) * t, left[3] + (right[3] - left[3]) * t])
  }
  const evaluate = (expression: CodeExpression, depth = 0): unknown => {
    try { return evaluateNode(expression, depth) }
    catch (error) {
      const span = expression.sourceSpan
      if (span && error instanceof CodeMaterialError && !error.sourceSpan) throw new CodeMaterialError(error.code, error.message, span)
      throw error
    }
  }
  const evaluateNode = (expression: CodeExpression, depth = 0): unknown => {
    charge(); if (depth > CODE_V3_LIMITS.depth) throw new CodeMaterialError('BUDGET', 'IR 深度超出 64。')
    const next = (value: CodeExpression): unknown => evaluate(value, depth + 1)
    switch (expression.kind) {
      case 'literal': return expression.value
      case 'context': { if (['u', 'v'].includes(expression.key)) throw new CodeMaterialError('TYPE', 'CPU 生成器不能读像素坐标。'); return context[expression.key as keyof CodeMaterialContext] }
      case 'parameter': return parameters[expression.key]
      case 'binding': { if (expression.slot < 0 || expression.slot >= program.bindings.length) throw new CodeMaterialError('TYPE', '无效 const 绑定。'); if (!(expression.slot in bindings)) bindings[expression.slot] = next(program.bindings[expression.slot].expression); return bindings[expression.slot] }
      case 'local': { if (!locals.has(expression.slot)) throw new CodeMaterialError('TYPE', '无效 repeat/字符索引。'); return locals.get(expression.slot) }
      case 'color': {
        const cached = literalColors.get(expression); if (cached) return cached
        if (expression.values.length !== 4) throw new CodeMaterialError('TYPE', '四通道表需要四个数值。')
        const color = expression.values.map(value => n(next(value))) as CodeColor
        if (expression.values.every(value => value.kind === 'literal')) literalColors.set(expression, color)
        return color
      }
      case 'style': return readCodeStyleToken(style, expression.path)
      case 'array': return expression.values.map(next)
      case 'object': return Object.fromEntries(Object.entries(expression.properties).map(([key, value]) => [key, next(value)]))
      case 'component': return channels(next(expression.value))[expression.index]
      case 'field': { const value = next(expression.value); return expression.key === 'length' && (Array.isArray(value) || typeof value === 'string') ? value.length : object(value)[expression.key] }
      case 'index': {
        const value = next(expression.value); const index = n(next(expression.index)); const table = typeof value === 'string' ? Array.from(value) : array(value)
        if (!Number.isInteger(index) || index < 0 || index >= table.length) throw new CodeMaterialError('TYPE', '数组索引越界或不是整数。')
        return table[index]
      }
      case 'unary': { const value = next(expression.value); if (expression.op === '!') { if (typeof value !== 'boolean') throw new CodeMaterialError('TYPE', '需要布尔值。'); return !value } return expression.op === '-' ? -n(value) : n(value) }
      case 'binary': {
        const a = next(expression.left)
        if (expression.op === '&&' || expression.op === '||') { if (typeof a !== 'boolean') throw new CodeMaterialError('TYPE', '需要布尔值。'); return expression.op === '&&' ? a && next(expression.right) : a || next(expression.right) }
        const b = next(expression.right)
        switch (expression.op) {
          case '===': return a === b; case '!==': return a !== b
          case '+': return n(n(a) + n(b)); case '-': return n(n(a) - n(b)); case '*': return n(n(a) * n(b)); case '/': return n(n(a) / n(b)); case '%': return n(n(a) % n(b))
          case '<': return n(a) < n(b); case '<=': return n(a) <= n(b); case '>': return n(a) > n(b); case '>=': return n(a) >= n(b)
        }
        break
      }
      case 'conditional': { const condition = next(expression.condition); if (typeof condition !== 'boolean') throw new CodeMaterialError('TYPE', '条件需要布尔值。'); return next(condition ? expression.yes : expression.no) }
      case 'repeat': {
        const count = n(next(expression.count))
        if (!Number.isInteger(count) || count < 0 || count > expression.max || count > CODE_V3_LIMITS.draws) throw new CodeMaterialError('BUDGET', 'repeat 次数不是预算内非负整数。')
        const result: unknown[] = []
        for (let i = 0; i < count; i++) { locals.set(expression.slot, i); indices.push(i); const value = next(expression.body); indices.pop(); if (expression.type === 'draws' && Array.isArray(value)) result.push(...value); else result.push(value) }
        locals.delete(expression.slot); return result
      }
      case 'textAnimation': throw new CodeMaterialError('TYPE', 'perChar 只能作为 text 字段。')
      case 'draws': return expression.values.flatMap(value => { const result = next(value); return result === null ? [] : Array.isArray(result) ? result : [result] })
      case 'call': case 'v3call': {
        const args = expression.args.map(next); const op = expression.op
        const a = (): number => n(args[0]); const b = (): number => n(args[1]); const c = (): number => n(args[2])
        if (CODE_EASE_NAMES.includes(op)) { charge(64); return codeEase(op, a(), args[1] === undefined ? undefined : b()) }
        switch (op) {
          case 'sampleGradient': charge(CODE_PARAMETER_FUNCTION_COSTS[op]); return sampleCodeGradient(args[0], b())
          case 'sampleCurve': charge(CODE_PARAMETER_FUNCTION_COSTS[op]); return sampleCodeCurve(args[0], b())
          case 'ease': charge(CODE_PARAMETER_FUNCTION_COSTS[op]); return easeCodeParameter(args[0], b())
          case 'sin': charge(16); return Math.sin(a()); case 'cos': charge(16); return Math.cos(a()); case 'abs': return Math.abs(a()); case 'floor': return Math.floor(a()); case 'ceil': return Math.ceil(a()); case 'round': return Math.round(a())
          case 'min': return Math.min(a(), b()); case 'max': return Math.max(a(), b()); case 'rgba': return channels(args)
          case 'random': { const index = bounded(a(), 0, 4294967295, 'random'); if (!Number.isInteger(index)) throw new CodeMaterialError('TYPE', 'random 索引必须是整数。'); let hash = (context.seed ?? program.seed) ^ index; hash = Math.imul(hash ^ hash >>> 16, 0x7feb352d); hash = Math.imul(hash ^ hash >>> 15, 0x846ca68b); return ((hash ^ hash >>> 16) >>> 0) / 4294967296 }
          case 'mix': return mix(args[0], args[1], c())
          case 'clamp': { if (b() > c()) throw new CodeMaterialError('TYPE', 'clamp 上下限颠倒。'); const clamp = (v: number): number => Math.min(c(), Math.max(b(), v)); return Array.isArray(args[0]) ? channels(channels(args[0]).map(clamp)) : clamp(a()) }
          case 'smoothstep': { if (a() >= b()) throw new CodeMaterialError('TYPE', 'smoothstep 边界必须递增。'); const t = Math.min(1, Math.max(0, (c() - a()) / (b() - a()))); return t * t * (3 - 2 * t) }
          case 'progress': return codeProgress(a(), b(), c())
          case 'stagger': return n(a() * b())
          case 'tween': charge(64); return mix(args[3], args[4], codeEase(string(args[5]), codeProgress(a(), b(), c())))
          case 'cubicBezier': charge(64); return codeCubicBezier(a(), b(), c(), n(args[3]), n(args[4]))
          case 'noise': charge(64); return codeNoise(a(), args[1] === undefined ? 0 : b(), args[2] === undefined ? 0 : c(), context.seed ?? program.seed)
          case 'chars': return Array.from(string(args[0])); case 'words': return string(args[0]).trim().split(/\s+/u).filter(Boolean)
          case 'measureText': { const fields = object(args[0]); keys(fields, ['text', 'fontFamily', 'fontStyle', 'fontWeight', 'fontSize', 'letterSpacing', 'lineHeight', 'maxWidth', 'wrap', 'maxLines']); return measure(fields) }
          case 'keyframes': {
            const frames = array(args[1]).map(array)
            if (!frames.length || frames.length > 256 || frames.some((row, i) => row.length < 2 || row.length > 3 || i > 0 && n(row[0]) <= n(frames[i - 1][0]))) throw new CodeMaterialError('TYPE', '关键帧须为 1–256 项严格递增的 [秒,数值,可选缓动]。')
            charge(frames.length)
            if (a() <= n(frames[0][0])) return n(frames[0][1]); if (a() >= n(frames.at(-1)![0])) return n(frames.at(-1)![1])
            const index = frames.findIndex(row => n(row[0]) > a()); const left = frames[index - 1]; const right = frames[index]
            return mix(left[1], right[1], codeEase(string(left[2] ?? 'linear'), codeProgress(a(), n(left[0]), n(right[0]) - n(left[0]))))
          }
          case 'linearGradient': case 'radialGradient': {
            const fields = object(args[0]); keys(fields, op === 'linearGradient' ? ['x1', 'y1', 'x2', 'y2', 'stops'] : ['cx', 'cy', 'r', 'stops'])
            const stops = array(fields.stops).map(item => { const row = array(item); if (row.length !== 2) throw new CodeMaterialError('TYPE', '渐变 stop 必须为 [位置,RGBA]。'); return [bounded(row[0], 0, 1, 'stop'), codeColor(row[1], 'stop.color')] as [number, CodeColor] })
            if (stops.length < 2 || stops.length > 8 || stops.some((row, i) => i > 0 && row[0] < stops[i - 1][0])) throw new CodeMaterialError('BUDGET', '渐变 stops 须为 2–8 项递增位置。')
            if (op === 'linearGradient') { const x1 = n(fields.x1); const y1 = n(fields.y1); const x2 = n(fields.x2); const y2 = n(fields.y2); if (x1 === x2 && y1 === y2) throw new CodeMaterialError('TYPE', '渐变起终点不能相同。'); return { kind: op, x1, y1, x2, y2, stops } }
            return { kind: op, cx: n(fields.cx), cy: n(fields.cy), r: bounded(fields.r, .000001, 32768, 'gradient.r'), stops }
          }
          case 'hsv': return rgbaFromHsv(a(), bounded(args[1], 0, 1, 's'), bounded(args[2], 0, 1, 'v'), args[3] === undefined ? 1 : n(args[3]))
          case 'hsl': { const light = bounded(args[2], 0, 1, 'l'); const saturation = bounded(args[1], 0, 1, 's'); const v = light + saturation * Math.min(light, 1 - light); return rgbaFromHsv(a(), v ? 2 * (1 - light / v) : 0, v, args[3] === undefined ? 1 : n(args[3])) }
          case 'toHsv': case 'toHsl': {
            const color = codeColor(args[0], op); const max = Math.max(...color.slice(0, 3)); const min = Math.min(...color.slice(0, 3)); const delta = max - min
            const h = delta === 0 ? 0 : ((max === color[0] ? (color[1] - color[2]) / delta : max === color[1] ? (color[2] - color[0]) / delta + 2 : (color[0] - color[1]) / delta + 4) / 6 + 1) % 1
            const l = (max + min) / 2; return [h, op === 'toHsv' ? max ? delta / max : 0 : delta ? delta / (1 - Math.abs(2 * l - 1)) : 0, op === 'toHsv' ? max : l, color[3]]
          }
          case 'luma': case 'saturate': case 'contrast': {
            const color = codeColor(args[0], op); const luma = color[0] * .2126 + color[1] * .7152 + color[2] * .0722
            if (op === 'luma') return luma
            return [...color.slice(0, 3).map(v => Math.min(1, Math.max(0, op === 'contrast' ? (v - .5) * b() + .5 : luma + (v - luma) * b()))), color[3]]
          }
          default: throw new CodeMaterialError('TYPE', `CPU 不允许函数 ${op}。`)
        }
      }
      case 'draw': {
        try {
          if (++draws > CODE_V3_LIMITS.draws) throw new CodeMaterialError('BUDGET', '本帧图形超过 4096。')
          const fields: Record<string, unknown> = {}
          for (const key in expression.properties) if (key !== 'perChar') fields[key] = next(expression.properties[key])
          const elementId = string(fields.id ?? `call:${expression.sourceSpan?.file ?? 'main.ts'}:${expression.sourceSpan?.start ?? 0}`) + (indices.length ? `:${indices.join('.')}` : '')
          const meta: CodeDrawMetadata = { ...metadata(fields), elementId, sourceSpan: expression.sourceSpan, elementPath: [] }
          const coordinate = (key: string): number => bounded(fields[key] ?? 0, -32768, 32768, key)
          const size = (key: string): number => bounded(fields[key], 0, 32768, key)
          const fill = fields.fill === undefined ? [0, 0, 0, 0] as CodeColor : Array.isArray(fields.fill) ? codeColor(fields.fill, 'fill') : [1, 1, 1, 1] as CodeColor
          if (expression.shape === 'shader') return { ...meta, kind: 'shader', graph: codeShaderGraph(program, { name: fields.name, params: fields.params, layers: fields.layers }, 'layer'), time: codeShaderTime(fields.time), x: coordinate('x'), y: coordinate('y'), width: size('width'), height: size('height') }
          if (expression.shape === 'group') {
            let clip: { x: number; y: number; width: number; height: number } | undefined
            if (fields.clip !== undefined) { const raw = object(fields.clip); keys(raw, ['x', 'y', 'width', 'height']); clip = { x: n(raw.x), y: n(raw.y), width: bounded(raw.width, 0, 32768, 'clip.width'), height: bounded(raw.height, 0, 32768, 'clip.height') } }
            const children = array(next(expression.children!)) as CodeDrawCommand[]
            return { ...meta, kind: 'group', x: coordinate('x'), y: coordinate('y'), children, ...(clip ? { clip } : {}) }
          }
          if (expression.shape === 'path') {
            const points = fields.d === undefined ? [array(fields.points).map(item => { const pair = array(item); if (pair.length !== 2) throw new CodeMaterialError('TYPE', '路径点须为 [x,y]。'); return [bounded(pair[0], -32768, 32768, 'point.x'), bounded(pair[1], -32768, 32768, 'point.y')] as [number, number] })] : parseCodePath(string(fields.d))
            const closed = fields.closed === true
            if (closed) points.forEach(path => { if (path.length && (path.at(-1)![0] !== path[0][0] || path.at(-1)![1] !== path[0][1])) path.push([...path[0]]) })
            const pointCount = points.reduce((sum, path) => sum + path.length, 0); charge(pointCount * 4)
            if (pointCount > CODE_V3_LIMITS.pathPoints) throw new CodeMaterialError('BUDGET', '路径点数超出 4096。')
            return { ...meta, kind: 'path', points, closed, fill }
          }
          if (expression.shape === 'image') return fields.source === null ? null : { ...meta, kind: 'image', source: codeImageReference(fields.source, '图片'), x: coordinate('x'), y: coordinate('y'), width: size('width'), height: size('height'), opacity: meta.opacity! }
          if (expression.shape === 'line') return { ...meta, kind: 'line', x1: coordinate('x1'), y1: coordinate('y1'), x2: coordinate('x2'), y2: coordinate('y2'), width: bounded(fields.width ?? fields.strokeWidth ?? 1, 0, 1024, 'line.width'), color: fields.color === undefined ? [1, 1, 1, 1] : codeColor(fields.color, 'color') }
          if (fields.radii && ![1, 2, 3, 4].includes(array(fields.radii).length)) throw new CodeMaterialError('TYPE', 'radii 需要 1–4 个半径。')
          if (expression.shape === 'rect' || expression.shape === 'ellipse') return { ...meta, kind: expression.shape, x: coordinate('x'), y: coordinate('y'), width: size('width'), height: size('height'), fill, ...(expression.shape === 'rect' ? { radius: bounded(fields.radius ?? 0, 0, 32768, 'radius'), ...(fields.radii ? { radii: array(fields.radii).map(value => bounded(value, 0, 32768, 'radii')) } : {}) } : {}) }
          const request = codeTextRequest(fields); characters += request.text.length
          if (characters > CODE_V3_LIMITS.textCharacters) throw new CodeMaterialError('BUDGET', '本帧文本字符总数超过 8192。')
          const layout = measure(fields); const align = string(fields.align ?? 'left'); const baseline = string(fields.baseline ?? 'middle')
          if (!['left', 'center', 'right'].includes(align) || !['top', 'middle', 'bottom', 'alphabetic'].includes(baseline)) throw new CodeMaterialError('TYPE', '未知 align/baseline。')
          let perChar: Extract<CodeDrawCommand, { kind: 'text' }>['perChar']
          const animation = expression.properties.perChar
          if (animation?.kind === 'textAnimation') {
            perChar = layout.glyphs.map((_, index) => {
              locals.set(animation.slot, index); locals.set(animation.countSlot, layout.glyphs.length); const transform = object(next(animation.body)); keys(transform, ['x', 'y', 'opacity', 'scale', 'rotation'])
              return { x: bounded(transform.x ?? 0, -32768, 32768, 'perChar.x'), y: bounded(transform.y ?? 0, -32768, 32768, 'perChar.y'), opacity: bounded(transform.opacity ?? 1, 0, 1, 'perChar.opacity'), scale: bounded(transform.scale ?? 1, 0, 1024, 'perChar.scale'), rotation: bounded(transform.rotation ?? 0, -32768, 32768, 'perChar.rotation') }
            })
            locals.delete(animation.slot); locals.delete(animation.countSlot)
          }
          return { ...meta, kind: 'text', x: coordinate('x'), y: coordinate('y'), ...request, fontSize: layout.fontSize, color: fields.color ? codeColor(fields.color, 'text.color') : fields.fill ? fill : [1, 1, 1, 1], align: align as 'left' | 'center' | 'right', baseline, layout, ...(perChar ? { perChar } : {}) }
        } catch (error) {
          if (error instanceof CodeMaterialError && !error.sourceSpan && expression.sourceSpan) throw new CodeMaterialError(error.code, error.message, expression.sourceSpan)
          throw error
        }
      }
    }
    throw new CodeMaterialError('TYPE', '未知 IR。')
  }
  if (root) return evaluate(root)
  program.bindings.forEach((binding, index) => { if (!(index in bindings)) bindings[index] = evaluate(binding.expression) })
  const output = array(evaluate(program.result)) as CodeDrawCommand[]
  let actual = 0; let textCharacters = 0; let shaderLayers = 0
  const assign = (commands: CodeDrawCommand[], path: string[]): void => commands.forEach((command, index) => {
    actual += command.kind === 'text' && command.perChar ? Math.max(1, command.layout!.glyphs.length) : 1
    if (actual > CODE_V3_LIMITS.draws) throw new CodeMaterialError('BUDGET', '本帧图形超过 4096。', command.sourceSpan)
    if (command.kind === 'shader' && ++shaderLayers > CODE_V3_LIMITS.shaderLayers) throw new CodeMaterialError('BUDGET', '本帧着色器层超出预算。', command.sourceSpan)
    command.elementPath = [...path, `${command.elementId}/${index}`]
    if (command.kind === 'text') textCharacters += command.text.length
    if (textCharacters > CODE_V3_LIMITS.textCharacters) throw new CodeMaterialError('BUDGET', '本帧文本字符总数超过 8192。', command.sourceSpan)
    if (command.kind === 'group') assign(command.children, command.elementPath)
  })
  // Aliases get independent metadata: no shared command is mutated through another occurrence.
  const clone = (commands: CodeDrawCommand[]): CodeDrawCommand[] => commands.filter(Boolean).map(command => command.kind === 'group' ? { ...command, children: clone(command.children) } : { ...command })
  const commands = clone(output); assign(commands, [])
  return commands
}

export function evaluateCodeMaterialV3(program: CodeMaterialProgram, context: CodeMaterialContext, values: Readonly<Record<string, unknown>>, options: CodeEvaluationOptions = {}): CodeDrawCommand[] {
  return evaluateV3(program, context, values, options) as CodeDrawCommand[]
}
/** Used only for compiler-checked, pixel-independent uniforms of trusted filter passes. */
export function evaluateCodeFrameExpression(program: CodeMaterialProgram, expression: CodeExpression, context: CodeMaterialContext, values: Readonly<Record<string, unknown>>): unknown {
  return evaluateV3(program, context, values, {}, expression)
}
