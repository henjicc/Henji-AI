import ts from 'typescript'

export type LayoutFunction = 'layoutText' | 'layoutTable' | 'layoutBoxes'
export interface TextCoverageInput {
  /** 本模块从 henji-layout 导入的排版函数：本地名 → 导出名。 */
  readonly calls: ReadonlyMap<string, LayoutFunction>
  readonly namespaces: ReadonlySet<string>
  /** 文字样式位置交给字体声明收集；单元格样式附带所在表格的输入，用于继承整表样式。 */
  style(expression: ts.Expression, table?: ts.Expression): void
}
export interface TextCoverage { text: string[]; parameters: string[]; dynamic: boolean; calls: Array<{ call: ts.CallExpression; name: LayoutFunction }> }

/*
 * 证明排版实际绘制的字符都在准备集里：只分析承载文字的位置，宽度、id、表格选项等不参与。
 * 判断与收集是同一次求值；任何不能证明字符来源的写法（函数返回值、可能被改写的对象、
 * 未知方法、跨模块常量……）都使整个模块回到完整默认候选集。
 */
// 非字符串值转成文字时可能出现的全部字符：数字与指数、Infinity/NaN、undefined/null、布尔、数组逗号与普通对象。
const CONVERTED_TEXT = '0123456789.-+e,InfinityNaNundefinednulltruefalse[object Object]'
const NUMBER_TEXT = '0123456789.-+eInfinityNaN'
const RADIX_TEXT = '0123456789abcdefghijklmnopqrstuvwxyz.-'
// 覆盖等级：NONE 不能证明；VALUE 叶子已收集但转成文字可能出现 CONVERTED_TEXT；PRIMITIVE 转成文字后的字符已收集；TEXT 是字符串且字符已收集。
const NONE = 0, VALUE = 1, PRIMITIVE = 2, TEXT = 3
type Known = 0 | 1 | 2 | 3
const least = (...values: Known[]): Known => Math.min(...values) as Known
const ENTRY_METHODS = new Set(['draw', 'layers', 'frameKey'])
// 回调参数位置：元素、下标、整个数组；reduce 的累加值无法证明。
const CALLBACKS: Readonly<Record<string, ReadonlyArray<'element' | 'index' | 'array' | undefined>>> = Object.fromEntries([
  ...['map', 'flatMap', 'forEach', 'filter', 'find', 'findIndex', 'findLast', 'findLastIndex', 'some', 'every'].map(name => [name, ['element', 'index', 'array']] as const),
  ...['reduce', 'reduceRight'].map(name => [name, [undefined, 'element', 'index', 'array']] as const),
  ...['sort', 'toSorted'].map(name => [name, ['element', 'element']] as const),
])
// 不改写接收者的方法；后一组的结果可能与接收者共享对象。
const READ_METHODS = new Set([...Object.keys(CALLBACKS).filter(name => name !== 'sort'), 'slice', 'concat', 'at', 'flat', 'toReversed', 'with', 'includes', 'indexOf', 'lastIndexOf', 'join', 'toString', 'valueOf', 'charAt', 'charCodeAt', 'codePointAt', 'substring', 'substr', 'trim', 'trimStart', 'trimEnd', 'trimLeft', 'trimRight', 'padStart', 'padEnd', 'repeat', 'split', 'startsWith', 'endsWith', 'replace', 'replaceAll', 'toFixed', 'toPrecision', 'toExponential', 'toUpperCase', 'toLowerCase', 'localeCompare', 'normalize'])
const ALIAS_METHODS = new Set(['slice', 'concat', 'filter', 'find', 'findLast', 'at', 'flat', 'flatMap', 'map', 'reduce', 'reduceRight', 'toReversed', 'toSorted', 'with', 'valueOf'])
const RESULT_CALLBACKS = new Set(['map', 'flatMap', 'reduce', 'reduceRight'])
const PURE_GLOBALS = new Set(['String', 'Number', 'Boolean', 'parseInt', 'parseFloat', 'isNaN', 'isFinite'])
const PURE_MEMBERS: Readonly<Record<string, true | ReadonlySet<string>>> = { Math: true, console: true, JSON: new Set(['stringify', 'parse']), Array: new Set(['isArray']), Object: new Set(['keys']) }
const FIELDS: Readonly<Record<string, Readonly<Record<string, Role | 'style'>>>> = {
  text: { paragraphs: { each: 'paragraph' } }, paragraph: { runs: { each: 'run' } }, run: { text: 'text', style: 'style' },
  table: { rows: { each: 'row' }, style: 'style' }, cell: { text: 'text', style: 'style' },
  node: { children: { each: 'node' }, text: 'nodeText' }, nodeText: { content: 'text', style: 'style' },
}
type Role = 'text' | 'paragraph' | 'run' | 'table' | 'row' | 'cell' | 'node' | 'nodeText' | { each: Role }

type Binding =
  | { kind: 'const'; name: ts.Identifier; declaration: ts.VariableDeclaration }
  | { kind: 'loop'; name: ts.Identifier; statement: ts.ForOfStatement; declaration: ts.VariableDeclaration }
  | { kind: 'parameter'; name: ts.Identifier; parameter: ts.ParameterDeclaration; fn: ts.SignatureDeclaration }
  | { kind: 'function'; name: ts.Identifier; fn: ts.FunctionDeclaration }
  | { kind: 'import' | 'other'; name?: ts.Identifier }

