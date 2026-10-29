import { parseAuthorModuleImports, resolveAuthorProjectImport } from './authorModulePaths'
import { resolveAuthorLibraryModule, type AuthorLibraryVersions } from './authorLibraries'
import type { CodeMaterialFiles } from './sources'

/** 只固定源码能确定的导入；运行时变量说明符仍按历史缺省规则解析。 */
export function importedAuthorLibraries(files: CodeMaterialFiles): AuthorLibraryVersions {
  const used: Record<string, string> = {}
  const pending = [files.entry], seen = new Set<string>()
  while (pending.length) {
    const path = pending.pop()!
    if (seen.has(path)) continue
    seen.add(path)
    if (!/\.[cm]?[jt]sx?$/.test(path)) continue
    const requests = parseAuthorModuleImports(files.files[path], path)
    for (const request of requests) {
      if (!request.specifier) continue
      const target = resolveAuthorProjectImport(files, path, request.specifier)
      if (target) { pending.push(target); continue }
      const library = resolveAuthorLibraryModule(request.specifier, files.libraries)
      if (library) used[library.library] = library.version
    }
  }
  return used
}
