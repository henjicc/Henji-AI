import ts from 'typescript'
import { codeFilePathSchema, normalizeCodeMaterialFiles, type CodeMaterialFiles } from './sources'
import { resolveAuthorProjectImport } from './authorModulePaths'
import { CodeMaterialError } from './contract'

/** Rename/move preserves relative imports in both the moved file and its consumers. */
export function renameCodeMaterialFile(input: CodeMaterialFiles, previous: string, next: string): CodeMaterialFiles {
  const contents = normalizeCodeMaterialFiles(input); codeFilePathSchema.parse(next)
  if (!Object.prototype.hasOwnProperty.call(contents.files, previous)) throw new CodeMaterialError('SYNTAX', '要重命名的文件不存在。')
  if (previous === next) return contents
  if (Object.prototype.hasOwnProperty.call(contents.files, next)) throw new CodeMaterialError('SYNTAX', '此文件已存在，请使用其他名称。')
  const files: Record<string, string> = {}
  const requests = new Map<string, Map<string, string>>()
  for (const [path, source] of Object.entries(contents.files)) {
    const renamed = path === previous ? next : path
    if (!/\.[cm]?[jt]sx?$/.test(path)) { files[renamed] = source; continue }
    const parsed = ts.createSourceFile(path, source, ts.ScriptTarget.ES2020, true, ts.ScriptKind.TS)
    const edits: { start: number; end: number; text: string }[] = []
    const visit = (node: ts.Node): void => {
      const specifier = ts.isImportDeclaration(node) || ts.isExportDeclaration(node) ? node.moduleSpecifier
        : ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword ? node.arguments[0] : undefined
      if (specifier && ts.isStringLiteralLike(specifier) && specifier.text.startsWith('.')) {
        const target = resolveAuthorProjectImport(contents, path, specifier.text)
        if (target && (target === previous || path === previous)) {
          const destination = (target === previous ? next : target).split('/'); const from = renamed.split('/').slice(0, -1)
          while (from.length && destination.length && from[0] === destination[0]) { from.shift(); destination.shift() }
          let relative = [...from.map(() => '..'), ...destination].join('/')
          if (!relative.startsWith('../')) relative = `./${relative}`
          if (!requests.has(path)) requests.set(path, new Map())
          requests.get(path)!.set(specifier.text, relative)
          edits.push({ start: specifier.getStart(parsed) + 1, end: specifier.end - 1, text: relative })
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(parsed)
    let result = source
    for (const edit of edits.sort((a, b) => b.start - a.start)) result = result.slice(0, edit.start) + edit.text + result.slice(edit.end)
    files[renamed] = result
  }
  const resolvedImports = contents.resolvedImports && Object.fromEntries(Object.entries(contents.resolvedImports).map(([file, imports]) => [
    file === previous ? next : file,
    Object.fromEntries(Object.entries(imports).map(([request, target]) => [requests.get(file)?.get(request) ?? request, target === previous ? next : target])),
  ]))
  return { entry: contents.entry === previous ? next : contents.entry, files, ...(resolvedImports ? { resolvedImports } : {}) }
}
