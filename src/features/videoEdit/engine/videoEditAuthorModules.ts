import { parse } from 'es-module-lexer/js'
import type { CodeAuthorBundle } from '@/core/videoEdit/codeAuthorProgram'
import type { CodeMaterialFiles } from '@/core/videoEdit/codeMaterial/sources'
import { resolveAuthorProjectImport } from '@/core/videoEdit/codeMaterial/authorModulePaths'
import { AUTHOR_LIBRARIES, authorLibraryImportTable, describeAuthorLibraries, resolveAuthorLibraryModule, type AuthorLibraryVersions, type ResolvedAuthorLibraryModule } from '@/core/videoEdit/codeMaterial/authorLibraries'
import { CODE_AUTHOR_LIBRARIES_MIN_API_VERSION } from '@/core/videoEdit/codeMaterialPersistence'

const BARE_SPECIFIER = /^(?![./]|[a-z][a-z0-9+.-]*:)/i

/**
 * 说明符先按项目文件解析，找不到才查内置库：已经把同名库放进源码的旧工程照旧使用自己的副本。
 * 两者都没有时，裸名的错误列出可用的内置库。
 */
export function missingAuthorModuleMessage(specifier: string, importer: string | undefined, versions?: AuthorLibraryVersions): string {
  const from = importer ? `（由 ${importer} 导入）` : ''
  return BARE_SPECIFIER.test(specifier)
    ? `找不到模块 ${specifier}${from}。可用的内置库：${describeAuthorLibraries(versions)}；其他第三方库请打包后加入项目源码。`
    : `找不到模块 ${specifier}${from}，请恢复源码文件。`
}

/** 内置库从作者接口 v5 起可用；更早的版本遇到内置库名明确拒绝，不静默放行一个记录不了版本的导入。 */
const librariesAvailable = (apiVersion?: number): boolean => (apiVersion ?? 4) >= CODE_AUTHOR_LIBRARIES_MIN_API_VERSION
function unavailableAuthorLibraryMessage(specifier: string, importer: string | undefined, apiVersion?: number): string {
  return `${importer ?? '源码'} 导入了内置库 ${specifier}：内置库从作者接口 v${CODE_AUTHOR_LIBRARIES_MIN_API_VERSION} 起可用，这一版按作者接口 v${apiVersion ?? 4} 编译。请把源码另存为新版本后再使用内置库。`
}
/** 项目里找不到的说明符按内置库解析；解析不到或作者接口不支持时给出原因。 */
export function resolveAuthorBuiltInImport(specifier: string, importer: string | undefined, files: Pick<CodeMaterialFiles, 'apiVersion' | 'libraries'>): { library: ResolvedAuthorLibraryModule } | { error: string } {
  const library = resolveAuthorLibraryModule(specifier, files.libraries)
  if (!library) return { error: missingAuthorModuleMessage(specifier, importer, files.libraries) }
  return librariesAvailable(files.apiVersion) ? { library } : { error: unavailableAuthorLibraryMessage(specifier, importer, files.apiVersion) }
}

/** 项目根目录里与内置库同名的文件导入这个库名，解析到的是它自己；直接报出遮挡，不让它静默成自引用。 */
export function shadowedAuthorLibraryMessage(specifier: string, importer: string, target: string | undefined, versions?: AuthorLibraryVersions): string | undefined {
  if (target !== importer || !BARE_SPECIFIER.test(specifier) || !resolveAuthorLibraryModule(specifier, versions)) return undefined
  return `${importer} 导入 ${specifier} 时解析到了它自己：项目里的同名文件遮住了内置库 ${specifier}。要用内置库，请给 ${importer} 改名；要用项目里的副本，请在其他文件里用相对路径导入它。`
}

/**
 * 运行时才确定的 import(说明符) 的内置库查找：按代码版本记录的库版本给出地址；未登记的裸名导入一个只抛错的模块，
 * import() 照常以拒绝的 Promise 报错并列出可用的内置库；其他说明符原样交给浏览器。
 */
