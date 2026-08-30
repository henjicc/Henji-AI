import ts from 'typescript'

import type { RunHenjiScriptInput } from '../../../../../src/core/assistant/capabilities/henjiScriptApplicationCapabilities'
import {
  HenjiScriptError,
  type HenjiInstruction,
  type HenjiCallKind,
  type HenjiScriptPlan,
  type HenjiValueExpression,
} from './types'
import {
  expressionCallAlternative,
  locationOf,
  SCRIPT_RESULT_ALTERNATIVE,
  sourceSnippet,
  syntaxAlternative,
  unsupported,
} from './compiler-diagnostics'

const MAX_SOURCE_BYTES = 32 * 1024
const MAX_NESTING = 4
const MAX_LOOP_ITERATIONS = 64
const MAX_OPERATIONS = 128
const FORBIDDEN_PROPERTIES = new Set(['__proto__', 'prototype', 'constructor'])
const HELPER_NAMES = new Set(['range', 'take', 'lerp', 'clamp', 'sin', 'cos', 'tan', 'find', 'filter'])
const CALL_APIS = new Set([
  'app.action', 'app.recipe',
  'app.entities.list', 'app.entities.read', 'app.entities.create',
  'app.entities.update', 'app.entities.remove',
])
const ASSERT_APIS = new Set([
  'app.assert.equal', 'app.assert.exists', 'app.assert.absent', 'app.assert.matches',
])

function apiPath(sourceFile: ts.SourceFile, expression: ts.Expression): string {
  if (ts.isIdentifier(expression)) return expression.text
  if (!ts.isPropertyAccessExpression(expression)) {
    return unsupported(sourceFile, expression, 'API 必须使用静态属性路径，禁止动态属性访问')
  }
  if (FORBIDDEN_PROPERTIES.has(expression.name.text)) {
    return unsupported(sourceFile, expression, `禁止访问属性 ${expression.name.text}`)
  }
  return `${apiPath(sourceFile, expression.expression)}.${expression.name.text}`
}

function propertyName(sourceFile: ts.SourceFile, name: ts.PropertyName): string {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    if (FORBIDDEN_PROPERTIES.has(name.text)) unsupported(sourceFile, name, `禁止属性 ${name.text}`)
    return name.text
  }
  return unsupported(sourceFile, name, '对象只允许静态属性名')
}

function unknownVariable(
  sourceFile: ts.SourceFile,
  node: ts.Node,
  name: string,
  variables: ReadonlyMap<string, HenjiValueExpression>,
): never {
  const available = [...variables.keys()].slice(0, 24)
  return unsupported(
    sourceFile, node, `未知变量 ${name}`,
    available.length > 0
      ? `当前可用变量：${available.join('、')}；请使用准确的 const 名称。`
      : '当前还没有任何变量；先用 const 声明字面量或保存 app.* 调用结果。',
  )
}

