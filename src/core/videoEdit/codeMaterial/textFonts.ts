import ts from 'typescript'
import { z } from 'zod'
import type { TextFontDeclaration } from '../../imaging/vectorContent/shaping/fontSession'
import { CODE_AUTHOR_SHAPED_TEXT_MIN_API_VERSION } from '../codeAuthorVersions'
import { readTextCoverage, type LayoutFunction } from './textCoverage'

const fontDeclaration = z.object({
  faces: z.array(z.object({ family: z.string().trim().min(1), weight: z.number().finite().positive().optional(), style: z.enum(['normal', 'italic', 'oblique']).optional(), variations: z.record(z.string().regex(/^[\x20-\x7e]{4}$/), z.number().finite()).optional() }).strict()).optional(),
  text: z.array(z.string()).optional(), scripts: z.array(z.string().regex(/^(?:[A-Z][a-z]{3}|Emoji)$/)).optional(),
  bindings: z.array(z.object({ text: z.string().min(1), style: z.string().min(1) }).strict()).optional(),
}).strict()
export interface TextFontDiagnostic { start: number; end: number; message: string; severity: 'warning' | 'error' }
export interface StaticTextFonts {
  usesText?: boolean
  declaration: TextFontDeclaration
  defaults?: Readonly<Record<string, unknown>>
  parameters?: readonly { key: string; type: 'font' | 'textStyle' }[]
  styleUses?: readonly { parameter?: string; style: Readonly<Record<string, unknown>> }[]
  textParameters?: readonly string[]
  dynamicText?: boolean
  diagnostics: readonly TextFontDiagnostic[]
}