const unwrap = (node: ts.Expression): ts.Expression => ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isNonNullExpression(node) || ts.isTypeAssertionExpression(node) ? unwrap(node.expression) : node
const names = (name: ts.BindingName): ts.Identifier[] => ts.isIdentifier(name) ? [name] : name.elements.flatMap(element => ts.isOmittedExpression(element) ? [] : names(element.name))
/** 下标表达式只有字面量才是确定的键；标识符是变量。 */
const literalKey = (expression: ts.Expression): string | undefined => { const node = unwrap(expression); return ts.isStringLiteralLike(node) || ts.isNumericLiteral(node) ? node.text : undefined }
const staticKey = (name: ts.PropertyName): string | undefined => ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name) ? name.text : ts.isComputedPropertyName(name) ? literalKey(name.expression) : undefined
const isConst = (list: ts.Node): boolean => ts.isVariableDeclarationList(list) && !!(list.flags & ts.NodeFlags.Const)
const assignment = (kind: ts.SyntaxKind): boolean => kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment
const isReference = (id: ts.Identifier): boolean => {
  const parent = id.parent
  if (ts.isPropertyAccessExpression(parent) && parent.name === id) return false
  if ((ts.isPropertyAssignment(parent) || ts.isMethodDeclaration(parent) || ts.isPropertyDeclaration(parent) || ts.isGetAccessor(parent) || ts.isSetAccessor(parent) || ts.isPropertySignature(parent) || ts.isMethodSignature(parent) || ts.isEnumMember(parent)) && parent.name === id) return false
  if (ts.isBindingElement(parent) && parent.propertyName === id) return false
  if ((ts.isVariableDeclaration(parent) || ts.isParameter(parent) || ts.isBindingElement(parent) || ts.isFunctionDeclaration(parent) || ts.isFunctionExpression(parent) || ts.isClassDeclaration(parent) || ts.isClassExpression(parent) || ts.isEnumDeclaration(parent) || ts.isTypeAliasDeclaration(parent) || ts.isInterfaceDeclaration(parent)) && parent.name === id) return false
  if (ts.isImportSpecifier(parent) || ts.isImportClause(parent) || ts.isNamespaceImport(parent) || ts.isNamespaceExport(parent) || ts.isMetaProperty(parent)) return false
  if (ts.isExportSpecifier(parent) && parent.propertyName && parent.name === id) return false
  if (ts.isLabeledStatement(parent) || ts.isBreakOrContinueStatement(parent) || ts.isQualifiedName(parent) || ts.isTypeNode(parent) || ts.isJsxAttribute(parent)) return false
  return true
}
/** var 按函数作用域提升；不进入嵌套函数。 */
const varNames = (root: ts.Node): Set<string> => {
  const found = new Set<string>()
  const visit = (node: ts.Node): void => {
    if (node !== root && ts.isFunctionLike(node)) return
    if (ts.isVariableDeclarationList(node) && !(node.flags & (ts.NodeFlags.Const | ts.NodeFlags.Let))) node.declarations.forEach(declaration => names(declaration.name).forEach(name => found.add(name.text)))
    ts.forEachChild(node, visit)
  }
  visit(root)
  return found
}
const returns = (fn: ts.ArrowFunction | ts.FunctionExpression): ts.Expression[] => {
  if (!ts.isBlock(fn.body)) return [fn.body]
  const values: ts.Expression[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionLike(node)) return
    if (ts.isReturnStatement(node) && node.expression) values.push(node.expression)
    ts.forEachChild(node, visit)
  }
  fn.body.statements.forEach(visit)
  return values
}

