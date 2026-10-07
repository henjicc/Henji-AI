import ts from 'typescript'
import { CODE_BUILTINS, CODE_CONTEXT_KEYS, CODE_TIME_KEYS, CODE_V3_LIMITS, CodeMaterialError, assertCodeMaterialKey, codeBinaryCost, codeBuiltinCost, finiteCodeNumber } from './contract'
import type { CodeBinaryOperator, CodeBuiltin, CodeContextKey, CodeDrawKind, CodeExpression, CodeMaterialProgram, CodeSourceSpan, CodeValueType } from './contract'
import { CODE_EASE_NAMES } from './motion'
import { parseCodePath } from './geometry'
import { CODE_STYLE_EXPRESSION, isCodeStyleExpression } from './style'
import { codeShaderDefinition, codeShaderParameter, codeShaderFilterPasses, codeShaderTime, staticCodeShaderValue } from './shaders'

export function codeSourceSpan(node: ts.Node): CodeSourceSpan {
  const file = node.getSourceFile(); const start = node.getStart(file); const end = node.getEnd()
  const a = file.getLineAndCharacterOfPosition(start); const b = file.getLineAndCharacterOfPosition(end)
  return { start, end, startLine: a.line + 1, startColumn: a.character + 1, endLine: b.line + 1, endColumn: b.character + 1 }
}
function fail(node: ts.Node, message: string, code: 'SYNTAX' | 'TYPE' | 'BUDGET' | 'NON_FINITE' | 'PARAMETERS' = 'SYNTAX'): never {
  const span = codeSourceSpan(node)
  throw new CodeMaterialError(code, `${message}（${span.startLine}:${span.startColumn}）`, span)
}
function fields(node: ts.ObjectLiteralExpression): Map<string, ts.Expression> {
  const values = new Map<string, ts.Expression>()
  for (const entry of node.properties) {
    if (!ts.isPropertyAssignment(entry) || !ts.isIdentifier(entry.name) && !ts.isStringLiteral(entry.name)) fail(entry, '仅允许静态字段，不允许展开、方法或访问器。')
    const name = entry.name.text; assertCodeMaterialKey(name)
    if (values.has(name)) fail(entry, `重复字段：${name}`)
    values.set(name, entry.initializer)
  }
  return values
}
const numeric = 'x y width height x1 y1 x2 y2 radius rotation scale scaleX scaleY opacity anchorX anchorY strokeWidth trimStart trimEnd blur fontSize fontWeight letterSpacing lineHeight maxWidth maxLines'.split(' ')
const common = 'id opacity rotation scale scaleX scaleY anchorX anchorY blend shadow glow blur'.split(' ')
const stroke = 'stroke strokeWidth lineCap lineJoin dash'.split(' ')
const trim = ['trimStart', 'trimEnd']
const shapeFields: Record<CodeDrawKind, string[]> = {
  rect: [...common, ...stroke, 'x', 'y', 'width', 'height', 'fill', 'radius', 'radii'],
  ellipse: [...common, ...stroke, 'x', 'y', 'width', 'height', 'fill'],
  line: [...common, ...stroke, ...trim, 'x1', 'y1', 'x2', 'y2', 'width', 'color'],
  path: [...common, ...stroke, ...trim, 'd', 'points', 'closed', 'fill'],
  text: [...common, ...stroke, 'x', 'y', 'text', 'fontFamily', 'fontWeight', 'fontStyle', 'fontSize', 'color', 'fill', 'align', 'baseline', 'letterSpacing', 'lineHeight', 'maxWidth', 'wrap', 'maxLines', 'perChar'],
  shader: [...common.filter(key => !['shadow', 'glow', 'blur'].includes(key)), 'name', 'params', 'time', 'x', 'y', 'width', 'height'],
  group: [...common, 'x', 'y', 'clip'], image: [...common, 'source', 'x', 'y', 'width', 'height'],
}
const operators: Partial<Record<ts.SyntaxKind, CodeBinaryOperator>> = {
  [ts.SyntaxKind.PlusToken]: '+', [ts.SyntaxKind.MinusToken]: '-', [ts.SyntaxKind.AsteriskToken]: '*', [ts.SyntaxKind.SlashToken]: '/', [ts.SyntaxKind.PercentToken]: '%',
  [ts.SyntaxKind.LessThanToken]: '<', [ts.SyntaxKind.LessThanEqualsToken]: '<=', [ts.SyntaxKind.GreaterThanToken]: '>', [ts.SyntaxKind.GreaterThanEqualsToken]: '>=',
  [ts.SyntaxKind.EqualsEqualsEqualsToken]: '===', [ts.SyntaxKind.ExclamationEqualsEqualsToken]: '!==', [ts.SyntaxKind.AmpersandAmpersandToken]: '&&', [ts.SyntaxKind.BarBarToken]: '||',
}
const extra = ['shaderFilter', 'repeat', 'linearGradient', 'radialGradient', 'measureText', 'chars', 'words', 'progress', 'tween', 'stagger', 'keyframes', 'cubicBezier', 'noise', 'sampleOffset', 'blur', 'glow', 'luma', 'contrast', 'saturate', 'hsv', 'hsl', 'toHsv', 'toHsl', 'average', ...CODE_EASE_NAMES]
interface Scope { values: Map<string, CodeExpression>; helpers: Map<string, ts.ArrowFunction> }

