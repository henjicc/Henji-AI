import ts from 'typescript'
import { VIDEO_EDIT_BUILTIN_EFFECTS_DEFINITIONS, videoEditBuiltinParamValue, videoEditBuiltinParamSpaceIssue } from '@/core/videoEdit/builtinEffects'
import { retiredBlurParams } from '@/core/videoEdit/blur'

export interface AuthorEffectDiagnostic { start: number; length: number; message: string }
/** 常量只读 AST 与 const 绑定，动态表达式留给逐帧校验。 */
/** henji-effects 1.0.0 的 blur() 按 mode 产出并进“模糊”前的 ID，参数也是旧的。 */
const BLUR_1_0_IDS: Readonly<Record<string, string>> = { gaussian: 'gaussian_blur', directional: 'directional_blur', radial: 'zoom_blur', lens: 'lens_blur' }
/** `effectsVersion` 是这份源码锁定的 henji-effects 版本，旧版本的工厂按它当时的参数检查。 */
export function authorEffectDiagnostics(source: ts.SourceFile, checker: ts.TypeChecker, effectsVersion?: string): AuthorEffectDiagnostic[] {
  const result: AuthorEffectDiagnostic[] = [], factories = new Map<ts.Symbol, string>(), namespaces = new Set<ts.Symbol>()
  const definitions = VIDEO_EDIT_BUILTIN_EFFECTS_DEFINITIONS.filter(definition => (definition.space === 'layer' || definition.space === 'frame') && definition.author)
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
  // 写在调整层 adjust 里的描述按整帧空间校验，其余（图层 effects、单独的常量）按图层。
  const spaceOf = (node: ts.Node): 'layer' | 'frame' => {
    for (let parent = node.parent; parent && !ts.isSourceFile(parent); parent = parent.parent) {
      if (!ts.isPropertyAssignment(parent) && !ts.isMethodDeclaration(parent)) continue
      const name = parent.name.getText(source)
      if (name === 'adjust' || name === 'effects') return name === 'adjust' ? 'frame' : 'layer'
    }
    return 'layer'
  }
  const validate = (node: ts.Node, requested: unknown, raw: unknown): void => {
    // 旧模糊 ID 与运行时一样先换成“模糊”的参数再检查。
    const retired = typeof requested === 'string' && raw && typeof raw === 'object' ? retiredBlurParams(requested, raw as Record<string, unknown>) : undefined
    const id = retired ? 'blur' : requested, params = retired ?? raw
    const definition = definitions.find(value => value.id === id)
    if (!definition || !params || typeof params !== 'object') return
    for (const [key, value] of Object.entries(params)) {
      const param = definition.params.find(param => param.key === key)
      if (!param) continue // 字段和枚举由公共声明检查。
      try {
        const issue = videoEditBuiltinParamSpaceIssue(param, spaceOf(node))
        if (issue) throw new Error(issue)
        if (value !== undefined) videoEditBuiltinParamValue(param, value)
      }
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
        if (factory === 'blur' && effectsVersion === '1.0.0' && params && typeof params === 'object') {
          const { mode = 'gaussian', ...rest } = params as Record<string, unknown>
          validate(node.arguments[0], BLUR_1_0_IDS[String(mode)], rest)
        } else validate(node.arguments[0], definitions.find(value => value.author?.factory === factory)?.id, params)
      }
    }
    if (ts.isObjectLiteralExpression(node)) {
      let parent: ts.Node | undefined = node.parent, inEffects = /EffectDescriptor/.test(checker.typeToString(checker.getContextualType(node) ?? checker.getTypeAtLocation(node)))
      while (parent && !ts.isSourceFile(parent)) { if (ts.isPropertyAssignment(parent) && ['effects', 'adjust'].includes(parent.name.getText(source))) inEffects = true; parent = parent.parent }
      if (inEffects) { const value = constant(node) as Record<string, unknown>; validate(node, value.id, value.params) }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return result
}