function expressionPath(
  sourceFile: ts.SourceFile,
  node: ts.Expression,
  variables: ReadonlyMap<string, HenjiValueExpression>,
): HenjiValueExpression | null {
  if (ts.isIdentifier(node)) return variables.get(node.text) ?? null
  if (ts.isPropertyAccessExpression(node)) {
    if (FORBIDDEN_PROPERTIES.has(node.name.text)) {
      unsupported(sourceFile, node, `禁止访问属性 ${node.name.text}`)
    }
    const base = expressionPath(sourceFile, node.expression, variables)
    if (!base) {
      if (ts.isIdentifier(node.expression)) {
        unknownVariable(sourceFile, node.expression, node.expression.text, variables)
      }
      return null
    }
    if (base.kind === 'variable') return { ...base, path: [...base.path, node.name.text] }
    /*
     * 自己刚写出来的 const 也要能读回字段。
     *
     * 脚本里 `const ref = { kind: 'canvas.node', id: created.resultRefs[0].id }` 之后再写
     * `ref.id` 是最自然不过的写法，旧实现却一律拒成"只能从前序调用结果读取公开字段"——
     * 那句话把限制说成了"只有调用结果能点访问"，而真正的限制其实是"不能动态取属性"。
     * 对象字面量的键在编译期就确定，静态解析出来既安全也没有歧义。
     */
    /*
     * app.find(...) 挑出来那一项，接着读它的字段是必然要写的一步——不支持就等于白给。
     * helper 的路径与 variable 完全同一套语义：编译期只记路径，运行期再解析。
     */
    if (base.kind === 'helper') return { ...base, path: [...(base.path ?? []), node.name.text] }
    const entry = base.kind === 'object'
      ? base.entries.find((item) => item.key === node.name.text)
      : undefined
    if (entry) return entry.value
    return unsupported(
      sourceFile, node, '读不到这个字段',
      base.kind === 'object'
        ? `这个对象字面量只有：${base.entries.map((item) => item.key).join('、') || '（空对象）'}`
        : '只能从前序调用结果或对象字面量读取字段。'
    )
  }
  if (ts.isElementAccessExpression(node)) {
    const argument = node.argumentExpression
    if (!argument || (!ts.isNumericLiteral(argument) && !ts.isStringLiteral(argument))) {
      unsupported(sourceFile, node, '下标只允许使用非负整数字面量或静态字符串字面量')
    }
    const segment = ts.isStringLiteral(argument) ? argument.text : Number(argument.text)
    if (typeof segment === 'number' && (!Number.isInteger(segment) || segment < 0)) {
      unsupported(sourceFile, node, '数组下标必须是非负整数')
    }
    if (typeof segment === 'string' && FORBIDDEN_PROPERTIES.has(segment)) {
      unsupported(sourceFile, node, `禁止访问属性 ${segment}`)
    }
    const base = expressionPath(sourceFile, node.expression, variables)
    if (!base) {
      if (ts.isIdentifier(node.expression)) {
        unknownVariable(sourceFile, node.expression, node.expression.text, variables)
      }
      return null
    }
    if (base.kind === 'variable') return { ...base, path: [...base.path, segment] }
    if (base.kind === 'helper') return { ...base, path: [...(base.path ?? []), segment] }
    // 与点访问同一条道理：字面量的下标在编译期就确定，静态解析出来既安全也没有歧义。
    if (base.kind === 'object' && typeof segment === 'string') {
      const entry = base.entries.find((item) => item.key === segment)
      if (entry) return entry.value
      return unsupported(
        sourceFile, node, '读不到这个字段',
        `这个对象字面量只有：${base.entries.map((item) => item.key).join('、') || '（空对象）'}`
      )
    }
    if (base.kind === 'array' && typeof segment === 'number') {
      const item = base.items[segment]
      if (item) return item
      return unsupported(
        sourceFile, node, `下标 ${segment} 超出范围`,
        `这个数组字面量只有 ${base.items.length} 项`
      )
    }
    return unsupported(sourceFile, node, '只能从前序调用结果、对象字面量或数组字面量读取')
  }
  return null
}