/** Helper calls are statically inlined into data; arrows never become callable host values. */
export function compileCodeMaterialV3(program: CodeMaterialProgram, file: ts.SourceFile, body: ts.Block, top: readonly ts.Statement[]): CodeMaterialProgram {
  const scope: Scope = { values: new Map(), helpers: new Map() }
  const active = new Set<ts.ArrowFunction>(); const checked = new Set<ts.ArrowFunction>(); let slot = 0; let multiplier = 1; let repeatDepth = 0; let inliningDepth = 0
  const charge = (node: ts.Node, cpu = 1, scalar = 0, samples = 0): void => {
    program.metrics.cpuOperations += cpu * multiplier; program.metrics.scalarOperations += scalar * multiplier; program.metrics.samples += samples * multiplier
    if (program.metrics.cpuOperations > CODE_V3_LIMITS.cpuOperations || program.kind === 'filter' && (program.metrics.scalarOperations > CODE_V3_LIMITS.filterScalarOperations || program.metrics.samples > CODE_V3_LIMITS.filterSamples)) fail(node, '展开后的操作或采样超出 v3 技术预算。', 'BUDGET')
  }
  const type = (node: ts.Node, value: CodeExpression, expected: CodeValueType | CodeValueType[]): void => {
    if (!(Array.isArray(expected) ? expected : [expected]).includes(value.type)) fail(node, `需要 ${expected}，实际 ${value.type}。`, 'TYPE')
  }
  const unwrap = (value: CodeExpression): CodeExpression => value.kind === 'binding' ? unwrap(program.bindings[value.slot].expression) : value
  const bound = (node: ts.Node, value: CodeExpression): number => {
    const expression = unwrap(value)
    if (expression.kind === 'literal' && typeof expression.value === 'number' && Number.isInteger(expression.value) && expression.value >= 0) return expression.value
    if (expression.kind === 'parameter') {
      const parameter = program.parameters.find(item => item.key === expression.key)
      if (parameter?.type === 'number' && parameter.min >= 0 && Number.isInteger(parameter.max)) return parameter.max
    }
    fail(node, 'repeat 次数必须是非负整数常量或具有非负 min 与整数 max 的数值参数。', 'BUDGET')
  }
  const validateShader = (node: ts.Node, name: CodeExpression, params: CodeExpression | undefined, role: 'background' | 'filter'): void => {
    try {
      const definition = codeShaderDefinition(staticCodeShaderValue(program, name), role)
      if (!params) return
      const raw = unwrap(params)
      if (raw.kind !== 'object') fail(node, '着色器 params 必须是静态字段对象。', 'PARAMETERS')
      const frameOnly = (value: CodeExpression): boolean => {
        value = unwrap(value)
        if (value.kind === 'object') return Object.values(value.properties).every(frameOnly)
        if (value.kind === 'context') return !['u', 'v'].includes(value.key)
        if (value.kind === 'local' || value.kind === 'repeat' || value.kind === 'draw' || value.kind === 'draws' || value.kind === 'textAnimation') return false
        if (value.kind === 'call' && value.op === 'sample' || value.kind === 'v3call' && ['sampleOffset', 'shaderFilter', 'blur', 'glow', 'measureText'].includes(value.op)) return false
        for (const item of Object.values(value)) {
          if (Array.isArray(item) && item.some(child => child && typeof child === 'object' && 'kind' in child && !frameOnly(child as CodeExpression))) return false
          if (item && typeof item === 'object' && 'kind' in item && !frameOnly(item as CodeExpression)) return false
        }
        return true
      }
      for (const [key, value] of Object.entries(raw.properties)) {
        const param = definition.params.find(param => param.key === key)
        if (!param) codeShaderParameter(definition, key, undefined)
        type(node, value, param!.type === 'color' ? 'color' : 'number')
        if (role === 'filter' && !frameOnly(value)) fail(node, 'shaderFilter 参数只能使用帧级表达式，不能采样输入或读取 ctx.u/v。', 'TYPE')
        const literal = staticCodeShaderValue(program, value)
        if (literal !== undefined) codeShaderParameter(definition, key, literal)
      }
    } catch (error) { if (error instanceof CodeMaterialError) fail(node, error.message, error.code as 'PARAMETERS'); throw error }
  }
  const arrowParams = (arrow: ts.ArrowFunction): string[] => {
    if (arrow.modifiers?.length || arrow.type || arrow.typeParameters?.length || arrow.equalsGreaterThanToken.kind !== ts.SyntaxKind.EqualsGreaterThanToken) fail(arrow, '仅允许纯箭头函数。')
    return arrow.parameters.map(parameter => {
      if (!ts.isIdentifier(parameter.name) || parameter.type || parameter.initializer || parameter.dotDotDotToken || parameter.questionToken || parameter.modifiers?.length) fail(parameter, '函数参数必须是未注解的名称。')
      assertCodeMaterialKey(parameter.name.text)
      if (parameter.name.text === 'ctx' || CODE_BUILTINS.includes(parameter.name.text as CodeBuiltin) || extra.includes(parameter.name.text) || parameter.name.text in shapeFields) fail(parameter, '函数参数不能遮蔽保留名称。')
      return parameter.name.text
    })
  }
  const invoke = (arrow: ts.ArrowFunction, args: CodeExpression[], parent: Scope): CodeExpression => {
    if (active.has(arrow)) fail(arrow, '不允许递归或互相递归。')
    if (++inliningDepth > 16) fail(arrow, '纯函数展开深度超过 16。', 'BUDGET')
    const names = arrowParams(arrow)
    if (new Set(names).size !== names.length || names.length !== args.length || names.includes('ctx')) fail(arrow, '函数参数数量不匹配、重复或遮蔽 ctx。')
    const inner: Scope = { values: new Map(parent.values), helpers: new Map(parent.helpers) }
    names.forEach((name, index) => inner.values.set(name, args[index])); active.add(arrow)
    const result = ts.isBlock(arrow.body) ? block(arrow.body.statements, inner) : compile(arrow.body, inner)
    active.delete(arrow); checked.add(arrow); inliningDepth--; return result
  }
  const compile = (node: ts.Expression, env: Scope): CodeExpression => {
    charge(node)
    if (ts.isParenthesizedExpression(node)) return compile(node.expression, env)
    if (ts.isNumericLiteral(node)) return { kind: 'literal', type: 'number', value: finiteCodeNumber(Number(node.text), '源码数字') }
    if (ts.isStringLiteral(node)) {
      if (node.text.length > 4096) fail(node, '字符串超过 4096 UTF-16 单元。', 'BUDGET')
      return { kind: 'literal', type: 'string', value: node.text }
    }
    if (node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword) return { kind: 'literal', type: 'boolean', value: node.kind === ts.SyntaxKind.TrueKeyword }
    if (ts.isIdentifier(node)) { const result = env.values.get(node.text); if (!result) fail(node, `未声明或禁止的名称：${node.text}`); return result }
    if (ts.isPropertyAccessExpression(node) && !node.questionDotToken) {
      const key = node.name.text; assertCodeMaterialKey(key)
      if (ts.isIdentifier(node.expression) && node.expression.text === 'ctx') {
        if (key === 'style') return CODE_STYLE_EXPRESSION
        if (!CODE_CONTEXT_KEYS.includes(key as CodeContextKey) || program.kind !== 'filter' && ['u', 'v'].includes(key) || program.mode === 'static' && CODE_TIME_KEYS.includes(key as CodeContextKey)) fail(node, `不允许 ctx.${key}。`)
        return { kind: 'context', type: 'number', key: key as CodeContextKey }
      }
      if (ts.isPropertyAccessExpression(node.expression) && !node.expression.questionDotToken && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === 'ctx' && node.expression.name.text === 'params') {
        const parameter = program.parameters.find(item => item.key === key)
        if (!parameter) fail(node, `未声明参数：${key}`)
        const valueType: CodeValueType = parameter.type === 'choice' || parameter.type === 'text' ? 'string' : parameter.type
        if (program.kind === 'filter' && ['string', 'image'].includes(valueType)) fail(node, '滤镜不能读取文字或图片参数。', 'TYPE')
        return { kind: 'parameter', type: valueType, key }
      }
      const value = compile(node.expression, env)
      if (value.type === 'color') {
        const index = ['r', 'g', 'b', 'a'].indexOf(key); if (index < 0) fail(node, '颜色仅可读 r/g/b/a。')
        return { kind: 'component', type: 'number', value, index: index as 0 | 1 | 2 | 3 }
      }
      if (key === 'length' && ['array', 'string', 'draws'].includes(value.type)) return { kind: 'field', type: 'number', value, key }
      type(node, value, 'object')
      const raw = unwrap(value)
      const member = raw.kind === 'object' ? raw.properties[key] : undefined
      if (!member && !(raw.kind === 'v3call' && raw.op === 'measureText' && ['width', 'height', 'lines'].includes(key))) fail(node, `未知对象字段：${key}`)
      if (member && isCodeStyleExpression(member)) return member
      return { kind: 'field', type: member?.type ?? (key === 'lines' ? 'array' : 'number'), value, key }
    }
    if (ts.isElementAccessExpression(node) && !node.questionDotToken && node.argumentExpression) {
      const value = compile(node.expression, env); const index = compile(node.argumentExpression, env); type(node, index, 'number')
      type(node, value, ['array', 'color', 'string'])
      const raw = unwrap(value)
      const member = raw.kind === 'array' || raw.kind === 'color' ? raw.values : undefined
      if (member && new Set(member.map(item => item.type)).size > 1) fail(node, '只允许索引同类型常量表。', 'TYPE')
      return { kind: 'index', type: value.type === 'color' ? 'number' : value.type === 'string' ? 'string' : member?.[0]?.type ?? 'string', value, index }
    }
    if (ts.isPrefixUnaryExpression(node)) {
      const op = node.operator === ts.SyntaxKind.PlusToken ? '+' : node.operator === ts.SyntaxKind.MinusToken ? '-' : node.operator === ts.SyntaxKind.ExclamationToken ? '!' : undefined
      if (!op) fail(node, '禁止此一元操作。')
      const value = compile(node.operand, env); type(node, value, op === '!' ? 'boolean' : 'number'); charge(node, 0, 1)
      return { kind: 'unary', type: value.type, op, value }
    }
    if (ts.isBinaryExpression(node)) {
      const op = operators[node.operatorToken.kind]; if (!op) fail(node, '禁止赋值或此二元操作。')
      const left = compile(node.left, env); const right = compile(node.right, env)
      if (['===', '!=='].includes(op)) { type(node, left, ['number', 'boolean', 'string']); type(node, right, left.type) }
      else { type(node, left, ['&&', '||'].includes(op) ? 'boolean' : 'number'); type(node, right, left.type) }
      if (['/', '%'].includes(op) && right.kind === 'literal' && right.value === 0) fail(node, '除数不能为零。', 'NON_FINITE')
      charge(node, codeBinaryCost(op) - 1, codeBinaryCost(op))
      return { kind: 'binary', type: ['+', '-', '*', '/', '%'].includes(op) ? 'number' : 'boolean', op, left, right }
    }
    if (ts.isConditionalExpression(node)) {
      const condition = compile(node.condition, env); type(node, condition, 'boolean')
      const yes = compile(node.whenTrue, env); const no = compile(node.whenFalse, env); type(node, no, yes.type)
      charge(node, 0, yes.type === 'color' ? 4 : 1); return { kind: 'conditional', type: yes.type, condition, yes, no }
    }
    if (ts.isArrayLiteralExpression(node)) {
      if (node.elements.length > CODE_V3_LIMITS.draws) fail(node, '数组长度超过本帧技术预算。', 'BUDGET')
      const values = node.elements.map(item => compile(item, env))
      const valueType = values.length === 4 && values.every(item => item.type === 'number') ? 'color' : values.every(item => ['draw', 'draws'].includes(item.type)) ? 'draws' : 'array'
      return { kind: valueType === 'color' ? 'color' : valueType === 'draws' ? 'draws' : 'array', type: valueType, values }
    }
    if (ts.isObjectLiteralExpression(node)) return { kind: 'object', type: 'object', properties: Object.fromEntries([...fields(node)].map(([key, value]) => [key, compile(value, env)])) }
    if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression) || node.questionDotToken || node.typeArguments?.length) fail(node, `禁止语法：${ts.SyntaxKind[node.kind]}`)
    const op = node.expression.text
    const helper = env.helpers.get(op)
    if (helper) return invoke(helper, node.arguments.map(item => compile(item, env)), env)
    if (op === 'repeat') {
      if (node.arguments.length !== 2 || !ts.isArrowFunction(node.arguments[1])) fail(node, 'repeat(count, i => expression) 需要纯箭头函数。')
      const count = compile(node.arguments[0], env); type(node, count, 'number'); const max = bound(node.arguments[0], count)
      if (max > CODE_V3_LIMITS.draws || ++repeatDepth > CODE_V3_LIMITS.repeatDepth) fail(node, 'repeat 次数超过 4096 或嵌套深度超过 4。', 'BUDGET')
      const localSlot = slot++; const before = multiplier; multiplier *= max
      const result = invoke(node.arguments[1], [{ kind: 'local', type: 'number', slot: localSlot }], env)
      multiplier = before; repeatDepth--
      return { kind: 'repeat', type: ['draw', 'draws'].includes(result.type) ? 'draws' : 'array', count, max, slot: localSlot, body: result }
    }
    if (Object.prototype.hasOwnProperty.call(shapeFields, op)) {
      if (program.kind !== 'generator' || node.arguments.length !== (op === 'group' ? 2 : 1) || !ts.isObjectLiteralExpression(node.arguments[0])) fail(node, '图形需要静态字段对象；group 还需要 children 数组。')
      const shape = op as CodeDrawKind; const properties: Record<string, CodeExpression> = {}
      const inputs = fields(node.arguments[0])
      for (const [key, input] of inputs) {
        if (!shapeFields[shape].includes(key)) fail(input, `未知 ${shape} 字段：${key}`)
        if (key === 'perChar') {
          if (!ts.isArrowFunction(input)) fail(input, 'perChar 必须是 (i,n) => 变换对象。')
          const textInput = inputs.get('text')
          const textExpression = textInput ? unwrap(compile(textInput, env)) : undefined
          const textParameter = textExpression?.kind === 'parameter' ? program.parameters.find(item => item.key === textExpression.key) : undefined
          const maxCharacters = textExpression?.kind === 'literal' && typeof textExpression.value === 'string' ? textExpression.value.length : textParameter?.type === 'text' ? textParameter.maxLength : 4096
          const localSlot = slot++; const countSlot = slot++; const before = multiplier; multiplier *= maxCharacters
          const result = invoke(input, [{ kind: 'local', type: 'number', slot: localSlot }, { kind: 'local', type: 'number', slot: countSlot }], env); multiplier = before
          type(input, result, 'object')
          const transform = unwrap(result)
          if (transform.kind !== 'object' || Object.keys(transform.properties).some(key => !['x', 'y', 'opacity', 'scale', 'rotation'].includes(key))) fail(input, 'perChar 仅允许 x/y/opacity/scale/rotation。', 'TYPE')
          Object.values(transform.properties).forEach(value => type(input, value, 'number'))
          properties[key] = { kind: 'textAnimation', type: 'object', slot: localSlot, countSlot, body: result }; continue
        }
        const value = compile(input, env)
        if (numeric.includes(key) || shape === 'shader' && key === 'time') type(input, value, 'number')
        else if (['fill', 'color', 'stroke'].includes(key)) type(input, value, ['color', 'paint'])
        else if (['closed', 'wrap'].includes(key)) type(input, value, 'boolean')
        else if (['shadow', 'glow', 'clip', 'params'].includes(key)) type(input, value, 'object')
        else if (['points', 'dash', 'radii'].includes(key)) type(input, value, ['array', 'color'])
        else if (key === 'source') type(input, value, 'image')
        else type(input, value, 'string')
        properties[key] = value
      }
      const required = shape === 'group' ? [] : shape === 'path' ? [] : shape === 'line' ? ['x1', 'y1', 'x2', 'y2'] : shape === 'text' ? ['x', 'y', 'text', 'fontSize'] : ['x', 'y', 'width', 'height']
      if (required.some(key => !properties[key]) || shape === 'image' && !properties.source || shape === 'path' && (!properties.d === !properties.points)) fail(node, `${shape} 缺少字段，或 path 未选择唯一的 d/points。`)
      if (properties.id && (properties.id.kind !== 'literal' || typeof properties.id.value !== 'string' || !properties.id.value || properties.id.value.length > 160)) fail(node, 'id 必须是 1–160 字的静态字符串。')
      if (properties.d) {
        const d = unwrap(properties.d)
        if (d.kind === 'literal' && typeof d.value === 'string') {
          try { parseCodePath(d.value) } catch (error) { if (error instanceof CodeMaterialError) fail(inputs.get('d')!, error.message, error.code === 'BUDGET' ? 'BUDGET' : 'SYNTAX'); throw error }
        }
      }
      if (shape === 'shader') {
        if (!properties.name) fail(node, 'shader 缺少 name。', 'PARAMETERS')
        validateShader(node, properties.name, properties.params, 'background')
        properties.params ??= { kind: 'object', type: 'object', properties: {} }
        if (!properties.time) {
          if (program.mode === 'static') fail(node, '静态着色器须显式提供固定 time。', 'TYPE')
          properties.time = { kind: 'context', type: 'number', key: 'time' }
        }
        const time = staticCodeShaderValue(program, properties.time)
        if (time !== undefined) { try { codeShaderTime(time) } catch (error) { if (error instanceof CodeMaterialError) fail(node, error.message, 'NON_FINITE'); throw error } }
      }
      const children = shape === 'group' ? compile(node.arguments[1], env) : undefined
      if (children) type(node, children, 'draws')
      return { kind: 'draw', type: 'draw', shape, properties, children, sourceSpan: codeSourceSpan(node) }
    }
    if (op === 'shaderFilter') {
      if (program.kind !== 'filter' || ![2, 3].includes(node.arguments.length)) fail(node, 'shaderFilter(name, params, 可选shaderFilter) 仅用于滤镜。', 'TYPE')
      const args = node.arguments.map(item => compile(item, env))
      validateShader(node, args[0], args[1], 'filter')
      if (args[2]) type(node, args[2], 'color')
      return { kind: 'v3call', type: 'color', op, args, sourceSpan: codeSourceSpan(node) }
    }
    if (!CODE_BUILTINS.includes(op as CodeBuiltin) && !extra.includes(op)) fail(node, `不允许调用：${op}`)
    const args = node.arguments.map(item => compile(item, env))
    const arity: Record<string, number[]> = { min: [2], max: [2], sample: [2], clamp: [3], mix: [3], smoothstep: [3], rgba: [4], noise: [1, 2, 3], cubicBezier: [5], progress: [3], tween: [6], stagger: [2], keyframes: [2], sampleOffset: [2], glow: [3], contrast: [2], saturate: [2], hsv: [3, 4], hsl: [3, 4], backOut: [1, 2] }
    if (!(arity[op] ?? [1]).includes(args.length)) fail(node, `${op} 参数数量无效。`)
    let resultType: CodeValueType = 'number'
    if (['linearGradient', 'radialGradient'].includes(op)) {
      type(node, args[0], 'object'); resultType = 'paint'
      const raw = unwrap(args[0]); const stops = raw.kind === 'object' ? raw.properties.stops : undefined
      const table = stops && unwrap(stops)
      if (!table || table.kind !== 'array' || table.values.length < 2 || table.values.length > CODE_V3_LIMITS.gradientStops) fail(node, '渐变 stops 必须是 2–8 项静态数组。', 'BUDGET')
    } else if (op === 'measureText') { type(node, args[0], 'object'); resultType = 'object'; charge(node, 4096) }
    else if (['chars', 'words'].includes(op)) { type(node, args[0], 'string'); resultType = 'array'; charge(node, 4096) }
    else if (op === 'average') { type(node, args[0], 'array'); resultType = 'color'; charge(node, 4, 4) }
    else if (['sample', 'sampleOffset', 'blur', 'glow'].includes(op)) {
      if (program.kind !== 'filter') fail(node, `${op} 仅用于单输入滤镜。`)
      args.forEach(arg => type(node, arg, 'number')); resultType = 'color'; charge(node, 1, 1, op === 'blur' ? 13 : op === 'glow' ? 14 : 1)
    } else if (['toHsv', 'toHsl', 'luma', 'contrast', 'saturate'].includes(op)) {
      type(node, args[0], 'color'); if (args[1]) type(node, args[1], 'number'); resultType = op === 'luma' ? 'number' : 'color'; charge(node, 32, 32)
    } else if (op === 'keyframes') { type(node, args[0], 'number'); type(node, args[1], 'array'); charge(node, 256, 256) }
    else if (op === 'tween') {
      args.slice(0, 3).forEach(arg => type(node, arg, 'number')); type(node, args[3], ['number', 'color']); type(node, args[4], args[3].type); type(node, args[5], 'string'); resultType = args[3].type; charge(node, 64, 64)
    } else if (['mix', 'clamp'].includes(op)) { resultType = args[0].type; type(node, args[0], ['number', 'color']); type(node, args[1], op === 'mix' ? resultType : 'number'); type(node, args[2], 'number') }
    else { args.forEach(arg => type(node, arg, 'number')); if (['rgba', 'hsv', 'hsl'].includes(op)) resultType = 'color' }
    if (CODE_BUILTINS.includes(op as CodeBuiltin)) {
      const cost = codeBuiltinCost(op as CodeBuiltin, resultType); charge(node, cost.cpu, cost.scalar)
      return { kind: 'call', type: resultType, op: op as CodeBuiltin, args }
    }
    charge(node, CODE_EASE_NAMES.includes(op) || ['cubicBezier', 'noise'].includes(op) ? 64 : 1)
    return { kind: 'v3call', type: resultType, op, args, sourceSpan: codeSourceSpan(node) }
  }
  const declarations = (statements: readonly ts.Statement[], env: Scope): void => {
    for (const statement of statements) {
      if (!ts.isVariableStatement(statement) || statement.modifiers?.length || statement.declarationList.flags !== ts.NodeFlags.Const) fail(statement, '仅允许 const 声明。')
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer || declaration.type || declaration.exclamationToken) fail(declaration, 'const 需要未注解的名称与纯表达式。')
        const name = declaration.name.text; assertCodeMaterialKey(name)
        if (name === 'ctx' || env.values.has(name) || env.helpers.has(name) || CODE_BUILTINS.includes(name as CodeBuiltin) || extra.includes(name) || name in shapeFields) fail(declaration, `重复或保留名称：${name}`)
        if (ts.isArrowFunction(declaration.initializer)) { arrowParams(declaration.initializer); env.helpers.set(name, declaration.initializer) }
        else {
          const expression = compile(declaration.initializer, env)
          // Inside helper expansion preserve lexical values; only render/top consts have frame bindings.
          if (inliningDepth) env.values.set(name, expression)
          else { const index = program.bindings.length; program.bindings.push({ name, expression }); env.values.set(name, { kind: 'binding', type: expression.type, slot: index }) }
        }
      }
    }
  }
  const block = (statements: readonly ts.Statement[], env: Scope): CodeExpression => {
    const last = statements.at(-1)
    if (!last || !ts.isReturnStatement(last) || !last.expression) fail(body, '函数体必须以 return 表达式结束。')
    declarations(statements.slice(0, -1), env); return compile(last.expression, env)
  }
  declarations(top, scope); program.result = block(body.statements, scope)
  type(body, program.result, program.kind === 'generator' ? 'draws' : 'color')
  const drawCount = (input: CodeExpression): number => {
    const value = unwrap(input)
    if (value.kind === 'draw') {
      if (value.shape === 'text' && value.properties.perChar) {
        const text = unwrap(value.properties.text); const parameter = text.kind === 'parameter' ? program.parameters.find(item => item.key === text.key) : undefined
        return Math.max(1, text.kind === 'literal' && typeof text.value === 'string' ? Array.from(text.value).length : parameter?.type === 'text' ? parameter.maxLength : 4096)
      }
      return 1 + (value.children ? drawCount(value.children) : 0)
    }
    if (value.kind === 'draws') return value.values.reduce((sum, child) => sum + drawCount(child), 0)
    if (value.kind === 'repeat') return value.max * drawCount(value.body)
    if (value.kind === 'conditional') return Math.max(drawCount(value.yes), drawCount(value.no))
    return 0
  }
  const shaderCount = (input: CodeExpression): number => {
    const value = unwrap(input)
    if (value.kind === 'draw') return Number(value.shape === 'shader') + (value.children ? shaderCount(value.children) : 0)
    if (value.kind === 'draws') return value.values.reduce((sum, value) => sum + shaderCount(value), 0)
    if (value.kind === 'repeat') return value.max * shaderCount(value.body)
    if (value.kind === 'conditional') return Math.max(shaderCount(value.yes), shaderCount(value.no))
    return 0
  }
  if (shaderCount(program.result) > CODE_V3_LIMITS.shaderLayers) fail(body, `每帧最多 ${CODE_V3_LIMITS.shaderLayers} 个着色器层。`, 'BUDGET')
  if (program.kind === 'filter') codeShaderFilterPasses(program)
  program.metrics.draws = drawCount(program.result)
  if (program.metrics.draws > CODE_V3_LIMITS.draws) fail(body, '重复展开后图形超过 4096 项。', 'BUDGET')
  // Unused helpers are checked too: no dormant host access is accepted.
  for (const helper of scope.helpers.values()) if (!checked.has(helper)) {
    const names = arrowParams(helper)
    invoke(helper, names.map(() => ({ kind: 'literal', type: 'number', value: 0 })), scope)
  }
  const costs = new WeakMap<CodeExpression, number>()
  const heights = new WeakMap<CodeExpression, number>()
  const height = (value: CodeExpression): number => {
    const cached = heights.get(value); if (cached !== undefined) return cached
    const children: CodeExpression[] = []
    for (const item of Object.values(value)) {
      if (Array.isArray(item)) item.forEach(child => { if (child && typeof child === 'object' && 'kind' in child) children.push(child as CodeExpression) })
      else if (item && typeof item === 'object' && 'kind' in item) children.push(item as CodeExpression)
    }
    if (value.kind === 'draw' || value.kind === 'object') children.push(...Object.values(value.properties))
    const result = 1 + Math.max(0, ...children.map(height)); heights.set(value, result); return result
  }
  if ([program.result, ...program.bindings.map(binding => binding.expression)].some(value => height(value) > CODE_V3_LIMITS.depth)) fail(body, '纯函数展开后的 IR 深度超过 64。', 'BUDGET')
  const work = (value: CodeExpression): number => {
    const cached = costs.get(value); if (cached !== undefined) return cached
    let result = 1
    if (value.kind === 'repeat') result += work(value.count) + value.max * work(value.body)
    else if (value.kind === 'textAnimation') result += 4096 * work(value.body)
    else if (value.kind === 'draw') {
      if (value.shape === 'path') {
        const d = value.properties.d && unwrap(value.properties.d); const points = value.properties.points && unwrap(value.properties.points)
        const count = d?.kind === 'literal' && typeof d.value === 'string' ? parseCodePath(d.value).reduce((sum, path) => sum + path.length, 0) : points?.kind === 'array' ? points.values.length : points?.kind === 'repeat' ? points.max : CODE_V3_LIMITS.pathPoints
        result += (count + Number(!!value.properties.closed)) * 4
      }
      if (value.shape === 'text') {
        const text = value.properties.text && unwrap(value.properties.text); const parameter = text?.kind === 'parameter' ? program.parameters.find(p => p.key === text.key) : undefined
        const length = text?.kind === 'literal' && typeof text.value === 'string' ? text.value.length : parameter?.type === 'text' ? parameter.maxLength : 4096
        result += length * (value.properties.maxLines ? 32 : 2)
      }
      for (const [key, child] of Object.entries(value.properties)) {
        if (key === 'perChar' && child.kind === 'textAnimation') {
          const text = value.properties.text && unwrap(value.properties.text); const parameter = text?.kind === 'parameter' ? program.parameters.find(p => p.key === text.key) : undefined
          const length = text?.kind === 'literal' && typeof text.value === 'string' ? text.value.length : parameter?.type === 'text' ? parameter.maxLength : 4096
          result += length * work(child.body)
        } else result += work(child)
      }
      if (value.children) result += work(value.children)
    } else {
      for (const item of Object.values(value)) {
        if (Array.isArray(item)) item.forEach(child => { if (child && typeof child === 'object' && 'kind' in child) result += work(child as CodeExpression) })
        else if (item && typeof item === 'object' && 'kind' in item) result += work(item as CodeExpression)
      }
      if (value.kind === 'object') Object.values(value.properties).forEach(child => { result += work(child) })
      if (value.kind === 'call') result += codeBuiltinCost(value.op, value.type).cpu
      if (value.kind === 'v3call') {
        if (value.op === 'measureText') {
          const fields = unwrap(value.args[0]); const text = fields.kind === 'object' && fields.properties.text ? unwrap(fields.properties.text) : undefined
          const parameter = text?.kind === 'parameter' ? program.parameters.find(item => item.key === text.key) : undefined
          const length = text?.kind === 'literal' && typeof text.value === 'string' ? text.value.length : parameter?.type === 'text' ? parameter.maxLength : 4096
          result += length * (fields.kind === 'object' && fields.properties.maxLines ? 32 : 2) + 64
        } else result += CODE_EASE_NAMES.includes(value.op) || ['noise', 'tween', 'cubicBezier'].includes(value.op) ? 64 : 1
      }
    }
    costs.set(value, result); return result
  }
  const operations = program.bindings.reduce((sum, binding) => sum + work(binding.expression), 0) + work(program.result)
  program.metrics.cpuOperations = Math.max(program.metrics.cpuOperations, operations)
  if (operations > CODE_V3_LIMITS.cpuOperations) fail(body, '纯函数展开后的逐帧工作量超出 CPU 预算。', 'BUDGET')
  if (program.kind === 'filter') {
    const memo = new WeakMap<CodeExpression, { scalar: number; samples: number }>()
    const cost = (value: CodeExpression): { scalar: number; samples: number } => {
      const cached = memo.get(value); if (cached) return cached
      if (value.kind === 'binding') return value.type === 'array' ? cost(program.bindings[value.slot].expression) : { scalar: 0, samples: 0 }
      const result = { scalar: 0, samples: 0 }
      const add = (child: CodeExpression, multiplier = 1): void => { const next = cost(child); result.scalar += next.scalar * multiplier; result.samples += next.samples * multiplier }
      if (value.kind === 'repeat') { add(value.count); add(value.body, value.max) }
      else for (const item of Object.values(value)) {
        if (Array.isArray(item)) item.forEach(child => { if (child && typeof child === 'object' && 'kind' in child) add(child as CodeExpression) })
        else if (item && typeof item === 'object' && 'kind' in item) add(item as CodeExpression)
      }
      if (value.kind === 'binary') result.scalar += codeBinaryCost(value.op)
      if (value.kind === 'unary') result.scalar++
      if (value.kind === 'conditional') result.scalar += value.type === 'color' ? 4 : 1
      if (value.kind === 'call') { result.scalar += codeBuiltinCost(value.op, value.type).scalar; if (value.op === 'sample') result.samples++ }
      if (value.kind === 'v3call') {
        const op = value.op
        result.scalar += op === 'noise' ? 256 : op === 'cubicBezier' ? 512 : CODE_EASE_NAMES.includes(op) || op === 'tween' ? 96 : ['hsv', 'hsl', 'toHsv', 'toHsl'].includes(op) ? 96 : op === 'average' ? 256 : op === 'keyframes' ? 1024 : 32
        result.samples += op === 'blur' ? 13 : op === 'glow' ? 14 : ['sampleOffset', 'shaderFilter'].includes(op) ? 1 : 0
      }
      memo.set(value, result); return result
    }
    const total = cost(program.result)
    for (const binding of program.bindings) if (binding.expression.type !== 'array') { const next = cost(binding.expression); total.scalar += next.scalar; total.samples += next.samples }
    program.metrics.samples = Math.max(program.metrics.samples, total.samples); program.metrics.scalarOperations = Math.max(program.metrics.scalarOperations, total.scalar)
    if (program.metrics.samples > CODE_V3_LIMITS.filterSamples || program.metrics.scalarOperations > CODE_V3_LIMITS.filterScalarOperations) fail(body, '纯函数与数组展开后的滤镜采样或标量工作超出预算。', 'BUDGET')
  }
  return program
}