export function authorLibraryRuntimeResolver(importer: string, files: Pick<CodeMaterialFiles, 'apiVersion' | 'libraries'>): string {
  const available = librariesAvailable(files.apiVersion)
  const table = available ? authorLibraryImportTable(files.libraries) : { modules: {}, directories: [] }
  const message = (text: string): string[] => text.split('\u0000')
  const [before, after] = message(missingAuthorModuleMessage('\u0000', importer, files.libraries))
  // 作者接口不支持内置库时，内置库名给出版本原因，其余裸名照常报找不到。
  const [lockedBefore, lockedAfter] = message(unavailableAuthorLibraryMessage('\u0000', importer, files.apiVersion))
  const locked = available ? [] : Object.keys(AUTHOR_LIBRARIES)
  const fail = (head: string, tail: string): string => `return 'data:text/javascript,'+encodeURIComponent('throw new Error('+JSON.stringify(${JSON.stringify(head)}+s+${JSON.stringify(tail)})+')');`
  return `(s)=>{const l=${JSON.stringify(table.modules)};if(Object.hasOwn(l,s))return l[s];for(const [p,b] of ${JSON.stringify(table.directories)}){const r=s.slice(p.length);if(s.startsWith(p)&&r&&!r.split('/').some(x=>x===''||x==='.'||x==='..'))return b+r;}if(${JSON.stringify(locked)}.some(n=>s===n||s.startsWith(n+'/'))){${fail(lockedBefore, lockedAfter)}}if(${BARE_SPECIFIER}.test(s)){${fail(before, after)}}return s;}`
}

/** esbuild 产物里运行时才确定的 import(...) 套上同一个内置库查找，两条编译路径行为一致。 */
export function rewriteRuntimeAuthorImports(code: string, importer: string, files: Pick<CodeMaterialFiles, 'apiVersion' | 'libraries'>): string {
  const [imports] = parse(code)
  let output = code
  for (const request of [...imports].reverse()) {
    if (request.type !== 'dynamic' || request.specifier && !request.glob) continue
    output = output.slice(0, request.start) + `(${authorLibraryRuntimeResolver(importer, files)})(${output.slice(request.start, request.end)})` + output.slice(request.end)
  }
  return output
}

export interface AuthorModuleUrls { url: string; dispose(): void }
class CircularAuthorModules extends Error {}
let nativeModules: ((files: CodeMaterialFiles) => Promise<AuthorModuleUrls>) | undefined
export function installAuthorNativeModules(prepare: (files: CodeMaterialFiles) => Promise<AuthorModuleUrls>): void { nativeModules = prepare }

/** Blob 无法预分配地址；循环图由宿主用稳定 URL 提供，仍交给原生 ESM 链接。 */
export async function prepareAuthorModuleUrls(bundle: CodeAuthorBundle): Promise<AuthorModuleUrls> {
  try { return createAuthorModuleUrls(bundle) }
  catch (error) {
    if (!(error instanceof CircularAuthorModules) || !bundle.modules || !nativeModules) throw error
    return nativeModules(bundle.modules)
  }
}

