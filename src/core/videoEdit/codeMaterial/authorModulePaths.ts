import type { CodeMaterialFiles } from './sources'

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