function compileExpression(
  sourceFile: ts.SourceFile,
  node: ts.Expression,
  variables: ReadonlyMap<string, HenjiValueExpression>,
): HenjiValueExpression {
  const path = expressionPath(sourceFile, node, variables)
  if (path) return path
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return { kind: 'literal', value: node.text }
  }
  if (ts.isNumericLiteral(node)) return { kind: 'literal', value: Number(node.text) }
  if (node.kind === ts.SyntaxKind.TrueKeyword) return { kind: 'literal', value: true }
  if (node.kind === ts.SyntaxKind.FalseKeyword) return { kind: 'literal', value: false }
  if (node.kind === ts.SyntaxKind.NullKeyword) return { kind: 'literal', value: null }
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken) {
    const operand = compileExpression(sourceFile, node.operand, variables)
    return { kind: 'binary', operator: '*', left: { kind: 'literal', value: -1 }, right: operand }
  }
  if (ts.isArrayLiteralExpression(node)) {
    if (node.elements.some(ts.isSpreadElement)) unsupported(sourceFile, node, '数组禁止展开语法')
    return { kind: 'array', items: node.elements.map((item) => (
      compileExpression(sourceFile, item as ts.Expression, variables)
    )) }
  }
  if (ts.isObjectLiteralExpression(node)) {
    return {
      kind: 'object',
      entries: node.properties.map((property) => {
        if (!ts.isPropertyAssignment(property)) {
          return unsupported(sourceFile, property, '对象只允许显式 key: value，不允许展开或简写')
        }
        return {
          key: propertyName(sourceFile, property.name),
          value: compileExpression(sourceFile, property.initializer, variables),
        }
      }),
    }
  }
  if (ts.isBinaryExpression(node)) {
    const allowed = new Set([
      '+', '-', '*', '/', '%', '<', '<=', '>', '>=', '===', '!==', '&&', '||', '==', '!=',
    ])
    const operator = node.operatorToken.getText(sourceFile)
    if (!allowed.has(operator)) unsupported(sourceFile, node, `不支持运算符 ${operator}`)
    return {
      kind: 'binary', operator,
      left: compileExpression(sourceFile, node.left, variables),
      right: compileExpression(sourceFile, node.right, variables),
    }
  }
  if (ts.isConditionalExpression(node)) {
    return {
      kind: 'conditional',
      condition: compileExpression(sourceFile, node.condition, variables),
      whenTrue: compileExpression(sourceFile, node.whenTrue, variables),
      whenFalse: compileExpression(sourceFile, node.whenFalse, variables),
    }
  }
  if (ts.isTemplateExpression(node)) {
    const parts: Array<string | HenjiValueExpression> = [node.head.text]
    for (const span of node.templateSpans) {
      parts.push(compileExpression(sourceFile, span.expression, variables), span.literal.text)
    }
    return { kind: 'template', parts }
  }
  if (ts.isCallExpression(node)) {
    const pathName = apiPath(sourceFile, node.expression)
    if (!pathName.startsWith('app.') || !HELPER_NAMES.has(pathName.slice(4))) {
      const appCallAlternative = CALL_APIS.has(pathName)
        ? `${pathName} 是应用操作，不是表达式 helper；保存结果要写 const result = await ${pathName}(...)，不使用结果则写 await ${pathName}(...)。`
        : ASSERT_APIS.has(pathName)
          ? '断言没有返回值；把 app.assert.*(...) 作为独立语句。'
          : undefined
      unsupported(
        sourceFile, node, `表达式中不允许调用 ${pathName}`,
        expressionCallAlternative(sourceFile, node, pathName)
          ?? appCallAlternative
          ?? `表达式里只能调用 app.${[...HELPER_NAMES].join(' / app.')}`,
      )
    }
    return {
      kind: 'helper', name: pathName.slice(4),
      args: node.arguments.map((argument) => compileExpression(sourceFile, argument, variables)),
    }
  }
  if (ts.isParenthesizedExpression(node)) return compileExpression(sourceFile, node.expression, variables)
  if (ts.isIdentifier(node)) unknownVariable(sourceFile, node, node.text, variables)
  return unsupported(
    sourceFile, node, `不支持语法 ${ts.SyntaxKind[node.kind]}`,
    syntaxAlternative(node.kind),
  )
}

function staticValue(expression: HenjiValueExpression): unknown {
  if (expression.kind === 'literal') return expression.value
  if (expression.kind === 'array') return expression.items.map(staticValue)
  if (expression.kind === 'helper') {
    const args = expression.args.map(staticValue)
    if (expression.name === 'range') {
      const start = args.length > 1 ? Number(args[0]) : 0
      const end = Number(args.length > 1 ? args[1] : args[0])
      const step = args.length > 2 ? Number(args[2]) : 1
      if (![start, end, step].every(Number.isFinite) || step === 0) return undefined
      const result: number[] = []
      for (let value = start; (step > 0 ? value < end : value > end) && result.length <= MAX_LOOP_ITERATIONS; value += step) {
        result.push(value)
      }
      return result
    }
    if (expression.name === 'take' && Array.isArray(args[0])) return args[0].slice(0, Number(args[1]))
  }
  return undefined
}

interface CompileState {
  sourceFile: ts.SourceFile
  variables: Map<string, HenjiValueExpression>
  instructions: HenjiInstruction[]
  nextStep: number
}

function stepId(state: CompileState): string {
  state.nextStep += 1
  return `step_${state.nextStep}`
}

