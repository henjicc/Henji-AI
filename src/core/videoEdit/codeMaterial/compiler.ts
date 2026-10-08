import { VIDEO_EDIT_MAX_SEQUENCE_SECONDS } from '../time'
import ts from 'typescript'
import { CODE_BUILTINS, CODE_CONTEXT_KEYS, CODE_MATERIAL_LIMITS, CODE_V3_LIMITS, CODE_TIME_KEYS, CodeMaterialError, assertCodeMaterialKey, codeBinaryCost, codeBuiltinCost, codeConditionalCost, finiteCodeNumber } from './contract'
import type { CodeBinaryOperator, CodeBuiltin, CodeContextKey, CodeDrawKind, CodeExpression, CodeMaterialProgram, CodeValueType } from './contract'
import { parseCodeMaterialParameters } from './parameters'
import { parseCodeMaterialTypes } from './parameterTypes'
import { codeSourceSpan, compileCodeMaterialV3 } from './compilerV3'
import { shaderGraphCustomShaderSchema, type ShaderGraphCustomShader } from '../shaderGraph/spec'

const shapeFields: Record<Exclude<CodeDrawKind, 'group' | 'path' | 'shader'>, Record<string, CodeValueType>> = {
  rect: { x: 'number', y: 'number', width: 'number', height: 'number', fill: 'color', radius: 'number' },
  ellipse: { x: 'number', y: 'number', width: 'number', height: 'number', fill: 'color' },
  line: { x1: 'number', y1: 'number', x2: 'number', y2: 'number', width: 'number', color: 'color' },
  text: { x: 'number', y: 'number', text: 'string', fontSize: 'number', color: 'color', fontFamily: 'string', align: 'string' },
  image: { source: 'image', x: 'number', y: 'number', width: 'number', height: 'number', opacity: 'number' },
}
const optionalShapeFields = new Set(['radius', 'fontFamily', 'align', 'opacity'])
const binaryOperators = new Map<ts.SyntaxKind, CodeBinaryOperator>([
  [ts.SyntaxKind.PlusToken, '+'], [ts.SyntaxKind.MinusToken, '-'], [ts.SyntaxKind.AsteriskToken, '*'], [ts.SyntaxKind.SlashToken, '/'], [ts.SyntaxKind.PercentToken, '%'],
  [ts.SyntaxKind.LessThanToken, '<'], [ts.SyntaxKind.LessThanEqualsToken, '<='], [ts.SyntaxKind.GreaterThanToken, '>'], [ts.SyntaxKind.GreaterThanEqualsToken, '>='],
  [ts.SyntaxKind.EqualsEqualsEqualsToken, '==='], [ts.SyntaxKind.ExclamationEqualsEqualsToken, '!=='], [ts.SyntaxKind.AmpersandAmpersandToken, '&&'], [ts.SyntaxKind.BarBarToken, '||'],
])
function fail(node: ts.Node, message: string, code: 'SYNTAX' | 'TYPE' | 'BUDGET' = 'SYNTAX'): never {
  const file = node.getSourceFile(); const position = file.getLineAndCharacterOfPosition(node.getStart(file))
  throw new CodeMaterialError(code, `${message}（${position.line + 1}:${position.character + 1}）`, codeSourceSpan(node))
}
function propertyName(node: ts.PropertyName): string {
  if (!ts.isIdentifier(node) && !ts.isStringLiteral(node)) return fail(node, '字段必须使用静态名称。')
  assertCodeMaterialKey(node.text); return node.text
}
function objectProperties(node: ts.ObjectLiteralExpression): Map<string, ts.Expression> {
  const result = new Map<string, ts.Expression>()
  for (const item of node.properties) {
    if (!ts.isPropertyAssignment(item)) fail(item, '仅允许静态属性，不允许展开、简写、方法或访问器。')
    const key = propertyName(item.name)
    if (result.has(key)) fail(item, `重复字段：${key}`)
    result.set(key, item.initializer)
  }
  return result
}
function staticValue(node: ts.Expression): unknown {
  if (node.kind === ts.SyntaxKind.NullKeyword) return null
  if (ts.isStringLiteral(node)) { if (node.text.length > CODE_MATERIAL_LIMITS.stringLength) fail(node, '静态文本超出长度限制。'); return node.text }
  if (ts.isNumericLiteral(node)) return finiteCodeNumber(Number(node.text), '源码数字')
  if (node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword) return node.kind === ts.SyntaxKind.TrueKeyword
  if (ts.isPrefixUnaryExpression(node) && (node.operator === ts.SyntaxKind.MinusToken || node.operator === ts.SyntaxKind.PlusToken) && ts.isNumericLiteral(node.operand)) return finiteCodeNumber((node.operator === ts.SyntaxKind.MinusToken ? -1 : 1) * Number(node.operand.text), '源码数字')
  if (ts.isArrayLiteralExpression(node)) return node.elements.map(item => staticValue(item))
  if (ts.isObjectLiteralExpression(node)) return Object.fromEntries([...objectProperties(node)].map(([key, value]) => [key, staticValue(value)]))
  return fail(node, '元数据和参数声明必须是静态字面量。')
}
/**
 * `shaders: { 名字: { kind, props?, wgsl, speedProp?, description? } }`：作者自己写的着色器。
 * WGSL 可写成多行模板字符串（不能有 ${} 插值）；是数据，不在 CPU 上执行，GPU 编译时校验。
 */
