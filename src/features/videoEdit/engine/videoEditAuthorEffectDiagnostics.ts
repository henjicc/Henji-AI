import ts from 'typescript'
import { VIDEO_EDIT_BUILTIN_EFFECTS_DEFINITIONS, videoEditBuiltinParamValue } from '@/core/videoEdit/builtinEffects'

export interface AuthorEffectDiagnostic { start: number; length: number; message: string }
/** 常量只读 AST 与 const 绑定，动态表达式留给逐帧校验。 */
export function authorEffectDiagnostics(source: ts.SourceFile, checker: ts.TypeChecker): AuthorEffectDiagnostic[] {
  const result: AuthorEffectDiagnostic[] = [], factories = new Map<ts.Symbol, string>(), namespaces = new Set<ts.Symbol>()
  const definitions = VIDEO_EDIT_BUILTIN_EFFECTS_DEFINITIONS.filter(definition => (definition.space === 'layer' || definition.space === 'layer-only') && definition.author)
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || statement.moduleSpecifier.text !== 'henji-effects') continue
    const binding = statement.importClause?.namedBindings
    if (binding && ts.isNamedImports(binding)) for (const item of binding.elements) {
      const symbol = checker.getSymbolAtLocation(item.name)
      if (symbol) factories.set(symbol, (item.propertyName ?? item.name).text)
    }
    if (binding && ts.isNamespaceImport(binding)) {
      const symbol = checker.getSymbolAtLocation(binding.name)
      if (symbol) namespaces.add(symbol)
    }
  }
  const constant = (node: ts.Expression, seen = new Set<ts.Node>()): unknown => {
    if (seen.has(node)) return undefined
    seen.add(node)
    if (ts.isNumericLiteral(node)) return Number(node.text)
    if (ts.isStringLiteralLike(node)) return node.text
    if (node.kind === ts.SyntaxKind.TrueKeyword) return true
    if (node.kind === ts.SyntaxKind.FalseKeyword) return false
    if (node.kind === ts.SyntaxKind.NullKeyword) return null
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) return constant(node.expression, seen)
    if (ts.isPrefixUnaryExpression(node)) { const value = constant(node.operand, seen); return typeof value === 'number' ? node.operator === ts.SyntaxKind.MinusToken ? -value : node.operator === ts.SyntaxKind.PlusToken ? value : undefined : undefined }
    if (ts.isBinaryExpression(node)) {
      const left = constant(node.left, new Set(seen)), right = constant(node.right, new Set(seen))
      if (typeof left === 'number' && typeof right === 'number') {
        switch (node.operatorToken.kind) {
          case ts.SyntaxKind.PlusToken: return left + right
          case ts.SyntaxKind.MinusToken: return left - right
          case ts.SyntaxKind.AsteriskToken: return left * right
          case ts.SyntaxKind.SlashToken: return left / right
          case ts.SyntaxKind.AsteriskAsteriskToken: return left ** right
        }
      }
    }
    if (ts.isIdentifier(node)) {
      if (node.text === 'NaN') return NaN
      if (node.text === 'Infinity') return Infinity
      const declaration = (ts.isShorthandPropertyAssignment(node.parent) ? checker.getShorthandAssignmentValueSymbol(node.parent) : checker.getSymbolAtLocation(node))?.valueDeclaration
      if (declaration && ts.isVariableDeclaration(declaration) && declaration.initializer && ts.isVariableDeclarationList(declaration.parent) && declaration.parent.flags & ts.NodeFlags.Const) return constant(declaration.initializer, seen)
    }
    if (ts.isObjectLiteralExpression(node)) {
      const values: Record<string, unknown> = {}
      for (const property of node.properties) {
        if (ts.isPropertyAssignment(property)) values[property.name.getText(source).replace(/^['"]|['"]$/g, '')] = constant(property.initializer, new Set(seen))
        else if (ts.isShorthandPropertyAssignment(property)) values[property.name.text] = constant(property.name, new Set(seen))
      }
      return values
    }
    return undefined
  }
  const validate = (node: ts.Node, id: unknown, params: unknown): void => {
    const definition = definitions.find(value => value.id === id)
    if (!definition || !params || typeof params !== 'object') return
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined) continue
      const param = definition.params.find(param => param.key === key)
      if (!param) continue // 字段和枚举由公共声明检查。
      try { videoEditBuiltinParamValue(param, value) }
      catch (error) { result.push({ start: node.getStart(source), length: node.getWidth(source), message: `${definition.name}.${key}：${error instanceof Error ? error.message : String(error)}` }) }
    }
  }
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const expression = node.expression
      const symbol = ts.isIdentifier(expression) ? checker.getSymbolAtLocation(expression) : ts.isPropertyAccessExpression(expression) ? checker.getSymbolAtLocation(expression.expression) : undefined
      const factory = symbol && (ts.isIdentifier(expression) ? factories.get(symbol) : ts.isPropertyAccessExpression(expression) && namespaces.has(symbol) ? expression.name.text : undefined)
      if (factory && node.arguments[0]) {
        const params = constant(node.arguments[0])
        const mode = params && typeof params === 'object' && 'mode' in params ? params.mode : 'gaussian'
        const definition = definitions.find(value => value.author?.factory === factory && (factory !== 'blur' || value.author.mode === mode))
        validate(node.arguments[0], definition?.id, params)
      }
    }
    if (ts.isObjectLiteralExpression(node)) {
      let parent: ts.Node | undefined = node.parent, inEffects = /EffectDescriptor/.test(checker.typeToString(checker.getContextualType(node) ?? checker.getTypeAtLocation(node)))
      while (parent && !ts.isSourceFile(parent)) { if (ts.isPropertyAssignment(parent) && parent.name.getText(source) === 'effects') inEffects = true; parent = parent.parent }
      if (inEffects) { const value = constant(node) as Record<string, unknown>; validate(node, value.id, value.params) }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return result
}