function compileCall(
  state: CompileState,
  call: ts.CallExpression,
  assignment: string | null,
): void {
  const pathName = apiPath(state.sourceFile, call.expression)
  if (ASSERT_APIS.has(pathName)) {
    if (assignment) {
      unsupported(
        state.sourceFile, call, '断言结果不能赋值',
        '断言没有返回值；去掉 const 赋值，把 app.assert.*(...) 作为独立语句。',
      )
    }
    const id = stepId(state)
    state.instructions.push({
      kind: 'assert', stepId: id,
      assertion: pathName.slice('app.assert.'.length) as 'equal' | 'exists' | 'absent' | 'matches',
      args: call.arguments.map((arg) => compileExpression(state.sourceFile, arg, state.variables)),
      location: locationOf(state.sourceFile, call),
    })
    return
  }
  if (!CALL_APIS.has(pathName)) {
    let alternative: string
    if (pathName.startsWith('app.') && HELPER_NAMES.has(pathName.slice(4))) {
      alternative = `${pathName} 是同步 helper，不能 await 或作为独立应用操作；改写为 const value = ${pathName}(...)，再把 value 传给后续 app.* 调用。`
    } else if (pathName.startsWith('app.entities.')) {
      alternative = '实体 API 只支持 app.entities.list / read / create / update / remove；请使用 scriptApi 给出的准确方法。'
    } else if (pathName.startsWith('app.assert.')) {
      alternative = '断言只支持 app.assert.equal / exists / absent / matches，且必须作为独立语句。'
    } else if (/^app\.[^.]+$/.test(pathName)) {
      const operationId = pathName.slice(4)
      alternative = `如果 ${operationId} 是发现到的 action ID，请改用 app.action('${operationId}', input)；recipe ID 则用 app.recipe('${operationId}', input)。`
    } else {
      alternative = '应用操作只支持 app.action、app.recipe、app.entities.list/read/create/update/remove 和 app.assert.*。'
    }
    unsupported(state.sourceFile, call, `未支持的 Henji API：${pathName}`, alternative)
  }
  const id = stepId(state)
  state.instructions.push({
    kind: 'call', stepId: id,
    api: pathName.slice(4) as HenjiCallKind,
    args: call.arguments.map((arg) => compileExpression(state.sourceFile, arg, state.variables)),
    location: locationOf(state.sourceFile, call),
  })
  if (assignment) state.variables.set(assignment, { kind: 'variable', name: id, path: [] })
}

function compileStatements(
  state: CompileState,
  statements: readonly ts.Statement[],
  nesting: number,
): void {
  if (nesting > MAX_NESTING) {
    throw new HenjiScriptError('SCRIPT_PLAN_REJECTED', 'compile', `语句嵌套不能超过 ${MAX_NESTING} 层`)
  }
  for (const statement of statements) {
    if (ts.isVariableStatement(statement)) {
      if ((statement.declarationList.flags & ts.NodeFlags.Const) === 0) {
        unsupported(state.sourceFile, statement, '只允许 const 变量')
      }
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer) {
          unsupported(state.sourceFile, declaration, 'const 必须使用简单变量名并立即初始化')
        }
        if (ts.isAwaitExpression(declaration.initializer)) {
          if (!ts.isCallExpression(declaration.initializer.expression)) {
            unsupported(state.sourceFile, declaration.initializer, 'await 后只能调用 app API')
          }
          compileCall(state, declaration.initializer.expression, declaration.name.text)
        } else {
          state.variables.set(
            declaration.name.text,
            compileExpression(state.sourceFile, declaration.initializer, state.variables),
          )
        }
      }
      continue
    }
    if (ts.isExpressionStatement(statement)) {
      const expression = ts.isAwaitExpression(statement.expression)
        ? statement.expression.expression : statement.expression
      if (!ts.isCallExpression(expression)) {
        unsupported(
          state.sourceFile, expression, '表达式语句不能作为脚本返回值',
          SCRIPT_RESULT_ALTERNATIVE,
        )
      }
      compileCall(state, expression, null)
      continue
    }
    if (ts.isForOfStatement(statement)) {
      if (!ts.isVariableDeclarationList(statement.initializer)
        || statement.initializer.declarations.length !== 1
        || !ts.isIdentifier(statement.initializer.declarations[0].name)) {
        unsupported(state.sourceFile, statement, 'for...of 必须使用单个 const 变量')
      }
      const iterable = staticValue(compileExpression(state.sourceFile, statement.expression, state.variables))
      if (!Array.isArray(iterable) || iterable.length > MAX_LOOP_ITERATIONS) {
        /*
         * 说清楚是**哪一种**拒绝：循环体在编译期就要展开，所以被遍历的东西必须是字面量数组
         * 或 app.range(...)。只说"必须可静态展开"时，调用方分不清是"我写的次数太多"还是
         * "我遍历的是一个读取结果"——后者是实测里真正发生的那种，它会一直换写法重试。
         */
        throw new HenjiScriptError(
          'SCRIPT_PLAN_REJECTED', 'compile',
          Array.isArray(iterable)
            ? `循环最多展开 ${MAX_LOOP_ITERATIONS} 次，这里是 ${iterable.length} 次：`
              + `\`${sourceSnippet(state.sourceFile, statement.expression)}\``
            : '循环体在编译期展开，被遍历的必须是字面量数组或 app.range(整数字面量)，'
              + `不能是读取结果：\`${sourceSnippet(state.sourceFile, statement.expression)}\`。`
              + '三种可行写法：(1) 要按名称之类的属性值找出某一个，用 '
              + "app.entities.list(类型, { where: { 属性: 值 }, propertyIds: [属性] })——"
              + '筛选在后端做，返回的 refs 已经只剩命中的那些；(2) 要确认某个实体的属性，'
              + '直接对它的 ref 调 app.entities.read 再 app.assert；(3) 要对多个已知实体逐个写入，'
              + '把它们写成多次 app.entities.update / remove 调用。',
          locationOf(state.sourceFile, statement),
        )
      }
      const name = statement.initializer.declarations[0].name.text
      const body = ts.isBlock(statement.statement) ? statement.statement.statements : [statement.statement]
      const previous = state.variables.get(name)
      for (const value of iterable) {
        if (!['string', 'number', 'boolean'].includes(typeof value) && value !== null) {
          unsupported(state.sourceFile, statement.expression, '循环值只能是有限标量')
        }
        state.variables.set(name, { kind: 'literal', value: value as string | number | boolean | null })
        compileStatements(state, body, nesting + 1)
      }
      if (previous) state.variables.set(name, previous)
      else state.variables.delete(name)
      continue
    }
    if (ts.isIfStatement(statement)) {
      const id = stepId(state)
      const condition = compileExpression(state.sourceFile, statement.expression, state.variables)
      const compileBranch = (branch: ts.Statement | undefined): HenjiInstruction[] => {
        if (!branch) return []
        const nested: CompileState = {
          sourceFile: state.sourceFile,
          variables: new Map(state.variables),
          instructions: [],
          nextStep: state.nextStep,
        }
        compileStatements(nested, ts.isBlock(branch) ? branch.statements : [branch], nesting + 1)
        state.nextStep = nested.nextStep
        return nested.instructions
      }
      state.instructions.push({
        kind: 'branch', stepId: id, condition,
        whenTrue: compileBranch(statement.thenStatement),
        whenFalse: compileBranch(statement.elseStatement),
        location: locationOf(state.sourceFile, statement),
      })
      continue
    }
    return unsupported(
      state.sourceFile, statement, `不支持语句 ${ts.SyntaxKind[statement.kind]}`,
      syntaxAlternative(statement.kind)
        ?? '语句只支持 const 声明、for...of、if/else 和 await app.* 调用。'
    )
  }
}

