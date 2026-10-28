import ts from 'typescript'
import { resolveAuthorProjectImport } from '@/core/videoEdit/codeMaterial/authorModulePaths'
import { AUTHOR_LIBRARIES, resolveAuthorLibraryModule } from '@/core/videoEdit/codeMaterial/authorLibraries'
import type { CodeMaterialFiles } from '@/core/videoEdit/codeMaterial/sources'
import type { CodeTypeCheckResult, CodeTypeDiagnostic } from '@/core/videoEdit/codeMaterial/typeDiagnostics'

/** 检查器的只读环境：TypeScript 标准库、WebGPU 类型与作者接口声明，都是文本。 */
export interface AuthorTypeEnvironment {
  /** 文件名（lib.es5.d.ts）→ 内容，至少包含 AUTHOR_TYPE_LIBS 及其引用到的全部标准库。 */
  libs: Readonly<Record<string, string>>
  webgpu: string
  authorApi: string
  /** 按库名与版本读取内置库的类型包；读不到时返回 undefined，导入按 any 处理，不报成找不到模块。 */
  libraryTypes?: (library: string, version: string) => AuthorLibraryTypePackage | undefined
}
/** 构建时生成的 `types.json`：挂到 `/node_modules/<mount>/` 的声明文件，以及实际随包的运行时模块路径。 */
export interface AuthorLibraryTypePackage { mount: string; modules: string[]; files: Readonly<Record<string, string>> }
export interface AuthorTypeChecker {
  /** report 为要报告的作者文件；其余文件（如钉住的项目组件）只参与解析与推断。 */
  check(files: CodeMaterialFiles, report: readonly string[]): CodeTypeCheckResult
}

/** 作者代码运行在剪辑渲染 Worker 里：用 worker 标准库，不给 DOM。 */
export const AUTHOR_TYPE_LIBS = ['lib.esnext.d.ts', 'lib.webworker.d.ts', 'lib.webworker.iterable.d.ts', 'lib.webworker.asynciterable.d.ts'] as const
const AUTHOR_ROOT = '/author/'
const LIB_ROOT = '/lib/'
const ENV = { webgpu: '/env/webgpu.d.ts', api: '/env/henji-author-api.d.ts', globals: '/env/henji-author-globals.d.ts', modules: '/env/henji-author-modules.d.ts', untypedLibrary: '/env/henji-author-untyped-library.d.ts' } as const
const NODE_MODULES = '/node_modules/'
/** 类型包读不到的库声明成无类型模块：导入的一切都是 any，作者代码照常检查其余部分。 */
function untypedLibraries(libraries: Array<[string, string]>): string {
  return libraries.flatMap(([library, version]) => {
    const release = AUTHOR_LIBRARIES[library][version]
    return [...Object.keys(release.modules), ...Object.keys(release.directories ?? {}).map(prefix => `${prefix}*`)].map(specifier => `declare module ${JSON.stringify(specifier)}`)
  }).join('\n') + '\n'
}
/**
 * 包住默认导出的检查函数：借泛型推断 params 的键与取值，并给 draw/layers 的参数上下文类型。
 * 推断不出（没写 params，或对象另有错误）时退回宽类型，不把真正的错误挤成一条误导的 params 错误。
 */
const MODULE_CHECK = '__henjiAuthorModule'
const GLOBALS = `import type * as Api from './henji-author-api'
declare global {
  type AuthorModule<P extends readonly Api.AuthorParamDeclaration[] = readonly Api.AuthorParamDeclaration[]> = Api.AuthorModule<P>
  type AuthorLayer = Api.AuthorLayer
  type AuthorPose = Api.AuthorPose
  type AuthorRect = Api.AuthorRect
  type AuthorFrameInfo = Api.AuthorFrameInfo
  type AuthorParams = Api.AuthorParams
  type AuthorAssets = Api.AuthorAssets
  type AuthorGpuInputs = Api.AuthorGpuInputs
  function ${MODULE_CHECK}<const P extends readonly Api.AuthorParamDeclaration[] = readonly Api.AuthorParamDeclaration[]>(module: Api.AuthorModule<P>): Api.AuthorModule<P>
}
export {}
`
/** 打包器把着色器文本当字符串导入；外链模块类型未知，按 any 处理。 */
const MODULES = `declare module '*.wgsl' { const source: string; export default source }
declare module '*.glsl' { const source: string; export default source }
declare module 'https://*'
declare module 'http://*'
`
/**
 * 不报告的错误码，都是宿主运行时照常接受的 JS 写法：
 * 2556 把数组展开成定长参数（ctx.moveTo(...point)），运行时按下标取值。
 */
