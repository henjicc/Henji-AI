import ts from 'typescript'
import { resolveAuthorProjectImport } from './authorModulePaths'
import { codeFilePathSchema } from './sources'

/** The same TypeScript parser used by file moves; comments and strings are not imports. */
export async function resolveCodeProjectClosure(entry: string, paths: readonly string[], read: (path: string) => Promise<string>): Promise<string[]> {
  codeFilePathSchema.parse(entry)
  const files = Object.fromEntries(paths.filter(file => codeFilePathSchema.safeParse(file).success).map(file => [file, '']))
  if (!Object.hasOwn(files, entry)) throw new Error(`project_entry ${entry} 在指定提交中不存在。`)
  const visited = new Set<string>()
  const visit = async (file: string): Promise<void> => {
    if (visited.has(file)) return
    visited.add(file)
    if (!/\.[cm]?[jt]sx?$/.test(file)) return
    const source = await read(file)
    const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
    const requests = new Set<string>()
    const scan = (node: ts.Node): void => {
      const specifier = ts.isImportDeclaration(node) || ts.isExportDeclaration(node) ? node.moduleSpecifier
        : ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword ? node.arguments[0] : undefined
      if (specifier && ts.isStringLiteralLike(specifier) && specifier.text.startsWith('.')) requests.add(specifier.text)
      ts.forEachChild(node, scan)
    }
    scan(parsed)
    for (const request of requests) {
      const resolved = resolveAuthorProjectImport({ entry, files }, file, request)
      if (!resolved) throw new Error(`${file} 导入 ${request} 失败：文件不存在、说明文件不可打包或路径越出工程。`)
      await visit(resolved)
    }
  }
  await visit(entry); return [...visited].sort()
}