/** 只解释资源元数据的字面量与模块常量，不执行模块，也不限制作者函数的表达能力。 */
export function readStaticTextFonts(source: ts.SourceFile, apiVersion: number): StaticTextFonts {
  if (apiVersion < CODE_AUTHOR_SHAPED_TEXT_MIN_API_VERSION) return { declaration: {}, diagnostics: [] }
  const constants = new Map<string, ts.Expression>(), calls = new Map<string, LayoutFunction>(), namespaces = new Set<string>()
  const styleUses: NonNullable<StaticTextFonts['styleUses']>[number][] = []
  const diagnostics: TextFontDiagnostic[] = []
  let usesText = false, reexportsText = false
  let declarationNode: ts.Node | undefined, exportedName: string | undefined
  for (const statement of source.statements) {
    if (ts.isVariableStatement(statement) && statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
      const declaration = statement.declarationList.declarations.find(value => ts.isIdentifier(value.name) && value.name.text === 'textFonts')
      if (declaration) { exportedName = 'textFonts'; declarationNode = declaration }
    }
    if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name?.text === 'textFonts' && statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) { exportedName = 'textFonts'; declarationNode = statement }
    if (ts.isVariableStatement(statement) && (statement.declarationList.flags & ts.NodeFlags.Const)) {
      for (const declaration of statement.declarationList.declarations) if (ts.isIdentifier(declaration.name) && declaration.initializer) {
        constants.set(declaration.name.text, declaration.initializer)
        if (declaration.name.text === 'textFonts' && statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) { exportedName = 'textFonts'; declarationNode = declaration }
      }
    }
    if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      for (const item of statement.exportClause.elements) if (item.name.text === 'textFonts') { exportedName = statement.moduleSpecifier ? '' : (item.propertyName ?? item.name).text; declarationNode = item }
    }
    // 转导出后由其他模块调用，那里的分析认不出排版函数。
    if (ts.isExportDeclaration(statement) && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier) && /^henji-layout\/(text|table|flex)$/.test(statement.moduleSpecifier.text)) reexportsText = true
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier) && /^henji-layout\/(text|table|flex)$/.test(statement.moduleSpecifier.text)) {
      usesText = true
      const bindings = statement.importClause?.namedBindings
      if (bindings && ts.isNamedImports(bindings)) for (const item of bindings.elements) {
        const name = (item.propertyName ?? item.name).text
        if (name === 'layoutText' || name === 'layoutTable' || name === 'layoutBoxes') calls.set(item.name.text, name)
      }
      if (bindings && ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text)
    }
  }
  const read = (node: ts.Expression, active = new Set<string>()): unknown => {
    if (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node)) return read(node.expression, active)
    if (ts.isStringLiteralLike(node)) return node.text
    if (ts.isNumericLiteral(node)) return Number(node.text)
    if (node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword) return node.kind === ts.SyntaxKind.TrueKeyword
    if (ts.isPrefixUnaryExpression(node) && [ts.SyntaxKind.MinusToken, ts.SyntaxKind.PlusToken].includes(node.operator)) {
      const value = read(node.operand, active)
      if (typeof value === 'number') return node.operator === ts.SyntaxKind.MinusToken ? -value : value
    }
    if (ts.isIdentifier(node) && constants.has(node.text) && !active.has(node.text)) return read(constants.get(node.text)!, new Set([...active, node.text]))
    if (ts.isArrayLiteralExpression(node)) return node.elements.map(element => read(element, active))
    if (ts.isObjectLiteralExpression(node)) {
      const value: Record<string, unknown> = Object.create(null)
      for (const property of node.properties) {
        if (ts.isShorthandPropertyAssignment(property)) value[property.name.text] = read(property.name, active)
        else if (ts.isPropertyAssignment(property) && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))) value[property.name.text] = read(property.initializer, active)
        else if (ts.isSpreadAssignment(property)) Object.assign(value, read(property.expression, active))
        else throw new Error('textFonts 只支持字面量与同模块常量引用')
      }
      return value
    }
    throw new Error('textFonts 不能依赖函数执行或动态表达式，请改用 faces/scripts/bindings 声明')
  }
  const add = (node: ts.Node, message: string, severity: TextFontDiagnostic['severity'] = 'warning'): void => { diagnostics.push({ start: node.getStart(source), end: node.getEnd(), message, severity }) }
  let declaration: TextFontDeclaration = {}
  if (declarationNode) {
    try {
      const expression = exportedName && constants.get(exportedName)
      if (!expression) throw new Error('textFonts 必须导出模块级常量')
      declaration = fontDeclaration.parse(read(expression))
    } catch (error) { add(declarationNode, error instanceof Error ? error.message : String(error), 'error') }
  }
  const resolve = (node: ts.Expression | undefined, active = new Set<string>()): ts.Expression | undefined => {
    if (!node) return undefined
    if (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node)) return resolve(node.expression, active)
    if (ts.isIdentifier(node) && constants.has(node.text) && !active.has(node.text)) return resolve(constants.get(node.text), new Set([...active, node.text]))
    return node
  }
  const property = (expression: ts.Expression | undefined, name: string): ts.Expression | undefined => {
    const node = resolve(expression)
    if (!node || !ts.isObjectLiteralExpression(node)) return undefined
    for (const item of [...node.properties].reverse()) {
      if (ts.isSpreadAssignment(item)) { const nested = property(item.expression, name); if (nested) return nested }
      if ((ts.isPropertyAssignment(item) || ts.isShorthandPropertyAssignment(item)) && (ts.isIdentifier(item.name) || ts.isStringLiteral(item.name)) && item.name.text === name) return ts.isPropertyAssignment(item) ? item.initializer : item.name
    }
    return undefined
  }
  const defaults: Record<string, unknown> = Object.create(null)
  const parameters: Array<{ key: string; type: 'font' | 'textStyle' }> = []
  {
    let expression = source.statements.find(ts.isExportAssignment)?.expression
    for (const statement of source.statements) if (ts.isExportDeclaration(statement) && !statement.moduleSpecifier && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      const item = statement.exportClause.elements.find(value => value.name.text === 'default')
      if (item) expression = constants.get((item.propertyName ?? item.name).text)
    }
    const params = resolve(property(expression, 'params'))
    const wanted = new Set((declaration.bindings ?? []).flatMap(value => [value.text, value.style]))
    if (params && ts.isArrayLiteralExpression(params)) for (const node of params.elements) {
      try {
        const keyNode = property(node, 'key'), defaultNode = property(node, 'default'), typeNode = property(node, 'type')
        const key = keyNode && read(keyNode)
        const type = typeNode && read(typeNode)
        if (typeof key !== 'string') continue
        if (type === 'font' || type === 'textStyle') { parameters.push({ key, type }); wanted.add(key) }
        if (defaultNode || wanted.has(key)) {
          if (defaultNode) defaults[key] = read(defaultNode)
          else if (type === 'textStyle') defaults[key] = {}
          else if (type === 'text') defaults[key] = ''
        }
      } catch { /* 动态默认值留给本次有效参数；只预热明确声明的资源。 */ }
    }
    for (const key of wanted) if (!Object.hasOwn(defaults, key)) add(params ?? declarationNode ?? source, `参数 ${key} 的默认值不能静态读取；首次求值仅预热 textFonts.faces/scripts，实际参数就绪后再准备绑定字体`)
  }
  const styleAt = (expression: ts.Expression, table?: ts.Expression): void => {
    const value = resolve(expression)
    if (!value || !ts.isObjectLiteralExpression(value)) return
    const style: Record<string, unknown> = {}
    let parameter: string | undefined
    const collectStyle = (object: ts.ObjectLiteralExpression, seen: Set<ts.Node>): void => {
      if (seen.has(object)) return
      seen = new Set([...seen, object])
      for (const item of object.properties) {
        if (ts.isSpreadAssignment(item)) {
          const spread = resolve(item.expression)
          if (spread && ts.isObjectLiteralExpression(spread)) collectStyle(spread, seen)
          else if (spread && ts.isPropertyAccessExpression(spread) && ts.isIdentifier(spread.expression) && spread.expression.text === 'params') {
            parameter = spread.name.text
            for (const key of Object.keys(style)) delete style[key]
          }
        } else if ((ts.isPropertyAssignment(item) || ts.isShorthandPropertyAssignment(item)) && (ts.isIdentifier(item.name) || ts.isStringLiteral(item.name)) && ['fontFamily', 'fontWeight', 'fontStyle'].includes(item.name.text)) {
          const field = ts.isPropertyAssignment(item) ? item.initializer : item.name
          try { style[item.name.text] = read(field) } catch { add(field, '动态字体组合请用 textFonts.faces/bindings 声明；运行时未准备的字形按同族最近样式匹配') }
        }
      }
    }
    const base = table && resolve(property(table, 'style'))
    if (base && ts.isObjectLiteralExpression(base)) collectStyle(base, new Set())
    collectStyle(value, new Set())
    if (Object.keys(style).length || parameter) styleUses.push({ parameter, style })
  }
  const coverage = readTextCoverage(source, { calls, namespaces, style: styleAt })
  for (const { call } of coverage.calls) {
    const force = property(call.arguments[2], 'forceGraphemes')
    if (force) add(force, `作者 API ${CODE_AUTHOR_SHAPED_TEXT_MIN_API_VERSION} 忽略 forceGraphemes；排版始终使用单一几何，开启可选连字请用 ligatures:true`)
  }
  if (coverage.text.length) declaration = { ...declaration, text: [...declaration.text ?? [], ...coverage.text] }
  const dynamicText = coverage.dynamic || reexportsText
  return { declaration, usesText: usesText || reexportsText || coverage.dynamic || !!declarationNode, ...(Object.keys(defaults).length ? { defaults } : {}), ...(parameters.length ? { parameters } : {}), ...(styleUses.length ? { styleUses } : {}), ...(coverage.parameters.length ? { textParameters: coverage.parameters } : {}), ...(dynamicText ? { dynamicText } : {}), diagnostics }
}