const IGNORED_CODES = new Set([2556])
const MAX_DIAGNOSTICS = 50
const OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
  lib: [...AUTHOR_TYPE_LIBS], types: [], noEmit: true, allowJs: true, checkJs: false, resolveJsonModule: true, allowImportingTsExtensions: true,
  // 只拦能确定的低级错误：不要求作者写类型注解、判空或断言 this。
  strict: false, noImplicitAny: false, strictNullChecks: false, noImplicitThis: false, useUnknownInCatchVariables: false,
  strictBindCallApply: true, strictFunctionTypes: true, skipLibCheck: true, skipDefaultLibCheck: true, esModuleInterop: true, useDefineForClassFields: true,
}
const CODE_FILE = /\.(?:[cm]?[jt]sx?)$/
const EXTENSIONS: Array<[RegExp, ts.Extension]> = [[/\.d\.ts$/, ts.Extension.Dts], [/\.tsx$/, ts.Extension.Tsx], [/\.mts$/, ts.Extension.Mts], [/\.cts$/, ts.Extension.Cts], [/\.ts$/, ts.Extension.Ts], [/\.jsx$/, ts.Extension.Jsx], [/\.mjs$/, ts.Extension.Mjs], [/\.cjs$/, ts.Extension.Cjs], [/\.js$/, ts.Extension.Js], [/\.json$/, ts.Extension.Json]]

interface Insertion { at: number; length: number }
/**
 * 作者通常不写类型注解：把入口的默认导出改写成 __henjiAuthorModule(...) 再检查，draw/layers 的参数
 * 就有了上下文类型。改写只在检查器内存里，位置按插入表换回原文。
 */
export function wrapAuthorEntry(file: string, text: string): { text: string; insertions: Insertion[] } {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, /\.[cm]?tsx?$/.test(file) ? ts.ScriptKind.TS : ts.ScriptKind.JS)
  const initializer = (name: string): ts.Expression | undefined => {
    for (const statement of source.statements) if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) if (ts.isIdentifier(declaration.name) && declaration.name.text === name && declaration.initializer) return declaration.initializer
    return undefined
  }
  let target: ts.Expression | undefined
  for (const statement of source.statements) {
    if (ts.isExportAssignment(statement) && !statement.isExportEquals) target = ts.isIdentifier(statement.expression) ? initializer(statement.expression.text) ?? statement.expression : statement.expression
    else if (ts.isExportDeclaration(statement) && !statement.moduleSpecifier && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      const named = statement.exportClause.elements.find(element => element.name.text === 'default')
      if (named) target = initializer((named.propertyName ?? named.name).text)
    }
    if (target) break
  }
  if (!target) return { text, insertions: [] }
  const start = target.getStart(source), end = target.getEnd(), prefix = `${MODULE_CHECK}(`
  return { text: `${text.slice(0, start)}${prefix}${text.slice(start, end)})${text.slice(end)}`, insertions: [{ at: start, length: prefix.length }, { at: end, length: 1 }] }
}
/** 检查器位置 → 原文位置；落在插入文字里的位置归到插入点。 */
function originalOffset(position: number, insertions: readonly Insertion[]): number {
  let shift = 0
  for (const insertion of insertions) {
    const at = insertion.at + shift
    if (position < at) break
    if (position < at + insertion.length) return insertion.at
    shift += insertion.length
  }
  return position - shift
}
/** 与 TypeScript 相同的换行规则（\r\n、\n、\r、U+2028、U+2029），行列从 1 起。 */
function lineColumn(text: string): (offset: number) => { line: number; column: number } {
  const starts = [0]
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index)
    if (code === 13 && text.charCodeAt(index + 1) === 10) index++
    if (code === 10 || code === 13 || code === 0x2028 || code === 0x2029) starts.push(index + 1)
  }
  return offset => {
    const value = Math.min(text.length, Math.max(0, offset))
    let low = 0, high = starts.length
    while (low + 1 < high) { const middle = (low + high) >>> 1; if (starts[middle] <= value) low = middle; else high = middle }
    return { line: low + 1, column: value - starts[low] + 1 }
  }
}
/** TypeScript 的 // @ts-check、// @ts-nocheck 写在文件开头的注释里。 */
function leadingPragma(text: string, pragma: 'ts-check' | 'ts-nocheck'): boolean {
  const pattern = new RegExp(`^(?://|/\\*)[\\s*]*@${pragma}\\b`)
  return (ts.getLeadingCommentRanges(text, ts.getShebang(text)?.length ?? 0) ?? []).some(range => pattern.test(text.slice(range.pos, range.end)))
}
function flattenMessage(message: string | ts.DiagnosticMessageChain): string {
  // 长链首行说是哪里不匹配，末行说根因（如缺少 bounds）；中间层次对作者没有帮助。
  const lines = ts.flattenDiagnosticMessageText(message, '\n').split('\n').map(line => line.trim()).filter(Boolean)
  const clip = (line: string, length: number): string => line.length > length ? `${line.slice(0, length - 1)}…` : line
  return lines.length <= 1 ? clip(lines[0] ?? '', 400) : `${clip(lines[0], 220)} → ${clip(lines[lines.length - 1], 300)}`
}

