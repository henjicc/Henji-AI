import type { CodeEffectSuggestion } from '../codeEffectSuggestion'
import type { CodeSourceSpan } from './contract'
import type ts from 'typescript'

/** 只解析静态默认导出；动态工厂留给运行时检查，不能把同名辅助方法当成作者入口。 */
export function authorDefaultExpression(api: typeof ts, source: ts.SourceFile): ts.Expression | undefined {
  const initializer = (name: string): ts.Expression | undefined => {
    for (const statement of source.statements) if (api.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) if (api.isIdentifier(declaration.name) && declaration.name.text === name && declaration.initializer) return declaration.initializer
    return undefined
  }
  for (const statement of source.statements) {
    if (api.isExportAssignment(statement) && !statement.isExportEquals) return api.isIdentifier(statement.expression) ? initializer(statement.expression.text) ?? statement.expression : statement.expression
    if (api.isExportDeclaration(statement) && !statement.moduleSpecifier && statement.exportClause && api.isNamedExports(statement.exportClause)) {
      const named = statement.exportClause.elements.find(element => element.name.text === 'default')
      if (named) return initializer((named.propertyName ?? named.name).text)
    }
  }
  return undefined
}

/** 由已有 TS 解析器调用；不把编译器装进 core 的常驻依赖。 */
export function authorThreeDiagnostics(api: typeof ts, files: Readonly<Record<string, string>>, entry: string): CodeTypeDiagnostic[] {
  const parsed = Object.entries(files).filter(([file]) => /\.[cm]?[jt]sx?$/.test(file)).map(([file, text]) => api.createSourceFile(file, text, api.ScriptTarget.Latest, true))
  const visit = (node: ts.Node, action: (node: ts.Node) => void): void => { action(node); api.forEachChild(node, child => visit(child, action)) }
  const main = parsed.find(source => source.fileName === entry)
  const target = main && authorDefaultExpression(api, main)
  const managed = target && api.isObjectLiteralExpression(target) && target.properties.some(node => node.name &&
    (api.isIdentifier(node.name) || api.isStringLiteral(node.name)) && node.name.text === 'createThree')
  if (!managed) return []
  const result: CodeTypeDiagnostic[] = []
  for (const source of parsed) {
    const constructors = new Set<string>(), namespaces = new Set<string>()
    for (const statement of source.statements) {
      if (!api.isImportDeclaration(statement) || !api.isStringLiteral(statement.moduleSpecifier) ||
        !/^three(?:\/|$)/.test(statement.moduleSpecifier.text)) continue
      const bindings = statement.importClause?.namedBindings
      if (bindings && api.isNamespaceImport(bindings)) namespaces.add(bindings.name.text)
      if (bindings && api.isNamedImports(bindings)) for (const item of bindings.elements) {
        if (['ShaderMaterial', 'RawShaderMaterial'].includes((item.propertyName ?? item.name).text)) constructors.add(item.name.text)
      }
    }
    visit(source, node => {
      if (!api.isNewExpression(node)) return
      const expression = node.expression
      const unsupported = api.isIdentifier(expression) ? constructors.has(expression.text)
        : api.isPropertyAccessExpression(expression) && api.isIdentifier(expression.expression) && namespaces.has(expression.expression.text) && ['ShaderMaterial', 'RawShaderMaterial'].includes(expression.name.text)
      if (!unsupported) return
      const start = node.getStart(source), end = node.getEnd(), a = source.getLineAndCharacterOfPosition(start), b = source.getLineAndCharacterOfPosition(end)
      result.push({ code: 95002, message: 'createThree 使用 WebGPURenderer，不支持 GLSL ShaderMaterial/RawShaderMaterial；请使用节点材质或标准材质。',
        span: { file: source.fileName, start, end, startLine: a.line + 1, startColumn: a.character + 1, endLine: b.line + 1, endColumn: b.character + 1 } })
    })
  }
  return result
}