export function readTextCoverage(source: ts.SourceFile, options: TextCoverageInput): TextCoverage {
  const collected: string[] = [], parameters = new Set<string>(), calls: TextCoverage['calls'] = []
  let dynamic = false
  const collect = (text: string): void => { if (text) collected.push(text) }
  const references = new Map<string, ts.Identifier[]>()
  const index = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && isReference(node)) references.set(node.text, [...references.get(node.text) ?? [], node])
    ts.forEachChild(node, index)
  }
  index(source)

  const bindings = new Map<ts.Identifier, Binding | undefined>(), hoisted = new Map<ts.Node, Set<string>>()
  const hoistsVar = (root: ts.Node, text: string): boolean => {
    let found = hoisted.get(root)
    if (!found) { found = varNames(root); hoisted.set(root, found) }
    return found.has(text)
  }
  const declaredIn = (scope: ts.Node, text: string): Binding | undefined => {
    const match = (name: ts.BindingName): ts.Identifier | undefined => names(name).find(value => value.text === text)
    if (ts.isFunctionLike(scope)) {
      for (const parameter of scope.parameters) { const name = match(parameter.name); if (name) return { kind: 'parameter', name, parameter, fn: scope } }
      if ((ts.isFunctionExpression(scope) || ts.isClassExpression(scope)) && scope.name?.text === text) return { kind: 'other', name: scope.name }
      if ('body' in scope && scope.body && hoistsVar(scope.body, text)) return { kind: 'other' }
    }
    if (ts.isSourceFile(scope) || ts.isBlock(scope) || ts.isModuleBlock(scope) || ts.isCaseClause(scope) || ts.isDefaultClause(scope)) {
      for (const statement of scope.statements) {
        if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) {
          const name = match(declaration.name)
          if (name) return isConst(statement.declarationList) && declaration.initializer ? { kind: 'const', name, declaration } : { kind: 'other', name }
        }
        if (ts.isFunctionDeclaration(statement) && statement.name?.text === text) return { kind: 'function', name: statement.name, fn: statement }
        if ((ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement)) && statement.name?.text === text) return { kind: 'other', name: statement.name }
        if (ts.isImportDeclaration(statement) && statement.importClause) {
          const clause = statement.importClause, bound = clause.namedBindings
          const imported = [clause.name, bound && ts.isNamespaceImport(bound) ? bound.name : undefined, ...bound && ts.isNamedImports(bound) ? bound.elements.map(element => element.name) : []]
          const name = imported.find(value => value?.text === text)
          if (name) return { kind: 'import', name }
        }
      }
      if (ts.isSourceFile(scope) && hoistsVar(scope, text)) return { kind: 'other' }
    }
    if ((ts.isForStatement(scope) || ts.isForOfStatement(scope) || ts.isForInStatement(scope)) && scope.initializer && ts.isVariableDeclarationList(scope.initializer)) {
      for (const declaration of scope.initializer.declarations) {
        const name = match(declaration.name)
        if (name) return ts.isForOfStatement(scope) && !scope.awaitModifier && isConst(scope.initializer) ? { kind: 'loop', name, statement: scope, declaration } : { kind: 'other', name }
      }
    }
    if (ts.isCatchClause(scope) && scope.variableDeclaration && match(scope.variableDeclaration.name)) return { kind: 'other' }
    if (ts.isClassDeclaration(scope) && scope.name?.text === text) return { kind: 'other', name: scope.name }
    return undefined
  }
  const lookup = (id: ts.Identifier): Binding | undefined => {
    if (bindings.has(id)) return bindings.get(id)
    let found: Binding | undefined
    for (let scope: ts.Node | undefined = id.parent; scope && !found; scope = scope.parent) found = declaredIn(scope, id.text)
    bindings.set(id, found)
    return found
  }
  const referencesTo = (name: ts.Identifier): ts.Identifier[] => (references.get(name.text) ?? []).filter(id => lookup(id)?.name === name)
  const global = (id: ts.Expression): id is ts.Identifier => ts.isIdentifier(id) && !lookup(id)
  const layoutCall = (call: ts.CallExpression): LayoutFunction | undefined => {
    const callee = unwrap(call.expression)
    if (ts.isIdentifier(callee)) return lookup(callee)?.kind === 'import' ? options.calls.get(callee.text) : undefined
    if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && options.namespaces.has(callee.expression.text) && lookup(callee.expression)?.kind === 'import' && ['layoutText', 'layoutTable', 'layoutBoxes'].includes(callee.name.text)) return callee.name.text as LayoutFunction
    return undefined
  }
  const pureCall = (call: ts.CallExpression): boolean => {
    const callee = unwrap(call.expression)
    if (global(callee)) return PURE_GLOBALS.has(callee.text)
    if (!ts.isPropertyAccessExpression(callee) || !global(callee.expression)) return false
    const members = PURE_MEMBERS[callee.expression.text]
    return members === true || !!members?.has(callee.name.text)
  }
  const localFunction = (expression: ts.Expression): ts.SignatureDeclaration | undefined => {
    const callee = unwrap(expression)
    if (!ts.isIdentifier(callee)) return undefined
    const binding = lookup(callee)
    if (binding?.kind === 'function') return binding.fn
    if (binding?.kind === 'const' && binding.declaration.name === binding.name) {
      const value = unwrap(binding.declaration.initializer!)
      if (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) return value
    }
    return undefined
  }
  const enclosingFunction = (node: ts.Node, arrows: boolean): ts.SignatureDeclaration | undefined => {
    for (let scope: ts.Node | undefined = node.parent; scope; scope = scope.parent) if (ts.isFunctionLike(scope) && (arrows || !ts.isArrowFunction(scope))) return scope
    return undefined
  }
  const usesArguments = (fn: ts.SignatureDeclaration): boolean => (references.get('arguments') ?? []).some(id => !lookup(id) && enclosingFunction(id, false) === fn)

  /* 只读证明：表达式的值可能与受信对象共享引用，只有它的所有去向都不写入、不逃出可见范围才可信。 */
  const readOnlyNames = new Map<ts.Identifier, boolean>()
  const bindingReadOnly = (name: ts.BindingName): boolean => names(name).every(id => {
    const memo = readOnlyNames.get(id)
    if (memo !== undefined) return memo
    readOnlyNames.set(id, false) // 环路按不可证明处理
    const result = referencesTo(id).every(readOnly)
    readOnlyNames.set(id, result)
    return result
  })
  const callbackReadOnly = (argument: ts.Expression): boolean => {
    const value = unwrap(argument)
    const fn = ts.isArrowFunction(value) || ts.isFunctionExpression(value) ? value : localFunction(value)
    return !!fn && !usesArguments(fn) && fn.parameters.every(parameter => !parameter.dotDotDotToken && bindingReadOnly(parameter.name))
  }
  const argumentReadOnly = (call: ts.CallExpression | ts.NewExpression, position: number): boolean => {
    if (ts.isNewExpression(call)) return false
    if (layoutCall(call) || pureCall(call)) return true
    const fn = localFunction(call.expression), parameter = fn?.parameters[position]
    return !!parameter && !parameter.dotDotDotToken && !usesArguments(fn!) && bindingReadOnly(parameter.name)
  }
  const callbackResult = (fn: ts.SignatureDeclaration): boolean => {
    const call = fn.parent
    if (!ts.isCallExpression(call) || !call.arguments.includes(fn as ts.Expression)) return false
    const callee = unwrap(call.expression)
    if (!ts.isPropertyAccessExpression(callee) || !CALLBACKS[callee.name.text]) return false
    // 只有 map/flatMap/reduce 的结果包含回调返回值。
    return RESULT_CALLBACKS.has(callee.name.text) ? readOnly(call) : true
  }
  const writeTarget = (node: ts.Expression): boolean => {
    const parent = node.parent
    return ts.isBinaryExpression(parent) && assignment(parent.operatorToken.kind) && parent.left === node
      || (ts.isPrefixUnaryExpression(parent) || ts.isPostfixUnaryExpression(parent)) && [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(parent.operator)
      || ts.isDeleteExpression(parent) || (ts.isForOfStatement(parent) || ts.isForInStatement(parent)) && parent.initializer === node
  }
  const readOnly = (expression: ts.Expression): boolean => {
    const parent = expression.parent
    if (ts.isParenthesizedExpression(parent) || ts.isAsExpression(parent) || ts.isSatisfiesExpression(parent) || ts.isNonNullExpression(parent) || ts.isTypeAssertionExpression(parent)) return readOnly(parent)
    if (ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) {
      if (parent.expression !== expression) return true // 只作为键名读取
      const call = parent.parent
      if (ts.isCallExpression(call) && call.expression === parent) {
        const method = ts.isPropertyAccessExpression(parent) ? parent.name.text : literalKey(parent.argumentExpression)
        if (!method || !READ_METHODS.has(method)) return false
        if (CALLBACKS[method] && call.arguments[0] && !callbackReadOnly(call.arguments[0])) return false
        return ALIAS_METHODS.has(method) ? readOnly(call) : true
      }
      return !writeTarget(parent) && readOnly(parent)
    }
    if (ts.isCallExpression(parent) || ts.isNewExpression(parent)) {
      if (parent.expression === expression) return false
      const callee = unwrap(parent.expression)
      // 数据值（字面量或参数，不含作者方法）上的内置读方法不改写实参；concat/with 的结果包含实参。
      if (ts.isCallExpression(parent) && ts.isPropertyAccessExpression(callee) && READ_METHODS.has(callee.name.text) && !CALLBACKS[callee.name.text] && dataValue(callee.expression, new Set())) return ['concat', 'with'].includes(callee.name.text) ? readOnly(parent) : true
      return argumentReadOnly(parent, parent.arguments!.indexOf(expression))
    }
    if (ts.isSpreadElement(parent)) return ts.isArrayLiteralExpression(parent.parent) ? readOnly(parent.parent) : ts.isCallExpression(parent.parent) && (layoutCall(parent.parent) !== undefined || pureCall(parent.parent))
    if (ts.isSpreadAssignment(parent) || ts.isShorthandPropertyAssignment(parent) || ts.isPropertyAssignment(parent) && parent.initializer === expression) return readOnly(parent.parent as ts.ObjectLiteralExpression)
    if (ts.isArrayLiteralExpression(parent)) return readOnly(parent)
    if (ts.isBinaryExpression(parent)) {
      const operator = parent.operatorToken.kind
      if (assignment(operator)) return false
      if ([ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(operator)) return readOnly(parent)
      return operator !== ts.SyntaxKind.CommaToken || parent.left === expression || readOnly(parent)
    }
    if (ts.isConditionalExpression(parent)) return parent.condition === expression || readOnly(parent)
    if (ts.isPrefixUnaryExpression(parent) || ts.isPostfixUnaryExpression(parent)) return ![ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(parent.operator)
    // 标签模板把插值交给标签函数，属于逃出。
    if (ts.isTemplateSpan(parent)) return !ts.isTaggedTemplateExpression(parent.parent.parent)
    if (ts.isTypeOfExpression(parent) || ts.isVoidExpression(parent) || ts.isExpressionStatement(parent) || ts.isIfStatement(parent) || ts.isWhileStatement(parent) || ts.isDoStatement(parent) || ts.isSwitchStatement(parent) || ts.isCaseClause(parent) || ts.isForStatement(parent) || ts.isForInStatement(parent) && parent.expression === expression) return true
    if (ts.isVariableDeclaration(parent) && parent.initializer === expression) return isConst(parent.parent) && !exported(parent) && bindingReadOnly(parent.name)
    if (ts.isForOfStatement(parent) && parent.expression === expression) return isConst(parent.initializer) && (parent.initializer as ts.VariableDeclarationList).declarations.every(declaration => bindingReadOnly(declaration.name))
    if (ts.isArrowFunction(parent) && parent.body === expression) return callbackResult(parent)
    if (ts.isReturnStatement(parent)) { const fn = enclosingFunction(parent, true); return !!fn && callbackResult(fn) }
    return false
  }
  /**
   * 值按声明形态只由作者参数、字面量与内置读方法构成，因此它的方法都是内置方法。
   * 这里不证明未被改写（那是 readOnly 的职责），否则证明 params 只读时会依赖 params 自身。
   */
  const dataValue = (expression: ts.Expression, seen: Set<ts.Node>): boolean => {
    const node = unwrap(expression)
    if (seen.has(node)) return false // 自引用
    seen.add(node)
    try { return dataShape(node, seen) } finally { seen.delete(node) }
  }
  const dataShape = (node: ts.Expression, seen: Set<ts.Node>): boolean => {
    if (ts.isStringLiteralLike(node) || ts.isTemplateExpression(node) || ts.isNumericLiteral(node)) return true
    if (ts.isArrayLiteralExpression(node)) return node.elements.every(item => ts.isOmittedExpression(item) || dataValue(ts.isSpreadElement(item) ? item.expression : item, seen))
    if (ts.isObjectLiteralExpression(node)) return node.properties.every(property => ts.isPropertyAssignment(property) ? dataValue(property.initializer, seen) : ts.isShorthandPropertyAssignment(property) ? dataValue(property.name, seen) : ts.isSpreadAssignment(property) && dataValue(property.expression, seen))
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) return dataValue(node.expression, seen)
    if (ts.isConditionalExpression(node)) return dataValue(node.whenTrue, seen) && dataValue(node.whenFalse, seen)
    if (ts.isBinaryExpression(node)) return !assignment(node.operatorToken.kind) && ([ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(node.operatorToken.kind) ? dataValue(node.left, seen) && dataValue(node.right, seen) : true)
    if (ts.isCallExpression(node)) {
      const callee = unwrap(node.expression), callback = node.arguments[0] && unwrap(node.arguments[0])
      if (!ts.isPropertyAccessExpression(callee) || !READ_METHODS.has(callee.name.text) || !dataValue(callee.expression, seen)) return false
      if (!RESULT_CALLBACKS.has(callee.name.text)) return true
      return !!callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) && returns(callback).every(item => dataValue(item, seen))
    }
    if (!ts.isIdentifier(node)) return false
    const binding = lookup(node)
    if (!binding) return node.text === 'params'
    if (binding.kind === 'const') return dataValue(binding.declaration.initializer!, seen)
    if (binding.kind === 'loop') return dataValue(binding.statement.expression, seen)
    if (binding.kind !== 'parameter') return false
    const callback = callbackSource(binding)
    return callback ? callback.kind === 'index' || dataValue(callback.receiver, seen) : authorParameter(binding)
  }
  const exported = (declaration: ts.VariableDeclaration): boolean => {
    const statement = declaration.parent.parent
    return ts.isVariableStatement(statement) && !!statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)
  }
  const primitiveSyntax = (node: ts.Expression): boolean => {
    const value = unwrap(node)
    return ts.isStringLiteralLike(value) || ts.isTemplateExpression(value) || ts.isNumericLiteral(value) || ts.isBigIntLiteral(value) || [ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword, ts.SyntaxKind.NullKeyword].includes(value.kind)
  }
  const trustedConst = (binding: Extract<Binding, { kind: 'const' }>): boolean => binding.declaration.name === binding.name && primitiveSyntax(binding.declaration.initializer!) || !exported(binding.declaration) && bindingReadOnly(binding.name)

  /* 作者参数：宿主入口 draw/layers/frameKey 的 params，或每个调用点都原样传入作者参数的本地函数形参。 */
  const authorMemo = new Map<ts.ParameterDeclaration, boolean>()
  let unboundParams: boolean | undefined
  const authorParameter = (binding: Extract<Binding, { kind: 'parameter' }>): boolean => {
    const memo = authorMemo.get(binding.parameter)
    if (memo !== undefined) return memo
    authorMemo.set(binding.parameter, false)
    const fn = binding.fn, position = fn.parameters.indexOf(binding.parameter)
    const owner = ts.isMethodDeclaration(fn) ? fn.name : (ts.isFunctionExpression(fn) || ts.isArrowFunction(fn)) && ts.isPropertyAssignment(fn.parent) && fn.parent.initializer === fn ? fn.parent.name : undefined
    const entry = (key: string | undefined): boolean => !!key && ENTRY_METHODS.has(key) && binding.name.text === 'params'
    const name = ts.isFunctionDeclaration(fn) ? fn.name : (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) && ts.isVariableDeclaration(fn.parent) && fn.parent.initializer === fn && isConst(fn.parent.parent) && ts.isIdentifier(fn.parent.name) ? fn.parent.name : undefined
    const calls = name ? referencesTo(name) : []
    const result = binding.parameter.name === binding.name && !binding.parameter.dotDotDotToken && (owner ? entry(staticKey(owner)) : calls.length > 0 && calls.every(ref => {
      if (ts.isPropertyAssignment(ref.parent) && ref.parent.initializer === ref) return entry(staticKey(ref.parent.name))
      const call = ref.parent, argument = ts.isCallExpression(call) && call.expression === ref ? call.arguments[position] : undefined
      return !!argument && ts.isIdentifier(unwrap(argument)) && authorParams(unwrap(argument) as ts.Identifier)
    }))
    authorMemo.set(binding.parameter, result)
    return result
  }
  const authorParams = (id: ts.Identifier): boolean => {
    const binding = lookup(id)
    if (!binding) return id.text === 'params' && (unboundParams ??= (references.get('params') ?? []).filter(ref => !lookup(ref)).every(readOnly))
    return binding.kind === 'parameter' && authorParameter(binding) && bindingReadOnly(binding.name)
  }

  /* 求值：同时收集字符并给出覆盖等级。 */
  const evaluating = new Set<ts.Identifier>()
  const callbackSource = (binding: Extract<Binding, { kind: 'parameter' }>): { kind: 'element' | 'index' | 'array'; receiver: ts.Expression } | undefined => {
    const fn = binding.fn, call = fn.parent
    if (!(ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) || !ts.isCallExpression(call) || call.arguments[0] !== fn) return undefined
    const callee = unwrap(call.expression)
    if (!ts.isPropertyAccessExpression(callee)) return undefined
    const kind = CALLBACKS[callee.name.text]?.[fn.parameters.indexOf(binding.parameter)]
    return kind && { kind, receiver: callee.expression }
  }
  // 解构出的值：首层静态键精确读取，更深层按来源整体覆盖；默认值同样要可证明。
  const destructured = (name: ts.Identifier, root: ts.BindingName, value: (key?: string) => Known): Known => {
    let defaults: Known = TEXT
    for (let node: ts.Node = name; node !== root; node = node.parent) if (ts.isBindingElement(node) && node.initializer) defaults = least(defaults, known(node.initializer))
    const element = name.parent
    const key = ts.isBindingElement(element) && element.name === name && element.parent === root && ts.isObjectBindingPattern(root) && !element.dotDotDotToken ? staticKey(element.propertyName ?? name) : undefined
    return least(key !== undefined ? value(key) : least(value(), VALUE), defaults)
  }
  const identifier = (node: ts.Identifier): Known => {
    const binding = lookup(node)
    if (!binding) {
      if (['undefined', 'NaN', 'Infinity'].includes(node.text)) { collect(node.text); return PRIMITIVE }
      return NONE
    }
    if (binding.kind === 'const') {
      if (evaluating.has(binding.name)) return NONE
      evaluating.add(binding.name)
      try {
        const initializer = binding.declaration.initializer!
        const value = binding.declaration.name === binding.name ? known(initializer) : destructured(binding.name, binding.declaration.name, key => key === undefined ? known(initializer) : member(initializer, key))
        return value >= PRIMITIVE || trustedConst(binding) ? value : NONE
      } finally { evaluating.delete(binding.name) }
    }
    if (binding.kind === 'loop' || binding.kind === 'parameter') {
      if (evaluating.has(binding.name)) return NONE
      evaluating.add(binding.name)
      try {
        let value: Known
        if (binding.kind === 'loop') value = binding.declaration.name === binding.name ? element(binding.statement.expression) : destructured(binding.name, binding.declaration.name, () => element(binding.statement.expression))
        else {
          const callback = callbackSource(binding)
          if (callback?.kind === 'index') { collect('0123456789'); return PRIMITIVE }
          const source = (): Known => callback?.kind === 'element' ? element(callback.receiver) : callback?.kind === 'array' ? known(callback.receiver) : NONE
          value = binding.parameter.name === binding.name ? source() : destructured(binding.name, binding.parameter.name, source)
          if (binding.parameter.initializer) value = least(value, known(binding.parameter.initializer))
        }
        return value >= PRIMITIVE || bindingReadOnly(binding.name) ? value : NONE
      } finally { evaluating.delete(binding.name) }
    }
    return NONE
  }
  /** 受信常量最终指向的对象或数组字面量。 */
  const literal = (expression: ts.Expression): ts.ObjectLiteralExpression | ts.ArrayLiteralExpression | undefined => {
    const node = unwrap(expression)
    if (ts.isObjectLiteralExpression(node) || ts.isArrayLiteralExpression(node)) return node
    if (!ts.isIdentifier(node)) return undefined
    const binding = lookup(node)
    if (binding?.kind !== 'const' || binding.declaration.name !== binding.name || evaluating.has(binding.name) || !trustedConst(binding)) return undefined
    evaluating.add(binding.name)
    try { return literal(binding.declaration.initializer!) } finally { evaluating.delete(binding.name) }
  }
  const member = (base: ts.Expression, key: string | undefined): Known => {
    const root = unwrap(base)
    if (ts.isIdentifier(root) && authorParams(root)) {
      if (key === undefined) return NONE
      parameters.add(key); return VALUE
    }
    if (key === 'length') { if (!known(base)) return NONE; collect('0123456789'); return PRIMITIVE }
    const value = literal(base)
    if (value && key !== undefined) {
      if (ts.isArrayLiteralExpression(value) && /^\d+$/.test(key)) {
        const position = Number(key)
        if (!value.elements.slice(0, position + 1).some(ts.isSpreadElement)) {
          const item = value.elements[position]
          if (!item || ts.isOmittedExpression(item)) { collect('undefined'); return PRIMITIVE }
          return known(item)
        }
      }
      if (ts.isObjectLiteralExpression(value)) {
        for (const property of [...value.properties].reverse()) {
          if (ts.isSpreadAssignment(property) || !property.name || staticKey(property.name) === undefined) break
          if (staticKey(property.name) !== key) continue
          if (ts.isPropertyAssignment(property)) return known(property.initializer)
          if (ts.isShorthandPropertyAssignment(property)) return known(property.name)
          return NONE
        }
      }
    }
    return least(known(base), VALUE)
  }
  /** 迭代或下标取得的任一元素。 */
  const element = (expression: ts.Expression): Known => {
    const value = literal(expression)
    if (value && ts.isArrayLiteralExpression(value)) return value.elements.reduce<Known>((result, item) => least(result, ts.isSpreadElement(item) ? element(item.expression) : ts.isOmittedExpression(item) ? (collect('undefined'), PRIMITIVE) : known(item)), TEXT)
    const whole = known(expression)
    return whole === TEXT ? TEXT : least(whole, VALUE)
  }
  const converted = (value: Known): Known => { if (value === VALUE) collect(CONVERTED_TEXT); return value }
  const jsonLeaves = (value: unknown): void => {
    if (typeof value === 'string') collect(value)
    else if (Array.isArray(value)) value.forEach(jsonLeaves)
    else if (value && typeof value === 'object') Object.values(value).forEach(jsonLeaves)
    else collect(String(value))
  }
  const stringLiteral = (expression: ts.Expression): string | undefined => {
    const node = unwrap(expression)
    if (ts.isStringLiteralLike(node)) return node.text
    const binding = ts.isIdentifier(node) ? lookup(node) : undefined
    return binding?.kind === 'const' && binding.declaration.name === binding.name && !evaluating.has(binding.name) ? stringLiteral(binding.declaration.initializer!) : undefined
  }
  /** 作者参数的纯成员链（不经过任何方法调用）返回首层键名。 */
  const parameterChain = (expression: ts.Expression): string | undefined => {
    let node = unwrap(expression), key: string | undefined
    while (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      key = ts.isPropertyAccessExpression(node) ? node.name.text : literalKey(node.argumentExpression)
      node = unwrap(node.expression)
    }
    return key !== undefined && ts.isIdentifier(node) && authorParams(node) ? key : undefined
  }
  const call = (node: ts.CallExpression): Known => {
    const callee = unwrap(node.expression), [first, second] = node.arguments
    if (global(callee)) {
      if (callee.text === 'String') return first ? converted(known(first)) && TEXT : TEXT
      if (['Number', 'parseInt', 'parseFloat'].includes(callee.text)) { collect(NUMBER_TEXT); return PRIMITIVE }
      if (['isNaN', 'isFinite', 'Boolean'].includes(callee.text)) { collect('truefalse'); return PRIMITIVE }
      return NONE
    }
    if (!ts.isPropertyAccessExpression(callee)) return NONE
    const method = callee.name.text, receiver = callee.expression
    if (global(unwrap(receiver))) {
      const owner = (unwrap(receiver) as ts.Identifier).text
      if (owner === 'Math' || owner === 'Number' && ['parseInt', 'parseFloat'].includes(method)) { collect(NUMBER_TEXT); return PRIMITIVE }
      if (owner === 'JSON' && method === 'parse' && first) {
        const text = stringLiteral(first)
        if (text !== undefined) { try { jsonLeaves(JSON.parse(text)) } catch { /* 运行时同样抛错，不会绘制 */ } return VALUE }
        const key = parameterChain(first)
        if (key === undefined) return NONE
        parameters.add(key); return VALUE
      }
      return NONE
    }
    const value = known(receiver)
    if (!value) return NONE
    const callback = first && unwrap(first)
    switch (method) {
      // 准备时总会加入大写形式，toUpperCase 的结果因此可证明。
      case 'substring': case 'substr': case 'trim': case 'trimStart': case 'trimEnd': case 'trimLeft': case 'trimRight': case 'charAt': case 'repeat': case 'toUpperCase': return TEXT
      case 'slice': return value === TEXT ? TEXT : VALUE
      case 'at': case 'split': case 'filter': case 'find': case 'findLast': case 'reverse': case 'toReversed': case 'sort': case 'toSorted': case 'flat': case 'valueOf': return VALUE
      case 'padStart': case 'padEnd': return second ? converted(known(second)) && TEXT : (collect(' '), TEXT)
      case 'join': {
        const separator = first ? converted(known(first)) : (collect(','), TEXT)
        return separator && converted(element(receiver)) && TEXT
      }
      case 'concat': {
        const items = node.arguments.map(argument => known(argument))
        if (items.some(item => !item)) return NONE
        if (value !== TEXT) return VALUE
        items.forEach(converted); return TEXT
      }
      case 'replace': case 'replaceAll': return second ? converted(known(second)) && TEXT : NONE
      case 'toFixed': case 'toPrecision': case 'toExponential': collect(NUMBER_TEXT); return TEXT
      case 'toString':
        if (first) { collect(RADIX_TEXT); return TEXT }
        return value === VALUE ? converted(value) && TEXT : TEXT
      case 'includes': case 'indexOf': case 'lastIndexOf': case 'startsWith': case 'endsWith': case 'some': case 'every': case 'findIndex': case 'findLastIndex': case 'localeCompare': case 'charCodeAt': case 'codePointAt':
        collect(CONVERTED_TEXT); return PRIMITIVE
      case 'map': case 'flatMap':
        if (!callback || !(ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))) return NONE
        return returns(callback).reduce<Known>((result, item) => least(result, known(item)), TEXT) && VALUE
      default: return NONE
    }
  }
  const known = (input: ts.Expression): Known => {
    const node = unwrap(input)
    if (ts.isStringLiteralLike(node)) { collect(node.text); return TEXT }
    if (ts.isNumericLiteral(node)) { collect(String(Number(node.text))); return PRIMITIVE }
    if (ts.isBigIntLiteral(node)) { collect(NUMBER_TEXT); return PRIMITIVE }
    if ([ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword, ts.SyntaxKind.NullKeyword].includes(node.kind)) { collect(node.getText(source)); return PRIMITIVE }
    if (ts.isTemplateExpression(node)) {
      collect(node.head.text)
      for (const span of node.templateSpans) {
        if (!converted(known(span.expression))) return NONE
        collect(span.literal.text)
      }
      return TEXT
    }
    if (ts.isIdentifier(node)) return identifier(node)
    if (ts.isPropertyAccessExpression(node)) return member(node.expression, node.name.text)
    if (ts.isElementAccessExpression(node)) {
      const key = literalKey(node.argumentExpression)
      if (key !== undefined) return member(node.expression, key)
      const root = unwrap(node.expression)
      if (ts.isIdentifier(root) && authorParams(root)) return NONE
      return least(element(node.expression), VALUE)
    }
    if (ts.isCallExpression(node)) return call(node)
    if (ts.isConditionalExpression(node)) return least(known(node.whenTrue), known(node.whenFalse))
    if (ts.isPrefixUnaryExpression(node)) {
      if (node.operator === ts.SyntaxKind.ExclamationToken) { collect('truefalse'); return PRIMITIVE }
      collect(NUMBER_TEXT); return PRIMITIVE
    }
    if (ts.isPostfixUnaryExpression(node)) { collect(NUMBER_TEXT); return PRIMITIVE }
    if (ts.isTypeOfExpression(node)) { collect('undefinedobjectbooleannumberstringfunctionsymbolbigint'); return TEXT }
    if (ts.isVoidExpression(node)) { collect('undefined'); return PRIMITIVE }
    if (ts.isBinaryExpression(node)) {
      const operator = node.operatorToken.kind
      if (assignment(operator)) return NONE
      if (operator === ts.SyntaxKind.CommaToken) return known(node.right)
      if ([ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(operator)) return least(known(node.left), known(node.right))
      if (operator === ts.SyntaxKind.PlusToken) {
        const left = known(node.left), right = left && known(node.right)
        if (!left || !right) return NONE
        if (left === TEXT && right === TEXT) return TEXT
        if (left === TEXT || right === TEXT) { converted(left); converted(right); return TEXT }
        collect(CONVERTED_TEXT); return PRIMITIVE // 可能是数字相加
      }
      // 其余二元运算的结果只能是数字或布尔。
      collect(CONVERTED_TEXT); return PRIMITIVE
    }
    if (ts.isArrayLiteralExpression(node)) return node.elements.reduce<Known>((result, item) => result && least(result, ts.isSpreadElement(item) ? known(item.expression) : ts.isOmittedExpression(item) ? VALUE : known(item)), VALUE)
    if (ts.isObjectLiteralExpression(node)) return node.properties.reduce<Known>((result, property) => result && least(result,
      ts.isPropertyAssignment(property) ? known(property.initializer) : ts.isShorthandPropertyAssignment(property) ? known(property.name) : ts.isSpreadAssignment(property) ? known(property.expression) : NONE), VALUE)
    return NONE
  }

  /* 按排版库的输入结构下行，只进入承载文字的位置。 */
  const text = (input: ts.Expression): void => { if (!known(input)) dynamic = true }
  const scan = (input: ts.Expression, role: Role, table: ts.Expression | undefined, active: ReadonlySet<ts.Node>): void => {
    const node = unwrap(input)
    if (active.has(node)) return
    const next = new Set(active).add(node)
    if (ts.isConditionalExpression(node)) { scan(node.whenTrue, role, table, next); scan(node.whenFalse, role, table, next); return }
    if (ts.isBinaryExpression(node) && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.CommaToken].includes(node.operatorToken.kind)) {
      if (node.operatorToken.kind !== ts.SyntaxKind.CommaToken) scan(node.left, role, table, next)
      scan(node.right, role, table, next); return
    }
    if (ts.isIdentifier(node)) {
      const binding = lookup(node)
      if (binding?.kind === 'const' && binding.declaration.name === binding.name && trustedConst(binding)) { scan(binding.declaration.initializer!, role, table, next); return }
      if (binding?.kind === 'loop' && binding.declaration.name === binding.name && bindingReadOnly(binding.name)) { scan(binding.statement.expression, { each: role }, table, next); return }
      const callback = binding?.kind === 'parameter' && binding.parameter.name === binding.name && !binding.parameter.initializer ? callbackSource(binding) : undefined
      if (callback?.kind === 'element' && bindingReadOnly(binding!.name!)) { scan(callback.receiver, { each: role }, table, next); return }
      text(node); return
    }
    if (typeof role === 'object') {
      if (ts.isArrayLiteralExpression(node)) {
        for (const item of node.elements) if (!ts.isOmittedExpression(item)) scan(ts.isSpreadElement(item) ? item.expression : item, ts.isSpreadElement(item) ? role : role.each, table, next)
        return
      }
      const callee = ts.isCallExpression(node) ? unwrap(node.expression) : undefined
      if (callee && ts.isPropertyAccessExpression(callee) && ts.isCallExpression(node)) {
        const method = callee.name.text, callback = node.arguments[0] && unwrap(node.arguments[0])
        if ((method === 'map' || method === 'flatMap') && callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))) {
          for (const result of returns(callback)) scan(result, method === 'map' ? role.each : role, table, next)
          return
        }
        if (['filter', 'slice', 'reverse', 'toReversed', 'sort', 'toSorted', 'concat', 'flat'].includes(method)) {
          scan(callee.expression, role, table, next)
          if (method === 'concat') node.arguments.forEach(argument => scan(argument, role, table, next))
          return
        }
      }
      if (ts.isObjectLiteralExpression(node)) { scan(node, role.each, table, next); return }
      text(node); return
    }
    if (ts.isArrayLiteralExpression(node)) { node.elements.forEach(item => { if (!ts.isOmittedExpression(item)) scan(ts.isSpreadElement(item) ? item.expression : item, role, table, next) }); return }
    if (!ts.isObjectLiteralExpression(node)) { text(node); return }
    for (const property of node.properties) {
      if (ts.isSpreadAssignment(property)) { scan(property.expression, role, table, next); continue }
      const key = property.name && staticKey(property.name)
      const value = ts.isPropertyAssignment(property) ? property.initializer : ts.isShorthandPropertyAssignment(property) ? property.name : undefined
      if (role === 'row') {
        if (value) scan(value, 'cell', table, next)
        else if (ts.isGetAccessor(property)) dynamic = true
        continue
      }
      const target = key === undefined ? undefined : FIELDS[role][key]
      if (key === undefined) {
        // 计算键可能就是文字键：值必须整体可证明。
        if (value) text(value)
        else if (ts.isGetAccessor(property)) dynamic = true
        continue
      }
      if (!target) continue
      if (!value) { if (ts.isGetAccessor(property) && target !== 'style') dynamic = true; continue }
      if (target === 'style') options.style(value, role === 'cell' ? table : undefined)
      else scan(value, target, table, next)
    }
  }

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const name = layoutCall(node)
      if (name) {
        calls.push({ call: node, name })
        const [first, second] = node.arguments
        if (name === 'layoutText') {
          if (first) scan(first, 'text', undefined, new Set())
          if (second) options.style(second)
        } else if (name === 'layoutTable') {
          // 数字列先排出 0–9 检查等宽数字。
          collect('0123456789')
          if (first) scan(first, 'table', first, new Set())
        } else if (first) scan(first, 'node', undefined, new Set())
      }
      // 运行时说明符可能载入未经分析的模块。
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword && !(node.arguments[0] && ts.isStringLiteralLike(node.arguments[0]) && !/^henji-layout(?:\/|$)/.test(node.arguments[0].text))) dynamic = true
    }
    if (ts.isIdentifier(node) && isReference(node)) {
      const binding = lookup(node)
      // 排版函数只允许直接调用；被别名、传递或导出后无法知道它排了什么文字。
      if (binding?.kind === 'import' && (options.calls.has(node.text) || options.namespaces.has(node.text))) {
        const parent = node.parent
        const direct = ts.isCallExpression(parent) && parent.expression === node && options.calls.has(node.text)
        const member = ts.isPropertyAccessExpression(parent) && parent.expression === node && options.namespaces.has(node.text) && (!['layoutText', 'layoutTable', 'layoutBoxes'].includes(parent.name.text) || ts.isCallExpression(parent.parent) && parent.parent.expression === parent)
        if (!direct && !member) dynamic = true
      }
      // 直接 eval 能读写本模块的常量。
      if (node.text === 'eval' && !binding) dynamic = true
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return { text: collected, parameters: [...parameters], dynamic, calls }
}
