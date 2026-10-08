import ts from 'typescript'
import { CODE_V3_LIMITS, assertCodeMaterialKey, CodeMaterialError, type CodeSourceSpan } from './contract'
import { normalizeCodeMaterialFiles, type CodeMaterialFiles } from './sources'

export function originalCodeSourceSpan(node: ts.Node): CodeSourceSpan {
  const original = ts.getOriginalNode(node); const file = original.getSourceFile()
  const start = original.getStart(file); const end = original.getEnd()
  const a = file.getLineAndCharacterOfPosition(start); const b = file.getLineAndCharacterOfPosition(end)
  return { file: file.fileName, start, end, startLine: a.line + 1, startColumn: a.character + 1, endLine: b.line + 1, endColumn: b.character + 1 }
}
function fail(node: ts.Node, message: string): never { const span = originalCodeSourceSpan(node); throw new CodeMaterialError('SYNTAX', message, span) }
export function resolveCodeImportPath(from: string, request: string, node: ts.Node): string {
  if (!/^(\.\/|\.\.\/)/.test(request)) fail(node, '导入只能使用 ./ 或 ../ 相对路径。')
  const parts = from.split('/').slice(0, -1)
  for (const part of request.split('/')) {
    if (part === '.') continue
    if (part === '..') { if (!parts.length) fail(node, '导入路径不能逃出版本根目录。'); parts.pop() } else parts.push(part)
  }
  const path = parts.join('/'); return path.endsWith('.ts') ? path : `${path}.ts`
}
interface Module { file: ts.SourceFile; names: Map<string, string>; exports: Map<string, string>; declarations: ts.VariableStatement[]; imports: ts.ImportDeclaration[] }
/** Link parsed ASTs only; no author JavaScript, transpilation or runtime loader. */
export function linkCodeMaterialFiles(input: string | CodeMaterialFiles): { file: ts.SourceFile; astNodes: number; astDepth: number } {
  const contents = normalizeCodeMaterialFiles(input); const modules = new Map<string, Module>(); let astNodes = 0; let astDepth = 0
  for (const [path, source] of Object.entries(contents.files)) {
    let file: ts.SourceFile
    try { file = ts.createSourceFile(path, source, ts.ScriptTarget.ES2020, true, ts.ScriptKind.TS) } catch { throw new CodeMaterialError('SYNTAX', `${path} 源码无法解析或嵌套过深。`) }
    const diagnostics = (file as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics
    if (diagnostics.length) {
      const diagnostic = diagnostics[0]; const start = diagnostic.start ?? 0; const position = file.getLineAndCharacterOfPosition(start)
      throw new CodeMaterialError('SYNTAX', `源码语法无效：${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`, { file: path, start, end: start + (diagnostic.length ?? 1), startLine: position.line + 1, startColumn: position.character + 1, endLine: position.line + 1, endColumn: position.character + 2 })
    }
    const stack = [{ node: file as ts.Node, depth: 0 }]
    while (stack.length) {
      const current = stack.pop()!; astNodes++; astDepth = Math.max(astDepth, current.depth)
      if (astNodes > CODE_V3_LIMITS.astNodes || astDepth > CODE_V3_LIMITS.depth) throw new CodeMaterialError('BUDGET', '全部文件的 AST 数量或深度超出编译预算。', originalCodeSourceSpan(current.node))
      ts.forEachChild(current.node, node => { stack.push({ node, depth: current.depth + 1 }) })
    }
    const module: Module = { file, names: new Map(), exports: new Map(), declarations: [], imports: [] }; modules.set(path, module)
    let declarationsStarted = false
    for (const statement of file.statements) {
      if (ts.isImportDeclaration(statement)) {
        if (declarationsStarted) fail(statement, 'import 必须位于文件顶部。')
        if (!ts.isStringLiteral(statement.moduleSpecifier) || statement.importClause?.isTypeOnly || statement.importClause?.name || !statement.importClause?.namedBindings || !ts.isNamedImports(statement.importClause.namedBindings) || statement.attributes || statement.importClause.namedBindings.elements.some(element => element.isTypeOnly)) fail(statement, '只允许 import { 名称, 名称 as 别名 } from "./模块"。')
        module.imports.push(statement); continue
      }
      declarationsStarted = true
      if (path === contents.entry && ts.isExportAssignment(statement)) {
        if (statement !== file.statements.at(-1) || statement.isExportEquals) fail(statement, '入口只允许最后一个 export default。')
        continue
      }
      if (!ts.isVariableStatement(statement) || (statement.declarationList.flags & ts.NodeFlags.Const) === 0 || statement.modifiers?.some(modifier => modifier.kind !== ts.SyntaxKind.ExportKeyword) || path === contents.entry && statement.modifiers?.length) fail(statement, path === contents.entry ? '入口顶层只允许 const、纯箭头 helper 和最后的 export default。' : '模块只允许 import、const 或 export const；禁止默认导出和副作用语句。')
      module.declarations.push(statement)
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer) fail(declaration, '顶层声明必须有名称与初始化表达式。')
        const name = declaration.name.text
        try { assertCodeMaterialKey(name) } catch (error) { fail(declaration, error instanceof Error ? error.message : '顶层名称无效。') }
        if (module.names.has(name)) fail(declaration, `重复名称：${name}`)
        const renamed = Object.keys(contents.files).length === 1 ? name : `file${modules.size}value${module.names.size}`; module.names.set(name, renamed)
        if (statement.modifiers?.length) module.exports.set(name, renamed)
      }
    }
  }
  const entry = modules.get(contents.entry)!
  const exported = entry.file.statements.at(-1)
  if (!exported || !ts.isExportAssignment(exported) || exported.isExportEquals || !ts.isObjectLiteralExpression(exported.expression)) fail(entry.file, '入口必须以 export default 静态对象结束。')
  const v3 = exported.expression.properties.some(property => ts.isPropertyAssignment(property) && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) && property.name.text === 'languageVersion' && ts.isNumericLiteral(property.initializer) && property.initializer.text === '3')
  if (!v3 && (contents.entry !== 'main.ts' || modules.size !== 1 || entry.imports.length || entry.declarations.length)) fail(entry.file, 'v1/v2 只能使用单文件 main.ts；多文件与顶层声明需要 languageVersion: 3。')
  if (!v3) return { file: entry.file, astNodes, astDepth }
  const order: Module[] = []; const visited = new Set<string>(); const active: string[] = []
  const visit = (path: string, caller?: ts.Node): void => {
    if (active.includes(path)) fail(caller ?? modules.get(path)!.file, `循环依赖：${[...active.slice(active.indexOf(path)), path].join(' → ')}`)
    if (visited.has(path)) return
    const module = modules.get(path)!
    if (active.length >= CODE_V3_LIMITS.depth) throw new CodeMaterialError('BUDGET', '模块依赖深度超出编译预算。', originalCodeSourceSpan(caller ?? module.file))
    active.push(path)
    for (const declaration of module.imports) {
      const specifier = (declaration.moduleSpecifier as ts.StringLiteral).text
      const target = contents.resolvedImports?.[path]?.[specifier] ?? resolveCodeImportPath(path, specifier, declaration)
      const dependency = modules.get(target)
      if (!dependency) fail(declaration, `导入文件 ${target} 不存在；可用文件：${[...modules.keys()].join('、')}`)
      visit(target, declaration)
      if (target === contents.entry) fail(declaration, '入口不能被作为模块导入。')
      for (const element of (declaration.importClause!.namedBindings as ts.NamedImports).elements) {
        const name = element.propertyName?.text ?? element.name.text; const renamed = dependency.exports.get(name)
        if (!renamed) fail(element, `${target} 没有导出 ${name}；可用导出：${[...dependency.exports.keys()].join('、') || '无'}`)
        if (module.names.has(element.name.text)) fail(element, `重复名称：${element.name.text}`)
        module.names.set(element.name.text, renamed)
      }
    }
    active.pop(); visited.add(path); order.push(module)
  }
  visit(contents.entry)
  // Validate unused files too: saving a version cannot hide a broken module.
  for (const path of modules.keys()) visit(path)
  const constants = new Map<string, ts.Expression>(); const top: ts.Statement[] = []; let root: ts.ExportAssignment | undefined
  const rename = (module: Module): ts.SourceFile => {
    const transformed = ts.transform(module.file, [context => {
      const walk = (node: ts.Node, shadows: ReadonlySet<string>): ts.Node => {
        let local = shadows
        if (ts.isArrowFunction(node) || ts.isMethodDeclaration(node)) local = new Set([...shadows, ...node.parameters.flatMap(parameter => ts.isIdentifier(parameter.name) ? [parameter.name.text] : [])])
        if (ts.isBlock(node)) local = new Set([...local, ...node.statements.flatMap(statement => ts.isVariableStatement(statement) ? statement.declarationList.declarations.flatMap(declaration => ts.isIdentifier(declaration.name) ? [declaration.name.text] : []) : [])])
        if (ts.isIdentifier(node) && /^file\d+value\d+$/.test(node.text) && !local.has(node.text) && !module.names.has(node.text)) fail(node, `未声明的模块名称：${node.text}`)
        if (ts.isIdentifier(node) && !local.has(node.text) && module.names.has(node.text)) {
          const parent = node.parent
          if (!(parent && ((ts.isPropertyAssignment(parent) || ts.isMethodDeclaration(parent) || ts.isPropertyAccessExpression(parent)) && parent.name === node))) return ts.setOriginalNode(ts.factory.createIdentifier(module.names.get(node.text)!), node)
        }
        return ts.visitEachChild(node, child => walk(child, local), context)
      }
      return file => walk(file, new Set()) as ts.SourceFile
    }])
    const result = transformed.transformed[0]; transformed.dispose(); return result
  }
  for (const module of order) for (const statement of rename(module).statements) {
    if (ts.isVariableStatement(statement)) {
      const value = ts.factory.updateVariableStatement(statement, undefined, statement.declarationList); top.push(value)
      for (const declaration of value.declarationList.declarations) if (ts.isIdentifier(declaration.name) && declaration.initializer && !ts.isArrowFunction(declaration.initializer)) constants.set(declaration.name.text, declaration.initializer)
    } else if (module === entry && ts.isExportAssignment(statement)) root = statement
  }
  // Static entry declarations may reference literal constants, including nested imported objects/arrays.
  let expansionNodes = 0
  const expand = (node: ts.Node, chain = new Set<string>()): ts.Node => {
    if (++expansionNodes > CODE_V3_LIMITS.astNodes) throw new CodeMaterialError('BUDGET', '静态声明展开超出 AST 预算。', originalCodeSourceSpan(node))
    const parent = ts.getOriginalNode(node).parent
    if (parent && ts.isPropertyAssignment(parent) && parent.name === ts.getOriginalNode(node)) return node
    if (ts.isIdentifier(node) && constants.has(node.text)) {
      if (chain.has(node.text)) fail(node, '静态常量循环引用。')
      return expand(constants.get(node.text)!, new Set([...chain, node.text]))
    }
    const result = ts.transform(node, [context => value => ts.visitEachChild(value, child => expand(child, chain), context)]); const value = result.transformed[0]; result.dispose(); return value
  }
  const expression = root!.expression as ts.ObjectLiteralExpression
  root = ts.factory.updateExportAssignment(root!, root!.modifiers, ts.factory.updateObjectLiteralExpression(expression, expression.properties.map(property => ts.isPropertyAssignment(property) ? ts.factory.updatePropertyAssignment(property, property.name, expand(property.initializer) as ts.Expression) : property)))
  const literal = (node: ts.Expression, chain = new Set<string>()): boolean => {
    if (ts.isIdentifier(node)) return !chain.has(node.text) && constants.has(node.text) && literal(constants.get(node.text)!, new Set([...chain, node.text]))
    if (ts.isParenthesizedExpression(node)) return literal(node.expression, chain)
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isNumericLiteral(node) || [ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword, ts.SyntaxKind.NullKeyword].includes(node.kind)) return true
    if (ts.isPrefixUnaryExpression(node)) return [ts.SyntaxKind.PlusToken, ts.SyntaxKind.MinusToken].includes(node.operator) && ts.isNumericLiteral(node.operand)
    if (ts.isArrayLiteralExpression(node)) return node.elements.every(value => literal(value, chain))
    return ts.isObjectLiteralExpression(node) && node.properties.every(property => ts.isPropertyAssignment(property) && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) && literal(property.initializer, chain))
  }
  const required = new Set<string>()
  const references = (node: ts.Node): void => { if (ts.isIdentifier(node) && constants.has(node.text)) required.add(node.text); ts.forEachChild(node, references) }
  for (const property of expression.properties) if (ts.isMethodDeclaration(property)) references(property)
  for (const statement of top) if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) if (!literal(declaration.initializer!)) references(declaration.initializer!)
  const queue = [...required]
  for (let index = 0; index < queue.length; index++) { const before = required.size; references(constants.get(queue[index])!); if (required.size !== before) for (const name of required) if (!queue.includes(name)) queue.push(name) }
  // Static-only literal declarations are validated by expansion, not evaluated as frame values.
  // In particular, WGSL text has its own shader byte budget rather than a CPU text-value budget.
  const runtimeTop = top.flatMap(statement => {
    const declarations = (statement as ts.VariableStatement).declarationList.declarations.filter(declaration => required.has((declaration.name as ts.Identifier).text) || !literal(declaration.initializer!))
    return declarations.length ? [ts.factory.updateVariableStatement(statement as ts.VariableStatement, undefined, ts.factory.updateVariableDeclarationList((statement as ts.VariableStatement).declarationList, declarations))] : []
  })
  return { file: ts.factory.updateSourceFile(entry.file, [...runtimeTop, root]), astNodes, astDepth }
}
