import { VIDEO_EDIT_MAX_SEQUENCE_SECONDS } from '../time'
import { CODE_MATERIAL_LIMITS, CodeMaterialError, codeBinaryCost, codeBuiltinCost, codeColor, codeConditionalCost, codeImageReference, finiteCodeNumber } from './contract'
import type { CodeColor, CodeDrawCommand, CodeExpression, CodeMaterialContext, CodeMaterialProgram, CodeParameterValue } from './contract'
import { validateCodeMaterialParameters } from './parameters'

type EvaluatedValue = CodeParameterValue | CodeDrawCommand | CodeDrawCommand[]
export function codeMaterialRandom(seed: number, index: number): number {
  if (![seed, index].every(value => Number.isInteger(value) && value >= 0 && value <= 4294967295)) throw new CodeMaterialError('CONTEXT', '随机种子和索引必须是无符号 32 位整数。')
  let value = (seed ^ index) >>> 0
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d) >>> 0
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b) >>> 0
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296
}
function validateContext(context: CodeMaterialContext, transitionHandles: boolean): void {
  for (const key of ['time', 'localTime', 'sequenceTime', 'width', 'height', 'frame', 'fps'] as const) finiteCodeNumber(context[key], `ctx.${key}`)
  if (context.time < 0 || context.localTime < (transitionHandles ? -VIDEO_EDIT_MAX_SEQUENCE_SECONDS : 0) || context.localTime > VIDEO_EDIT_MAX_SEQUENCE_SECONDS || context.sequenceTime < 0 || !Number.isSafeInteger(context.frame) || context.frame < 0 || context.fps <= 0 || context.fps > 240 || ![context.width, context.height].every(value => Number.isInteger(value) && value > 0 && value <= 8192)) throw new CodeMaterialError('CONTEXT', '时间、尺寸、帧或帧率无效。')
}
/** Evaluate generator IR once at an explicit source time. Filter IR stays on the trusted GPU path. */
export function evaluateCodeMaterial(program: CodeMaterialProgram, context: CodeMaterialContext, values: Readonly<Record<string, unknown>> = {}, options: { transitionHandles?: boolean } = {}): CodeDrawCommand[] {
  if (program.kind !== 'generator' || program.apiVersion !== 1 || ![1, 2].includes(program.languageVersion)) throw new CodeMaterialError('TYPE', 'CPU 求值仅支持版本 1 或 2 的生成器；滤镜由可信 GPU emitter 消费。')
  if (program.languageVersion !== (program.parameters.some(parameter => parameter.type === 'image') ? 2 : 1)) throw new CodeMaterialError('TYPE', '图片参数与作者语言版本不一致。')
  validateContext(context, options.transitionHandles === true)
  const parameters = validateCodeMaterialParameters(program, values)
  const seed = context.seed ?? program.seed; codeMaterialRandom(seed, 0)
  const bindings: EvaluatedValue[] = []; let operations = 0
  const charge = (cost = 1): void => { operations += cost; if (operations > CODE_MATERIAL_LIMITS.cpuOperations) throw new CodeMaterialError('BUDGET', '本次求值超出 CPU 操作预算。') }
  const number = (value: EvaluatedValue): number => finiteCodeNumber(value, '表达式结果')
  const boolean = (value: EvaluatedValue): boolean => { if (typeof value !== 'boolean') throw new CodeMaterialError('TYPE', '表达式需要布尔值。'); return value }
  const color = (value: EvaluatedValue): CodeColor => codeColor(value, '图形颜色')
  const bounded = (value: EvaluatedValue, min: number, max: number, label: string): number => { const result = number(value); if (result < min || result > max) throw new CodeMaterialError('BUDGET', `${label}超出图形范围。`); return result }
  const evaluate = (expression: CodeExpression, depth = 0): EvaluatedValue => {
    charge(); if (depth > CODE_MATERIAL_LIMITS.depth) throw new CodeMaterialError('BUDGET', '求值表达式嵌套超出预算。')
    const next = (value: CodeExpression): EvaluatedValue => evaluate(value, depth + 1)
    switch (expression.kind) {
      case 'literal': return typeof expression.value === 'number' ? number(expression.value) : expression.value
      case 'color': { if (expression.values.length !== 4) throw new CodeMaterialError('TYPE', '颜色必须有四个通道。'); return color(expression.values.map(value => number(next(value))) as CodeColor) }
      case 'context': { if (expression.key === 'u' || expression.key === 'v') throw new CodeMaterialError('TYPE', '生成器不能使用像素坐标。'); return number(context[expression.key]) }
      case 'parameter': { const value = parameters[expression.key]; if (value === undefined) throw new CodeMaterialError('PARAMETERS', 'IR 引用了未声明参数。'); return value }
      case 'binding': { if (!Number.isInteger(expression.slot) || expression.slot < 0 || expression.slot >= bindings.length) throw new CodeMaterialError('TYPE', 'IR 局部绑定引用无效。'); return bindings[expression.slot] }
      case 'component': return color(next(expression.value))[expression.index]
      case 'unary': { const value = next(expression.value); return expression.op === '!' ? !boolean(value) : number(expression.op === '-' ? -number(value) : number(value)) }
      case 'binary': {
        charge(codeBinaryCost(expression.op) - 1)
        const left = next(expression.left)
        if (expression.op === '&&') return boolean(left) && boolean(next(expression.right))
        if (expression.op === '||') return boolean(left) || boolean(next(expression.right))
        const right = next(expression.right)
        if (expression.op === '===') return left === right
        if (expression.op === '!==') return left !== right
        const a = number(left); const b = number(right)
        switch (expression.op) {
          case '+': return number(a + b); case '-': return number(a - b); case '*': return number(a * b); case '/': return number(a / b); case '%': return number(a % b)
          case '<': return a < b; case '<=': return a <= b; case '>': return a > b; case '>=': return a >= b
        }
        throw new CodeMaterialError('TYPE', 'IR 二元操作无效。')
      }
      case 'conditional': { charge(codeConditionalCost(expression.type) - 1); return next(boolean(next(expression.condition)) ? expression.yes : expression.no) }
      case 'call': {
        charge(codeBuiltinCost(expression.op, expression.type).cpu)
        const args = expression.args.map(next)
        const a = (): number => number(args[0]); const b = (): number => number(args[1]); const c = (): number => number(args[2])
        switch (expression.op) {
          case 'sin': return number(Math.sin(a())); case 'cos': return number(Math.cos(a())); case 'abs': return number(Math.abs(a()))
          case 'floor': return number(Math.floor(a())); case 'ceil': return number(Math.ceil(a())); case 'round': return number(Math.round(a()))
          case 'min': return number(Math.min(a(), b())); case 'max': return number(Math.max(a(), b()))
          case 'random': return codeMaterialRandom(seed, a())
          case 'rgba': return color(args.map(number) as CodeColor)
          case 'sample': throw new CodeMaterialError('TYPE', '生成器不允许采样输入。')
          case 'clamp': { if (b() > c()) throw new CodeMaterialError('TYPE', 'clamp 下限不能大于上限。'); const clamp = (value: number): number => Math.min(Math.max(value, b()), c()); return expression.type === 'color' ? color(color(args[0]).map(clamp) as CodeColor) : number(clamp(a())) }
          case 'mix': { const amount = c(); const mix = (x: number, y: number): number => number(x + (y - x) * amount); return expression.type === 'color' ? color(color(args[0]).map((channel, index) => mix(channel, color(args[1])[index])) as CodeColor) : mix(a(), b()) }
          case 'smoothstep': { if (a() >= b()) throw new CodeMaterialError('TYPE', 'smoothstep 边界必须严格递增。'); const t = Math.min(Math.max((c() - a()) / (b() - a()), 0), 1); return number(t * t * (3 - 2 * t)) }
        }
        throw new CodeMaterialError('TYPE', 'IR 函数不在白名单。')
      }
      case 'draw': {
        const fields = Object.fromEntries(Object.entries(expression.properties).map(([key, value]) => [key, next(value)]))
        const coordinate = (key: string): number => bounded(fields[key], -32768, 32768, key)
        const size = (key: string, max = 32768): number => bounded(fields[key], 0, max, key)
        if (expression.shape === 'image') {
          const x = coordinate('x'); const y = coordinate('y'); const width = size('width'); const height = size('height'); const opacity = bounded(fields.opacity ?? 1, 0, 1, 'opacity')
          if (fields.source === null) return null
          return { kind: 'image', source: codeImageReference(fields.source, '图片来源'), x, y, width, height, opacity }
        }
        if (expression.shape === 'rect') return { kind: 'rect', x: coordinate('x'), y: coordinate('y'), width: size('width'), height: size('height'), fill: color(fields.fill), radius: 'radius' in fields ? size('radius') : 0 }
        if (expression.shape === 'ellipse') return { kind: 'ellipse', x: coordinate('x'), y: coordinate('y'), width: size('width'), height: size('height'), fill: color(fields.fill) }
        if (expression.shape === 'line') return { kind: 'line', x1: coordinate('x1'), y1: coordinate('y1'), x2: coordinate('x2'), y2: coordinate('y2'), width: size('width', 1024), color: color(fields.color) }
        if (expression.shape !== 'text' || typeof fields.text !== 'string' || fields.text.length > CODE_MATERIAL_LIMITS.stringLength) throw new CodeMaterialError('TYPE', '文本图形无效。')
        const fontFamily = fields.fontFamily ?? 'sans-serif'; const align = fields.align ?? 'left'
        if (!['sans-serif', 'serif', 'monospace'].includes(String(fontFamily)) || !['left', 'center', 'right'].includes(String(align))) throw new CodeMaterialError('TYPE', '字体或文本对齐不在白名单。')
        return { kind: 'text', x: coordinate('x'), y: coordinate('y'), text: fields.text, fontSize: bounded(fields.fontSize, 1, 1024, 'fontSize'), color: color(fields.color), fontFamily: fontFamily as 'sans-serif' | 'serif' | 'monospace', align: align as 'left' | 'center' | 'right' }
      }
      case 'draws': { if (expression.values.length > CODE_MATERIAL_LIMITS.draws) throw new CodeMaterialError('BUDGET', '图形最多 256 项。'); return expression.values.flatMap(value => { const result = next(value); if (result === null && value.type === 'draw') return []; if (typeof result !== 'object' || result === null || Array.isArray(result) || !('kind' in result) || result.kind === 'image' && !('source' in result)) throw new CodeMaterialError('TYPE', '输出必须是图形命令。'); return [result as CodeDrawCommand] }) }
    }
    throw new CodeMaterialError('TYPE', 'IR 节点不在白名单。')
  }
  if (program.bindings.length > CODE_MATERIAL_LIMITS.astNodes) throw new CodeMaterialError('BUDGET', '局部绑定超出预算。')
  for (const binding of program.bindings) bindings.push(evaluate(binding.expression))
  const result = evaluate(program.result)
  if (!Array.isArray(result) || result.some(value => typeof value !== 'object' || value === null || !('kind' in value))) throw new CodeMaterialError('TYPE', '生成器必须输出图形命令数组。')
  const draws = result as CodeDrawCommand[]; let textCharacters = 0
  // Bindings may alias a command. Charge each actual draw occurrence, including repeated aliases.
  for (const draw of draws) if (draw.kind === 'text') {
    textCharacters += draw.text.length
    if (textCharacters > CODE_MATERIAL_LIMITS.textCharacters) throw new CodeMaterialError('BUDGET', '本帧文本字符总数超出预算。')
    charge(draw.text.length)
  }
  return draws
}
