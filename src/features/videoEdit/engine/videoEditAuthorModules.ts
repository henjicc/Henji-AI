import { parse } from 'es-module-lexer/js'
import type { CodeAuthorBundle } from '@/core/videoEdit/codeAuthorProgram'
import type { CodeMaterialFiles } from '@/core/videoEdit/codeMaterial/sources'
import { resolveAuthorProjectImport } from '@/core/videoEdit/codeMaterial/authorModulePaths'

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
      const replacement = `((s)=>{const m=${JSON.stringify(mapped)};if(Object.hasOwn(m,s))return m[s];const u=${JSON.stringify(urls)};const t=new URL(s,s.startsWith('.')?${JSON.stringify(new URL(path, root).href)}:${JSON.stringify(root)}).href;for(const x of ['','.js','.mjs','.ts','.tsx','.json','/index.js','/index.ts'])if(Object.hasOwn(u,t+x))return u[t+x];return s;})(${original})`
      code = code.slice(0, request.start) + replacement + code.slice(request.end)
      continue
    }
    if (!request.specifier) continue
    if (/^(?:https?:|data:|blob:)/.test(request.specifier)) continue
    const target = resolveAuthorProjectImport(files, path, request.specifier)
    if (!target) throw new Error(`找不到模块 ${request.specifier}（由 ${path} 导入），请恢复源码文件。`)
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
  return { code: files.files[files.entry], map: '', locations: { layers: {} }, modules: files }
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
