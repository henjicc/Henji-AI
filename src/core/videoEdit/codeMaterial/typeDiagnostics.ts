import type { CodeSourceSpan } from './contract'

/** 作者源码类型检查的一条错误；位置是作者原文的行列，不是检查器内部改写后的位置。 */
export interface CodeTypeDiagnostic { code: number; message: string; span: CodeSourceSpan }
export interface CodeTypeCheckResult {
  /** 实际检查了的作者文件：TS 文件，以及首行写了 // @ts-check 的 JS 文件。 */
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
  | { status: 'checked'; checkedFiles: string[]; total: number; diagnostics: Array<{ file: string; line: number; column: number; endLine: number; endColumn: number; code: number; message: string }> }
export function codeTypeCheckData(report: CodeTypeCheckReport): CodeTypeCheckData {
  if (report.status === 'unavailable') return { status: report.status, reason: report.reason }
  return { status: report.status, checkedFiles: [...report.checkedFiles], total: report.total, diagnostics: report.diagnostics.slice(0, 20).map(diagnostic => ({ file: diagnostic.span.file, line: diagnostic.span.startLine, column: diagnostic.span.startColumn, endLine: diagnostic.span.endLine, endColumn: diagnostic.span.endColumn, code: diagnostic.code, message: diagnostic.message })) }
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
