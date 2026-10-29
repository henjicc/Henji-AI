import type { CodeMaterialFiles } from './sources'
import { parse } from 'es-module-lexer/js'
import { CodeMaterialError } from './contract'

export function parseAuthorModuleImports(source: string, fileName: string): ReturnType<typeof parse>[0] {
  try { return parse(source)[0] } catch (error) {
    // 无法确定依赖时不能固定猜测的库版本，否则修正语法后仍会沿用错误画面。
    throw new CodeMaterialError('SYNTAX', `无法解析作者源码文件 ${fileName} 的导入：${error instanceof Error ? error.message : String(error)}`)
  }
}

/** One project-file resolution contract for linking and source-file moves. */
export function resolveAuthorProjectImport(input: CodeMaterialFiles, from: string, request: string): string | undefined {
  const mapped = input.resolvedImports?.[from]?.[request]
  if (mapped) return Object.hasOwn(input.files, mapped) ? mapped : undefined
  if (/^(?:https?:|data:|blob:)/.test(request)) return undefined
  const root = 'file:///author-project/'
  const target = request.startsWith('.') ? new URL(request, new URL(from, root)).href : new URL(request, root).href
  const paths = new Map(Object.keys(input.files).map(path => [new URL(path, root).href, path]))
  for (const suffix of ['', '.js', '.mjs', '.ts', '.tsx', '.json', '/index.js', '/index.ts']) {
    const path = paths.get(target + suffix)
    if (path) return path
  }
  return undefined
}