/** LanguageService 常驻：标准库只解析一次，之后每次只重查变化的作者文件。 */
export function createAuthorTypeChecker(environment: AuthorTypeEnvironment): AuthorTypeChecker {
  const fixed = new Map<string, string>([[ENV.webgpu, environment.webgpu], [ENV.api, environment.authorApi], [ENV.globals, GLOBALS], [ENV.modules, MODULES], ...Object.entries(environment.libs).map(([name, text]): [string, string] => [LIB_ROOT + name, text])])
  // 标准库互相 /// <reference lib>；缺一个就会把所有内置类型报成找不到。升级 TypeScript 后由测试当场发现。
  const needed = [...AUTHOR_TYPE_LIBS] as string[]
  for (let index = 0; index < needed.length; index++) {
    const text = fixed.get(LIB_ROOT + needed[index])
    if (text === undefined) throw new Error(`作者类型检查缺少标准库 ${needed[index]}。`)
    for (const match of text.matchAll(/^\/\/\/\s*<reference\s+lib="([^"]+)"/gm)) { const name = `lib.${match[1].toLowerCase()}.d.ts`; if (!needed.includes(name)) needed.push(name) }
  }
  let current: CodeMaterialFiles = { entry: '', files: {} }
  let roots: string[] = []
  const texts = new Map<string, { text: string; version: number }>()
  let revision = 0
  // 库名 → 已挂上的类型包；挂载路径与版本无关，换版本时按版本号让 LanguageService 重读这些文件。
  const mounted = new Map<string, { version: string; types?: AuthorLibraryTypePackage }>()
  const mountedFile = (name: string): { text: string; version: string } | undefined => {
    if (!name.startsWith(NODE_MODULES)) return undefined
    for (const [library, entry] of mounted) {
      const prefix = entry.types && `${NODE_MODULES}${entry.types.mount}/`
      if (!prefix || !name.startsWith(prefix)) continue
      const text = entry.types!.files[name.slice(prefix.length)]
      if (text !== undefined) return { text, version: `${library}@${entry.version}` }
    }
    return undefined
  }
  let untyped = { text: '\n', version: 0 }
  const read = (name: string): string | undefined => name === ENV.untypedLibrary ? untyped.text : texts.get(name)?.text ?? fixed.get(name) ?? mountedFile(name)?.text
  /** 源码导入了哪个内置库就挂哪个库的类型，版本按代码版本记录。 */
  const mountLibraries = (files: CodeMaterialFiles): void => {
    for (const [path, text] of Object.entries(files.files)) {
      if (!CODE_FILE.test(path)) continue
      for (const { fileName } of ts.preProcessFile(text, true, true).importedFiles) {
        if (resolveAuthorProjectImport(files, path, fileName)) continue
        const library = resolveAuthorLibraryModule(fileName, files.libraries)
        const entry = library && mounted.get(library.library)
        // 上次没读到类型包的库每次检查都再问一次环境，由环境决定何时重试。
        if (!library || entry && entry.version === library.version && entry.types) continue
        mounted.set(library.library, { version: library.version, types: environment.libraryTypes?.(library.library, library.version) })
      }
    }
    const text = untypedLibraries([...mounted].filter(([, entry]) => !entry.types).map(([library, entry]): [string, string] => [library, entry.version]))
    if (text !== untyped.text) untyped = { text, version: untyped.version + 1 }
  }
  const moduleHost: ts.ModuleResolutionHost = { fileExists: name => read(name) !== undefined, readFile: read }
  const host: ts.LanguageServiceHost = {
    getCompilationSettings: () => OPTIONS,
    getScriptFileNames: () => [...roots, ENV.webgpu, ENV.globals, ENV.modules, ENV.untypedLibrary],
    getScriptVersion: name => name === ENV.untypedLibrary ? `untyped@${untyped.version}` : mountedFile(name)?.version ?? String(texts.get(name)?.version ?? 0),
    getScriptSnapshot: name => { const text = read(name); return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text) },
    getCurrentDirectory: () => AUTHOR_ROOT,
    getDefaultLibFileName: options => LIB_ROOT + ts.getDefaultLibFileName(options),
    fileExists: moduleHost.fileExists,
    readFile: moduleHost.readFile,
    directoryExists: () => true,
    getDirectories: () => [],
    useCaseSensitiveFileNames: () => true,
    // 作者文件按打包器的同一解析规则（含 @组件/ 映射）连接；着色器与外链交给上面的环境声明。
    resolveModuleNameLiterals: (literals, containingFile) => literals.map(literal => {
      if (!containingFile.startsWith(AUTHOR_ROOT)) return ts.resolveModuleName(literal.text, containingFile, OPTIONS, moduleHost)
      const target = resolveAuthorProjectImport(current, containingFile.slice(AUTHOR_ROOT.length), literal.text)
      const extension = target && EXTENSIONS.find(([pattern]) => pattern.test(target))?.[1]
      if (target) return { resolvedModule: extension ? { resolvedFileName: AUTHOR_ROOT + target, extension, isExternalLibraryImport: false } : undefined }
      // 项目里没有才查内置库，与打包器同一顺序；没随包的子路径（如被排除的加载器）照实报找不到模块。
      const library = resolveAuthorLibraryModule(literal.text, current.libraries)
      if (!library) return { resolvedModule: undefined }
      const types = mounted.get(library.library)?.types
      if (!types) return { resolvedModule: undefined }
      if (!types.modules.includes(library.path)) return { resolvedModule: undefined }
      return ts.resolveModuleName(literal.text, containingFile, OPTIONS, moduleHost)
    }),
  }
  const service = ts.createLanguageService(host, ts.createDocumentRegistry())
  return {
    check(files, report) {
      const started = performance.now()
      const shifted = new Map<string, Insertion[]>()
      const next = new Map<string, string>()
      for (const [path, text] of Object.entries(files.files)) {
        if (!CODE_FILE.test(path) && !/\.json$/.test(path)) continue
        if (path === files.entry && CODE_FILE.test(path)) {
          const wrapped = wrapAuthorEntry(path, text)
          next.set(AUTHOR_ROOT + path, wrapped.text); shifted.set(path, wrapped.insertions)
        } else next.set(AUTHOR_ROOT + path, text)
      }
      for (const name of [...texts.keys()]) if (!next.has(name)) texts.delete(name)
      for (const [name, text] of next) if (texts.get(name)?.text !== text) texts.set(name, { text, version: ++revision })
      current = files
      mountLibraries(files)
      const reported = report.filter(path => CODE_FILE.test(path) && next.has(AUTHOR_ROOT + path))
      roots = reported.map(path => AUTHOR_ROOT + path)
      const program = service.getProgram()
      const checkedFiles: string[] = []
      const diagnostics: CodeTypeDiagnostic[] = []
      for (const path of reported) {
        const name = AUTHOR_ROOT + path
        const original = files.files[path]
        // JS 文件默认不查，开头写 // @ts-check 时与 TS 一样查；任何文件开头写 // @ts-nocheck 都不查。
        if (!program?.getSourceFile(name) || leadingPragma(original, 'ts-nocheck') || /\.[cm]?jsx?$/.test(path) && !leadingPragma(original, 'ts-check')) continue
        checkedFiles.push(path)
        const position = lineColumn(original)
        for (const diagnostic of [...service.getSyntacticDiagnostics(name), ...service.getSemanticDiagnostics(name)]) {
          if (diagnostic.category !== ts.DiagnosticCategory.Error || IGNORED_CODES.has(diagnostic.code)) continue
          const insertions = shifted.get(path) ?? []
          const start = originalOffset(diagnostic.start ?? 0, insertions), end = Math.max(start, originalOffset((diagnostic.start ?? 0) + (diagnostic.length ?? 0), insertions))
          const a = position(start), b = position(end)
          diagnostics.push({ code: diagnostic.code, message: flattenMessage(diagnostic.messageText), span: { file: path, start, end, startLine: a.line, startColumn: a.column, endLine: b.line, endColumn: b.column } })
        }
      }
      return { checkedFiles, diagnostics: diagnostics.slice(0, MAX_DIAGNOSTICS), total: diagnostics.length, elapsedMs: performance.now() - started }
    },
  }
}