function parseCodeMaterialShaders(node: ts.Expression): ShaderGraphCustomShader[] {
  if (!ts.isObjectLiteralExpression(node)) fail(node, 'shaders 必须是 { 名字: 定义 } 的静态对象。')
  const wgslText = (value: ts.Expression): string => {
    if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) return value.text
    return fail(value, 'wgsl 必须是字符串或不带 ${} 插值的模板字符串。')
  }
  return [...objectProperties(node)].map(([name, definition]) => {
    if (!ts.isObjectLiteralExpression(definition)) fail(definition, `着色器 ${name} 的定义必须是静态对象。`)
    const fields = objectProperties(definition)
    const raw: Record<string, unknown> = { name }
    for (const [key, value] of fields) {
      if (key === 'sourceLine') fail(value, 'sourceLine 由宿主填写。')
      raw[key] = key === 'wgsl' ? wgslText(value) : staticValue(value)
      // 引号/反引号后第一个字符所在行 = wgsl 第 1 行。
      if (key === 'wgsl') raw.sourceLine = value.getSourceFile().getLineAndCharacterOfPosition(value.getStart() + 1).line + 1
    }
    const parsed = shaderGraphCustomShaderSchema.safeParse(raw)
    if (!parsed.success) fail(definition, `着色器 ${name} 定义无效：${parsed.error.issues.map(issue => `${issue.path.join('.') || '定义'} ${issue.message}`).join('；')}。字段：kind（generator|filter）、props（可选，{名: {type?, default, min?, max?}}）、wgsl（返回 vec4f 的函数体）、speedProp、description。`)
    return parsed.data
  })
}
function staticString(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || !value.length || value.length > max) throw new CodeMaterialError('SYNTAX', `${label}必须是长度不超过 ${max} 的非空文本。`)
  return value
}
function staticNumber(value: unknown, label: string, min: number, max: number, integer = false): number {
  const number = finiteCodeNumber(value, label)
  if (number < min || number > max || (integer && !Number.isInteger(number))) throw new CodeMaterialError('SYNTAX', `${label}超出允许范围。`)
  return number
}
function astBudget(file: ts.SourceFile): { astNodes: number; astDepth: number } {
  const stack = [{ node: file as ts.Node, depth: 0 }]; let astNodes = 0; let astDepth = 0
  while (stack.length) {
    const current = stack.pop()!; astNodes++; astDepth = Math.max(astDepth, current.depth)
    if (astNodes > CODE_V3_LIMITS.astNodes || astDepth > CODE_MATERIAL_LIMITS.depth) fail(current.node, '源码 AST 数量或深度超出预算。', 'BUDGET')
    ts.forEachChild(current.node, child => { stack.push({ node: child, depth: current.depth + 1 }) })
  }
  return { astNodes, astDepth }
}
function ensureType(node: ts.Node, expression: CodeExpression, expected: CodeValueType): void { if (expression.type !== expected) fail(node, `需要 ${expected}，实际为 ${expression.type}。`, 'TYPE') }

