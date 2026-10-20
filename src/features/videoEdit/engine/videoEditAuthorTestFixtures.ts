import ts from 'typescript'
import type { CodeAuthorBundle, CodeAuthorProgram } from '@/core/videoEdit/codeAuthorProgram'
import { normalizeCodeMaterialFiles, type CodeMaterialFiles } from '@/core/videoEdit/codeMaterial/sources'
import { authorSourceLocations } from './videoEditAuthorBundle'
import { authorEffectMetadata } from './videoEditAuthorParameters'
import type { AuthorModule } from './videoEditAuthorModule'

/** Node-only fixture boundary; production imports modules in the rendering Worker. */
export function testAuthorBundle(input: string | CodeMaterialFiles): CodeAuthorBundle {
  const files = normalizeCodeMaterialFiles(input)
  const transformed = ts.transpileModule(files.files[files.entry], { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, sourceMap: true }, fileName: files.entry, reportDiagnostics: true })
  const error = transformed.diagnostics?.find(item => item.category === ts.DiagnosticCategory.Error)
  if (error) throw new Error(ts.flattenDiagnosticMessageText(error.messageText, '\n'))
  return { code: transformed.outputText, map: transformed.sourceMapText ?? '', locations: authorSourceLocations(files) }
}

export function testAuthorProgram(bundle: CodeAuthorBundle): CodeAuthorProgram {
  const effect = testAuthorModule(bundle.code)
  return { ...authorEffectMetadata(effect), apiVersion: 4, languageVersion: 4, seed: 0, bundle }
}

export function testAuthorModule(source: string): AuthorModule {
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.CommonJS } }).outputText
  const exports: { default?: AuthorModule } = {}
  new Function('exports', compiled)(exports)
  const effect = exports.default
  if (!effect || ![effect.draw, effect.layers, effect.createWebGL, effect.createWebGPU].some(value => typeof value === 'function')) throw new Error('缺少作者绘制入口。')
  return effect
}