/** 只改写模块说明符；模块语义、求值顺序和绑定都交给浏览器。 */
export function rewriteAuthorModule(files: CodeMaterialFiles, path: string, urlFor: (path: string) => string): string {
  let code = files.files[path]
  if (/\.(?:wgsl|glsl)$/.test(path)) return `export default ${JSON.stringify(code)};`
  if (/\.json$/.test(path)) return `export default ${JSON.stringify(JSON.parse(code) as unknown)};`
  const [imports] = parse(code)
  for (const request of [...imports].reverse()) {
    if (request.type === 'dynamic' && (!request.specifier || request.glob)) {
      // 可变说明符由原生 import 求值；地址表按同一项目解析规则查找，支持动态循环。
      const root = 'file:///author-project/'
      const urls = Object.fromEntries(Object.keys(files.files).map(file => [new URL(file, root).href, urlFor(file)]))
      const mapped = Object.fromEntries(Object.entries(files.resolvedImports?.[path] ?? {}).map(([key, file]) => [key, urlFor(file)]))
      const original = code.slice(request.start, request.end)
      // 项目文件找不到时交给与 esbuild 路径相同的内置库查找。
      const replacement = `((s)=>{const m=${JSON.stringify(mapped)};if(Object.hasOwn(m,s))return m[s];const u=${JSON.stringify(urls)};const t=new URL(s,s.startsWith('.')?${JSON.stringify(new URL(path, root).href)}:${JSON.stringify(root)}).href;for(const x of ['','.js','.mjs','.ts','.tsx','.json','/index.js','/index.ts'])if(Object.hasOwn(u,t+x))return u[t+x];return (${authorLibraryRuntimeResolver(path, files)})(s);})(${original})`
      code = code.slice(0, request.start) + replacement + code.slice(request.end)
      continue
    }
    if (!request.specifier) continue
    if (/^(?:https?:|data:|blob:)/.test(request.specifier)) continue
    const target = resolveAuthorProjectImport(files, path, request.specifier)
    const shadowed = shadowedAuthorLibraryMessage(request.specifier, path, target, files.libraries)
    if (shadowed) throw new Error(shadowed)
    if (!target) {
      const resolved = resolveAuthorBuiltInImport(request.specifier, path, files)
      if ('error' in resolved) throw new Error(resolved.error)
      const { library } = resolved
      code = code.slice(0, request.start) + (request.type === 'dynamic' ? JSON.stringify(library.url) : library.url) + code.slice(request.end)
      continue
    }
    const url = urlFor(target)
    // JSON 已转为普通 ESM，移除原 JSON 加载属性，保留其默认导出。
    if (/\.json$/.test(target) && request.attributesStart >= 0) {
      const start = request.type === 'dynamic' ? request.end : request.end + 1
      const end = request.type === 'dynamic' ? request.importEnd - 1 : request.importEnd
      code = code.slice(0, start) + code.slice(end)
    }
    const replacement = request.type === 'dynamic' ? JSON.stringify(url) : url
    code = code.slice(0, request.start) + replacement + code.slice(request.end)
  }
  return code
}

/** JS 原文直接交给浏览器；只有 TypeScript 兼容输入才进入转译线程。 */
export function directAuthorBundle(files: CodeMaterialFiles): CodeAuthorBundle | undefined {
  if (Object.keys(files.files).some(path => /\.[cm]?tsx?$/.test(path))) return undefined
  const libraries = usedAuthorLibraries(files)
  return { code: files.files[files.entry], map: '', locations: { layers: {} }, modules: files, ...(libraries ? { libraries } : {}), ...(files.apiVersion !== undefined ? { apiVersion: files.apiVersion } : {}) }
}

/** 只统计字面说明符；运行时才确定的动态 import 无法提前得知所用库。 */
function usedAuthorLibraries(files: CodeMaterialFiles): Record<string, string> | undefined {
  if (!librariesAvailable(files.apiVersion)) return undefined
  const used: Record<string, string> = {}
  for (const [path, code] of Object.entries(files.files)) {
    if (!/\.[cm]?jsx?$/.test(path)) continue
    let imports: ReturnType<typeof parse>[0]
    try { [imports] = parse(code) } catch { continue }
    for (const request of imports) {
      if (!request.specifier || !BARE_SPECIFIER.test(request.specifier) || resolveAuthorProjectImport(files, path, request.specifier)) continue
      const library = resolveAuthorLibraryModule(request.specifier, files.libraries)
      if (library) used[library.library] = library.version
    }
  }
  return Object.keys(used).length ? used : undefined
}

/** URL 属于执行会话，不能放进可持久缓存或从编译 Worker 借用。 */
export function createAuthorModuleUrls(bundle: CodeAuthorBundle): AuthorModuleUrls {
  const urls = new Map<string, string>()
  const visiting = new Set<string>()
  const dispose = (): void => { for (const url of urls.values()) URL.revokeObjectURL(url); urls.clear() }
  const make = (path: string): string => {
    const known = urls.get(path)
    if (known) return known
    if (visiting.has(path)) throw new CircularAuthorModules(`循环模块 ${path} 需要宿主提供稳定模块地址。`)
    visiting.add(path)
    const code = rewriteAuthorModule(bundle.modules!, path, make)
    const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }))
    urls.set(path, url); visiting.delete(path)
    return url
  }
  try {
    if (bundle.modules) return { url: make(bundle.modules.entry), dispose }
    const url = URL.createObjectURL(new Blob([bundle.code], { type: 'text/javascript' }))
    urls.set('entry', url)
    return { url, dispose }
  } catch (error) { dispose(); throw error }
}