/** Parse TypeScript syntax only; no emitted JavaScript is ever executed. Unknown syntax fails closed. */
export function compileCodeMaterial(source: string): CodeMaterialProgram {
  if (typeof source !== 'string' || source.length > CODE_MATERIAL_LIMITS.sourceBytes || new TextEncoder().encode(source).byteLength > CODE_MATERIAL_LIMITS.sourceBytes) throw new CodeMaterialError('SOURCE_LIMIT', '源码最多 64 KiB。')
  let file: ts.SourceFile
  try { file = ts.createSourceFile('material.ts', source, ts.ScriptTarget.ES2020, true, ts.ScriptKind.TS) } catch { throw new CodeMaterialError('SYNTAX', '源码无法解析或嵌套过深。') }
  const diagnostics = (file as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics
  if (diagnostics.length) {
    const diagnostic = diagnostics[0]; const position = file.getLineAndCharacterOfPosition(diagnostic.start ?? 0)
    throw new CodeMaterialError('SYNTAX', `源码语法无效：${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}（${position.line + 1}:${position.character + 1}）`)
  }
  const ast = astBudget(file)
  const exported = file.statements.at(-1)
  if (!exported || !ts.isExportAssignment(exported) || exported.isExportEquals || !ts.isObjectLiteralExpression(exported.expression)) fail(file, '源码必须以 export default 静态对象结束。')
  const definition = exported.expression
  const metadata = new Map<string, ts.Expression>(); let render: ts.MethodDeclaration | undefined
  const allowed = new Set(['apiVersion', 'languageVersion', 'name', 'kind', 'mode', 'width', 'height', 'durationSeconds', 'seed', 'parameters', 'types', 'shaders', 'render'])
  for (const item of definition.properties) {
    if (!ts.isPropertyAssignment(item) && !ts.isMethodDeclaration(item)) fail(item, '定义不允许展开、简写或访问器。')
    const key = propertyName(item.name)
    if (!allowed.has(key) || metadata.has(key) || (key === 'render' && render)) fail(item, `未知或重复定义字段：${key}`)
    if (ts.isMethodDeclaration(item)) { if (key !== 'render') fail(item, '仅允许 render(ctx) 方法。'); render = item } else { if (key === 'render') fail(item, 'render 必须声明为 render(ctx) 方法。'); metadata.set(key, item.initializer) }
  }
  const value = (key: string): unknown => { const node = metadata.get(key); if (!node) throw new CodeMaterialError('SYNTAX', `缺少定义字段：${key}`); return staticValue(node) }
  if (value('apiVersion') !== 1) throw new CodeMaterialError('SYNTAX', '仅支持 apiVersion: 1。')
  const languageVersion = metadata.has('languageVersion') ? value('languageVersion') : undefined
  if (languageVersion !== undefined && languageVersion !== 3) fail(metadata.get('languageVersion')!, '显式作者语言版本必须为 3。')
  if (languageVersion !== 3 && file.statements.length !== 1) fail(file, '顶层 const 仅用于 v3 作者语言。')
  if (languageVersion !== 3 && ast.astNodes > CODE_MATERIAL_LIMITS.astNodes) fail(file, '源码 AST 数量超出预算。', 'BUDGET')
  const kind = value('kind'); const mode = value('mode')
  if (kind !== 'generator' && kind !== 'filter') throw new CodeMaterialError('SYNTAX', 'kind 必须为 generator 或 filter。')
  if (mode !== 'static' && mode !== 'dynamic') throw new CodeMaterialError('SYNTAX', 'mode 必须为 static 或 dynamic。')
  if (metadata.has('types') && languageVersion !== 3) fail(metadata.get('types')!, 'types 仅用于 v3 作者语言。')
  const types = metadata.has('types') ? parseCodeMaterialTypes(value('types')) : undefined
  const parameters = parseCodeMaterialParameters(value('parameters'), languageVersion === 3 ? 3 : 1, types)
  const imageParameters = parameters.some(parameter => parameter.type === 'image')
  if (imageParameters && kind !== 'generator') throw new CodeMaterialError('TYPE', '图片资源参数仅用于生成器，滤镜仍只采样当前输入。')
  const program: CodeMaterialProgram = { apiVersion: 1, languageVersion: languageVersion === 3 ? 3 : imageParameters ? 2 : 1, name: staticString(value('name'), 'name', 160), kind, mode,
    width: staticNumber(value('width'), 'width', 1, 8192, true), height: staticNumber(value('height'), 'height', 1, 8192, true), durationSeconds: staticNumber(value('durationSeconds'), 'durationSeconds', 0.000001, VIDEO_EDIT_MAX_SEQUENCE_SECONDS), seed: staticNumber(value('seed'), 'seed', 0, 4294967295, true),
    parameters, ...(types ? { types } : {}), bindings: [], result: { kind: 'literal', type: 'boolean', value: false }, metrics: { ...ast, cpuOperations: 0, scalarOperations: 0, samples: 0 } }
  if (!render?.body || render.modifiers?.length || render.asteriskToken || render.questionToken || render.type || render.typeParameters?.length || render.parameters.length !== 1) fail(render ?? definition, '需要纯 render(ctx) 方法。')
  const argument = render.parameters[0]
  if (!ts.isIdentifier(argument.name) || argument.name.text !== 'ctx' || argument.type || argument.initializer || argument.questionToken || argument.dotDotDotToken || argument.modifiers?.length) fail(argument, 'render 仅允许未注解的 ctx 参数。')
  if (metadata.has('shaders')) {
    if (languageVersion !== 3) fail(metadata.get('shaders')!, 'shaders（自己写的着色器）只用于 v3 作者语言。')
    program.shaders = parseCodeMaterialShaders(metadata.get('shaders')!)
  }
  if (languageVersion === 3) return compileCodeMaterialV3(program, file, render.body, file.statements.slice(0, -1))
  const bindings = new Map<string, number>()
  const parameterTypes = new Map(parameters.map(item => [item.key, item.type === 'number' ? 'number' : item.type === 'boolean' ? 'boolean' : item.type === 'color' ? 'color' : item.type === 'image' ? 'image' : 'string'] as const))
  const compile = (node: ts.Expression, arrayOutput = false): CodeExpression => {
    program.metrics.cpuOperations++
    if (ts.isParenthesizedExpression(node)) return compile(node.expression, arrayOutput)
    if (ts.isNumericLiteral(node)) return { kind: 'literal', type: 'number', value: finiteCodeNumber(Number(node.text), '源码数字') }
    if (ts.isStringLiteral(node)) { if (node.text.length > CODE_MATERIAL_LIMITS.stringLength || (kind === 'filter')) fail(node, '滤镜不允许文本，或文本超出长度限制。'); return { kind: 'literal', type: 'string', value: node.text } }
    if (node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword) return { kind: 'literal', type: 'boolean', value: node.kind === ts.SyntaxKind.TrueKeyword }
    if (ts.isIdentifier(node)) { const slot = bindings.get(node.text); if (slot === undefined) return fail(node, `未声明或禁止的名称：${node.text}`); return { kind: 'binding', slot, type: program.bindings[slot].expression.type } }
    if (ts.isPropertyAccessExpression(node) && !node.questionDotToken) {
      const key = node.name.text; assertCodeMaterialKey(key)
      if (ts.isIdentifier(node.expression) && node.expression.text === 'ctx') {
        if (!CODE_CONTEXT_KEYS.includes(key as CodeContextKey)) fail(node, `不允许的 ctx 字段：${key}`)
        if (mode === 'static' && CODE_TIME_KEYS.includes(key as CodeContextKey)) fail(node, '静态素材不得依赖时间或帧。')
        if ((key === 'u' || key === 'v') && kind !== 'filter') fail(node, '像素坐标仅用于单输入滤镜。')
        return { kind: 'context', type: 'number', key: key as CodeContextKey }
      }
      if (ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === 'ctx' && node.expression.name.text === 'params' && !node.expression.questionDotToken) {
        const type = parameterTypes.get(key); if (!type) fail(node, `未声明参数：${key}`)
        if (kind === 'filter' && type === 'string') fail(node, '滤镜不允许文本或选项字符串。')
        return { kind: 'parameter', type, key }
      }
      const input = compile(node.expression); ensureType(node, input, 'color')
      const index = ['r', 'g', 'b', 'a'].indexOf(key); if (index < 0) fail(node, '颜色仅允许 r/g/b/a 静态投影。')
      return { kind: 'component', type: 'number', value: input, index: index as 0 | 1 | 2 | 3 }
    }
    if (ts.isPrefixUnaryExpression(node)) {
      const op = node.operator === ts.SyntaxKind.PlusToken ? '+' : node.operator === ts.SyntaxKind.MinusToken ? '-' : node.operator === ts.SyntaxKind.ExclamationToken ? '!' : undefined
      if (!op) fail(node, '不允许此一元操作。')
      const input = compile(node.operand); ensureType(node, input, op === '!' ? 'boolean' : 'number'); program.metrics.scalarOperations++
      return { kind: 'unary', type: input.type, op, value: input }
    }
    if (ts.isBinaryExpression(node)) {
      const op = binaryOperators.get(node.operatorToken.kind); if (!op) fail(node, '不允许赋值或此二元操作。')
      const left = compile(node.left); const right = compile(node.right)
      const type = ['&&', '||'].includes(op) ? 'boolean' : 'number'
      if (['===', '!=='].includes(op)) { if (left.type !== right.type || !['number', 'boolean', 'string'].includes(left.type)) fail(node, '相等比较仅用于同类型标量。', 'TYPE') }
      else { ensureType(node, left, type); ensureType(node, right, type) }
      const cost = codeBinaryCost(op); program.metrics.scalarOperations += cost; program.metrics.cpuOperations += cost - 1
      if (['/', '%'].includes(op) && right.kind === 'literal' && right.value === 0) throw new CodeMaterialError('NON_FINITE', '除数不能为零。')
      return { kind: 'binary', op, left, right, type: ['+', '-', '*', '/', '%'].includes(op) ? 'number' : 'boolean' }
    }
    if (ts.isConditionalExpression(node)) {
      const condition = compile(node.condition); ensureType(node, condition, 'boolean')
      const yes = compile(node.whenTrue, arrayOutput); const no = compile(node.whenFalse, arrayOutput)
      if (yes.type !== no.type) fail(node, '条件分支必须返回相同类型。', 'TYPE')
      if (yes.type === 'image') fail(node, '图片引用不能用于条件表达式。', 'TYPE')
      const cost = codeConditionalCost(yes.type); program.metrics.scalarOperations += cost; program.metrics.cpuOperations += cost - 1
      return { kind: 'conditional', condition, yes, no, type: yes.type }
    }
    if (ts.isArrayLiteralExpression(node)) {
      if (arrayOutput) { if (node.elements.length > CODE_MATERIAL_LIMITS.draws) throw new CodeMaterialError('BUDGET', '图形最多 256 项。'); const values = node.elements.map(item => compile(item)); for (const item of values) ensureType(node, item, 'draw'); return { kind: 'draws', type: 'draws', values } }
      if (node.elements.length !== 4) fail(node, '仅允许四通道 RGBA 数组。')
      const values = node.elements.map(item => compile(item)); for (const item of values) ensureType(node, item, 'number')
      return { kind: 'color', type: 'color', values }
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && !node.questionDotToken && !node.typeArguments?.length) {
      const op = node.expression.text
      if (Object.prototype.hasOwnProperty.call(shapeFields, op)) {
        if (kind !== 'generator' || node.arguments.length !== 1 || !ts.isObjectLiteralExpression(node.arguments[0])) fail(node, '图形调用需要一个静态字段对象，且仅用于生成器。')
        const shape = op as keyof typeof shapeFields; const fields = shapeFields[shape]; const properties: Record<string, CodeExpression> = {}
        for (const [key, value] of objectProperties(node.arguments[0])) { if (!Object.prototype.hasOwnProperty.call(fields, key)) fail(value, `未知图形字段：${key}`); const expression = compile(value); ensureType(value, expression, fields[key]); properties[key] = expression }
        for (const key of Object.keys(fields)) if (!Object.prototype.hasOwnProperty.call(properties, key) && !optionalShapeFields.has(key)) fail(node, `缺少图形字段：${key}`)
        return { kind: 'draw', type: 'draw', shape, properties }
      }
      if (!CODE_BUILTINS.includes(op as CodeBuiltin)) fail(node, `不允许调用：${op}`)
      const builtin = op as CodeBuiltin; const args = node.arguments.map(item => compile(item)); let type: CodeValueType = 'number'
      const arity = ['min', 'max', 'sample'].includes(op) ? 2 : ['clamp', 'mix', 'smoothstep'].includes(op) ? 3 : op === 'rgba' ? 4 : 1
      if (args.length !== arity) fail(node, `${op} 需要 ${arity} 个参数。`)
      if (op === 'sample') { if (kind !== 'filter') fail(node, '仅单输入滤镜允许 sample(u,v)。'); program.metrics.samples++; type = 'color' }
      if (op === 'rgba') type = 'color'
      if (op === 'mix' || op === 'clamp') {
        type = args[0].type; if (type !== 'number' && type !== 'color') fail(node, `${op} 仅接受数值或颜色。`, 'TYPE')
        ensureType(node, args[1], op === 'mix' ? type : 'number'); ensureType(node, args[2], 'number')
      } else for (const item of args) ensureType(node, item, 'number')
      const cost = codeBuiltinCost(builtin, type); program.metrics.scalarOperations += cost.scalar; program.metrics.cpuOperations += cost.cpu
      return { kind: 'call', type, op: builtin, args }
    }
    return fail(node, `不允许的语法：${ts.SyntaxKind[node.kind]}`)
  }
  const statements = render.body.statements
  if (!statements.length || !ts.isReturnStatement(statements[statements.length - 1])) fail(render, 'render 必须以 return 结束。')
  for (const statement of statements.slice(0, -1)) {
    if (!ts.isVariableStatement(statement) || statement.modifiers?.length || statement.declarationList.flags !== ts.NodeFlags.Const) fail(statement, 'render 中仅允许 const 和最后一个 return。')
    for (const item of statement.declarationList.declarations) {
      if (!ts.isIdentifier(item.name) || !item.initializer || item.type || item.exclamationToken) fail(item, 'const 必须是未注解的名称和纯表达式。')
      const name = item.name.text; assertCodeMaterialKey(name)
      if (name === 'ctx' || CODE_BUILTINS.includes(name as CodeBuiltin) || Object.prototype.hasOwnProperty.call(shapeFields, name) && (name !== 'image' || program.languageVersion === 2) || bindings.has(name)) fail(item, `重复或保留的局部名称：${name}`)
      const expression = compile(item.initializer); bindings.set(name, program.bindings.length); program.bindings.push({ name, expression })
    }
  }
  const last = statements[statements.length - 1] as ts.ReturnStatement
  if (!last.expression) fail(last, 'return 缺少输出。')
  program.result = compile(last.expression, kind === 'generator'); ensureType(last, program.result, kind === 'generator' ? 'draws' : 'color')
  if (program.metrics.cpuOperations > CODE_MATERIAL_LIMITS.cpuOperations || (kind === 'filter' && (program.metrics.scalarOperations > CODE_MATERIAL_LIMITS.filterScalarOperations || program.metrics.samples > CODE_MATERIAL_LIMITS.filterSamples))) throw new CodeMaterialError('BUDGET', '求值或滤镜操作/采样超出预算。')
  return program
}