function operationCount(instructions: readonly HenjiInstruction[]): number {
  return instructions.reduce((total, instruction) => total + 1 + (
    instruction.kind === 'branch'
      ? Math.max(operationCount(instruction.whenTrue), operationCount(instruction.whenFalse))
      : 0
  ), 0)
}

export function compileHenjiScript(input: RunHenjiScriptInput): HenjiScriptPlan {
  if (Buffer.byteLength(input.source, 'utf8') > MAX_SOURCE_BYTES) {
    throw new HenjiScriptError('SCRIPT_PLAN_REJECTED', 'parse', `源码不能超过 ${MAX_SOURCE_BYTES} 字节`)
  }
  const sourceFile = ts.createSourceFile('assistant.henji.ts', input.source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS)
  const diagnostics = (sourceFile as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics ?? []
  if (diagnostics.length > 0) {
    const diagnostic = diagnostics[0]
    const point = sourceFile.getLineAndCharacterOfPosition(diagnostic.start ?? 0)
    throw new HenjiScriptError(
      'SCRIPT_PARSE_FAILED', 'parse', ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
      { line: point.line + 1, column: point.character + 1 },
    )
  }
  const state: CompileState = { sourceFile, variables: new Map(), instructions: [], nextStep: 0 }
  compileStatements(state, sourceFile.statements, 0)
  const count = operationCount(state.instructions)
  if (count === 0) throw new HenjiScriptError('SCRIPT_PLAN_REJECTED', 'compile', '脚本没有任何应用操作')
  if (count > MAX_OPERATIONS) {
    throw new HenjiScriptError('SCRIPT_PLAN_REJECTED', 'compile', `展开后最多 ${MAX_OPERATIONS} 个应用操作`)
  }
  return {
    schemaVersion: 'henji-script-ir/v1', summary: input.summary,
    instructions: state.instructions, operationUpperBound: count,
  }
}
