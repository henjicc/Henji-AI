import ts from 'typescript'
import { codeFilePathSchema, normalizeCodeMaterialFiles, type CodeMaterialFiles } from './sources'
import { resolveCodeImportPath } from './modules'
import { CodeMaterialError } from './contract'

/** Rename/move preserves relative imports in both the moved file and its consumers. */
export function renameCodeMaterialFile(input: CodeMaterialFiles, previous: string, next: string): CodeMaterialFiles {
  const contents = normalizeCodeMaterialFiles(input); codeFilePathSchema.parse(next)
  if (!Object.prototype.hasOwnProperty.call(contents.files, previous)) throw new CodeMaterialError('SYNTAX', '要重命名的文件不存在。')
  if (previous === next) return contents
  if (Object.prototype.hasOwnProperty.call(contents.files, next)) throw new CodeMaterialError('SYNTAX', '此文件已存在，请使用其他名称。')
  const files: Record<string, string> = {}
  for (const [path, source] of Object.entries(contents.files)) {
    const renamed = path === previous ? next : path
    const parsed = ts.createSourceFile(path, source, ts.ScriptTarget.ES2020, true, ts.ScriptKind.TS)
    const edits: { start: number; end: number; text: string }[] = []
    for (const statement of parsed.statements) if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const request = statement.moduleSpecifier.text
      if (request.startsWith('@组件/')) continue
      const target = resolveCodeImportPath(path, request, statement.moduleSpecifier)
      if (target !== previous && path !== previous) continue
      const destination = (target === previous ? next : target).split('/'); const from = renamed.split('/').slice(0, -1)
      while (from.length && destination.length && from[0] === destination[0]) { from.shift(); destination.shift() }
      let relative = [...from.map(() => '..'), ...destination].join('/')
      if (!relative.startsWith('../')) relative = `./${relative}`
      if (!request.endsWith('.ts')) relative = relative.slice(0, -3)
      edits.push({ start: statement.moduleSpecifier.getStart(parsed) + 1, end: statement.moduleSpecifier.end - 1, text: relative })
    }
    let result = source
    for (const edit of edits.sort((a, b) => b.start - a.start)) result = result.slice(0, edit.start) + edit.text + result.slice(edit.end)
    files[renamed] = result
  }
  return { entry: contents.entry === previous ? next : contents.entry, files }
}
