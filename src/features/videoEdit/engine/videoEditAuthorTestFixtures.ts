import ts from 'typescript'
import type { CodeAuthorBundle, CodeAuthorProgram } from '@/core/videoEdit/codeAuthorProgram'
import { normalizeCodeMaterialFiles, type CodeMaterialFiles } from '@/core/videoEdit/codeMaterial/sources'
import { resolveAuthorLibraryModule } from '@/core/videoEdit/codeMaterial/authorLibraries'
import { authorSourceLocations } from './videoEditAuthorBundle'
import { authorEffectMetadata } from './videoEditAuthorParameters'
import type { AuthorModule } from './videoEditAuthorModule'

/** Node-only fixture boundary; production imports modules in the rendering Worker. */
export function testAuthorBundle(input: string | CodeMaterialFiles): CodeAuthorBundle {
  // 作者接口与内置库版本是编译选项，不属于源码内容：与正式打包器一样带到产物上。
  const raw: CodeMaterialFiles = typeof input === 'string' ? { entry: 'main.ts', files: { 'main.ts': input } } : input
  const { apiVersion, libraries: _libraries, ...contents } = raw
  const files = normalizeCodeMaterialFiles(contents)
  const transformed = ts.transpileModule(files.files[files.entry], { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, sourceMap: true }, fileName: files.entry, reportDiagnostics: true })
  const error = transformed.diagnostics?.find(item => item.category === ts.DiagnosticCategory.Error)
  if (error) throw new Error(ts.flattenDiagnosticMessageText(error.messageText, '\n'))
  return { code: transformed.outputText, map: transformed.sourceMapText ?? '', locations: authorSourceLocations(files), ...(apiVersion !== undefined ? { apiVersion } : {}) }
}

export function testAuthorProgram(bundle: CodeAuthorBundle): CodeAuthorProgram {
  const effect = testAuthorModule(bundle.code)
  return { ...authorEffectMetadata(effect, bundle.apiVersion), apiVersion: bundle.apiVersion ?? 4, languageVersion: 4, seed: 0, bundle }
}

export function testAuthorModule(source: string): AuthorModule {
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.CommonJS } }).outputText
  const exports: { default?: AuthorModule } = {}
  new Function('exports', 'require', compiled)(exports, builtInLibraryStub)
  const effect = exports.default
  if (!effect || ![effect.draw, effect.layers, effect.createWebGL, effect.createWebGPU].some(value => typeof value === 'function')) throw new Error('缺少作者绘制入口。')
  return effect
}

/**
 * Node 里没有渲染 Worker 的内置库模块：导入照常通过（只读名称与参数声明用得上），
 * 一旦在模块顶层真的用到库里的东西就报错，免得测试悄悄跑在假库上。
 */
function builtInLibraryStub(specifier: string): unknown {
  if (!resolveAuthorLibraryModule(specifier)) throw new Error(`测试夹具只认内置库，不认 ${specifier}`)
  return new Proxy({}, { get: (_target, key) => { if (key === '__esModule') return true; throw new Error(`测试夹具不求值内置库 ${specifier}（读取了 ${String(key)}）`) } })
}