/** 作者源码类型检查的一条错误；位置是作者原文的行列，不是检查器内部改写后的位置。 */
export interface CodeTypeDiagnostic { code: number; message: string; span: CodeSourceSpan }
export interface CodeTypeCheckResult {
  /** 实际检查了的作者文件：TS 文件，以及首行写了 // @ts-check 的 JS 文件。 */
  suggestions?: CodeEffectSuggestion[]
  checkedFiles: string[]
  diagnostics: CodeTypeDiagnostic[]
  /** 全部错误数；diagnostics 只保留前若干条。 */
  total: number
  elapsedMs: number
}
/** unavailable：检查线程出错或超时，本次没有类型结论，不代表源码没有问题。 */
export type CodeTypeCheckReport = ({ status: 'checked' } & CodeTypeCheckResult) | { status: 'unavailable'; reason: string }

export function codeTypeDiagnosticLine(diagnostic: CodeTypeDiagnostic): string {
  return `${diagnostic.span.file}:${diagnostic.span.startLine}:${diagnostic.span.startColumn} TS${diagnostic.code} ${diagnostic.message}`
}

/** 附在创建结果证据里的一句话；没有检查任何 TS 文件时不出证据。 */
export function codeTypeCheckFact(report: CodeTypeCheckReport): string | undefined {
  if (report.status === 'unavailable') return `类型检查未完成（${report.reason}），本次没有类型结论。`
  if (!report.checkedFiles.length) return undefined
  if (!report.total) return `类型检查通过：${report.checkedFiles.join('、')}。`
  const lines = report.diagnostics.slice(0, 6).map(diagnostic => `- ${codeTypeDiagnosticLine(diagnostic)}`.slice(0, 220))
  const rest = report.total - lines.length
  return [`类型检查发现 ${report.total} 处问题（不阻止创建，画面照常试渲染；按位置修正后提交新源码版本）：`, ...lines, ...(rest > 0 ? [`其余 ${rest} 处见 data。`] : [])].join('\n').slice(0, 1000)
}

/** 证据 data：结构化的位置与错误码，供助手逐条定位。 */
export type CodeTypeCheckData =
  | { status: 'unavailable'; reason: string }
  | { status: 'checked'; suggestions?: CodeEffectSuggestion[]; checkedFiles: string[]; total: number; diagnostics: Array<{ file: string; line: number; column: number; endLine: number; endColumn: number; code: number; message: string }> }
export function codeTypeCheckData(report: CodeTypeCheckReport): CodeTypeCheckData {
  if (report.status === 'unavailable') return { status: report.status, reason: report.reason }
  return { status: report.status, ...(report.suggestions?.length ? { suggestions: report.suggestions } : {}), checkedFiles: [...report.checkedFiles], total: report.total, diagnostics: report.diagnostics.slice(0, 20).map(diagnostic => ({ file: diagnostic.span.file, line: diagnostic.span.startLine, column: diagnostic.span.startColumn, endLine: diagnostic.span.endLine, endColumn: diagnostic.span.endColumn, code: diagnostic.code, message: diagnostic.message })) }
}

/** 加载或试渲染失败时附在错误信息末尾：类型错误常常就是失败原因，助手不必再猜。一次提交多份源码时标出第几份。 */
export function codeTypeCheckAppendix(reports: ReadonlyArray<CodeTypeCheckReport | undefined>, limit = 5): string {
  const found = reports.flatMap((report, index) => report?.status === 'checked' ? report.diagnostics.map(diagnostic => ({ index, diagnostic })) : [])
  const total = reports.reduce((sum, report) => sum + (report?.status === 'checked' ? report.total : 0), 0)
  if (!total) return ''
  const lines = found.slice(0, limit).map(({ index, diagnostic }) => `- ${reports.length > 1 ? `第 ${index + 1} 份源码 ` : ''}${codeTypeDiagnosticLine(diagnostic)}`.slice(0, 300))
  const rest = total - lines.length
  return `\n类型检查同时发现 ${total} 处问题，可能就是原因：\n${lines.join('\n')}${rest > 0 ? `\n（另有 ${rest} 处未列出）` : ''}`
}
