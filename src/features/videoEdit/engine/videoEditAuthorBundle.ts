import type { BuildFailure, BuildOptions, BuildResult, Plugin } from 'esbuild-wasm'
import ts from 'typescript'
import { CodeMaterialError } from '@/core/videoEdit/codeMaterial/contract'
import type { CodeSourceSpan } from '@/core/videoEdit/codeMaterial/contract'
import type { CodeMaterialFiles } from '@/core/videoEdit/codeMaterial/sources'
import { resolveAuthorProjectImport } from '@/core/videoEdit/codeMaterial/authorModulePaths'
import { missingAuthorModuleMessage, resolveAuthorBuiltInImport, rewriteRuntimeAuthorImports, shadowedAuthorLibraryMessage } from './videoEditAuthorModules'

export type { CodeAuthorSourceLocations as AuthorSourceLocations, CodeAuthorBundle as AuthorBundle } from '@/core/videoEdit/codeAuthorProgram'
import type { CodeAuthorSourceLocations as AuthorSourceLocations, CodeAuthorBundle as AuthorBundle } from '@/core/videoEdit/codeAuthorProgram'
type Build = (options: BuildOptions) => Promise<BuildResult>

/** Syntax is read for navigation only, never to approve/reject author JS. */
export function authorSourceLocations(input: CodeMaterialFiles): AuthorSourceLocations {
  const layers: Record<string, CodeSourceSpan> = Object.create(null)
  const duplicates = new Set<string>()
  const factories: Record<string, Record<string, CodeSourceSpan>> = Object.create(null)
  let fallback: CodeSourceSpan | undefined
  for (const [file, text] of Object.entries(input.files)) {
    if (!/\.[cm]?[jt]sx?$/.test(file)) continue
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, /\.tsx?$/.test(file) ? ts.ScriptKind.TS : ts.ScriptKind.JS)
    const functions: Record<string, CodeSourceSpan> = Object.create(null)
    const repeatedFunctions = new Set<string>()
    const span = (node: ts.Node): CodeSourceSpan => {
      const start = node.getStart(source), end = node.getEnd()
      const a = source.getLineAndCharacterOfPosition(start), b = source.getLineAndCharacterOfPosition(end)
      return { file, start, end, startLine: a.line + 1, startColumn: a.character + 1, endLine: b.line + 1, endColumn: b.character + 1 }
    }
    const visit = (node: ts.Node): void => {
      const functionName = ts.isFunctionDeclaration(node) ? node.name?.text
        : ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)) ? node.name.text : undefined
      if (functionName) {
        if (Object.hasOwn(functions, functionName)) repeatedFunctions.add(functionName)
        else functions[functionName] = span(node)
      }
      if (ts.isObjectLiteralExpression(node)) {
        const key = (property: ts.ObjectLiteralElementLike): string | undefined => property.name && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) ? property.name.text : undefined
        const draw = node.properties.find(property => key(property) === 'draw')
        const id = node.properties.find(property => key(property) === 'id')
        if (draw && id && ts.isPropertyAssignment(id) && ts.isStringLiteral(id.initializer)) {
          const value = id.initializer.text
          if (Object.hasOwn(layers, value)) duplicates.add(value)
          else layers[value] = span(node)
        }
        if (file === input.entry) {
          const entry = node.properties.find(property => ['layers', 'draw', 'createWebGL', 'createWebGPU'].includes(key(property) ?? ''))
          if (entry && !fallback) fallback = span(entry)
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
    for (const name of repeatedFunctions) delete functions[name]
    if (Object.keys(functions).length) factories[file] = functions
  }
  // Ambiguous/dynamic IDs use the defining entry span; never point to an arbitrary duplicate.
  for (const id of duplicates) delete layers[id]
  return { layers, factories, ...(fallback ? { fallback } : {}) }
}

/** esbuild owns ESM linking, cycles, syntax and source maps. The host supplies an
 * immutable file snapshot, so imports cannot silently drift between frames. */
export async function bundleAuthorFiles(input: CodeMaterialFiles, build: Build): Promise<AuthorBundle> {
  const libraries: Record<string, string> = {}
  const plugin: Plugin = {
    name: 'author-project',
    setup(api) {
      api.onResolve({ filter: /.*/ }, args => {
        if (/^(?:https?:|data:|blob:)/.test(args.path)) return { path: args.path, external: true }
        const file = args.kind === 'entry-point' ? input.entry : resolveAuthorProjectImport(input, args.importer || input.entry, args.path)
        const shadowed = args.kind === 'entry-point' ? undefined : shadowedAuthorLibraryMessage(args.path, args.importer || input.entry, file, input.libraries)
        if (shadowed) return { errors: [{ text: shadowed }] }
        if (file && Object.hasOwn(input.files, file)) return { path: file, namespace: 'author-project' }
        // 内置库保持外部依赖、改成共享模块地址，同一 Worker 里的多个效果共用一份实例。
        if (args.kind === 'entry-point') return { errors: [{ text: missingAuthorModuleMessage(args.path, args.importer, input.libraries) }] }
        const resolved = resolveAuthorBuiltInImport(args.path, args.importer, input)
        if ('error' in resolved) return { errors: [{ text: resolved.error }] }
        libraries[resolved.library.library] = resolved.library.version
        return { path: resolved.library.url, external: true }
      })
      api.onLoad({ filter: /.*/, namespace: 'author-project' }, args => ({ contents: input.files[args.path], loader: /\.(?:wgsl|glsl)$/.test(args.path) ? 'text' : /\.json$/.test(args.path) ? 'json' : /\.tsx$/.test(args.path) ? 'tsx' : /\.ts$/.test(args.path) ? 'ts' : 'js' }))
    },
  }
  let result: BuildResult
  try {
    result = await build({ entryPoints: [input.entry], plugins: [plugin], bundle: true, write: false, platform: 'browser', format: 'esm', target: 'esnext', sourcemap: 'external', sourcesContent: true, outfile: 'effect.js', logLevel: 'silent' })
  } catch (error) {
    const failure = error as Partial<BuildFailure> | undefined
    const detail = failure?.errors?.[0], location = detail?.location
    const file = location?.file.replace(/^author-project:/, '')
    if (location && file && Object.hasOwn(input.files, file)) {
      const text = input.files[file]
      const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest)
      const line = Math.min(location.line - 1, source.getLineStarts().length - 1)
      // esbuild columns/lengths are UTF-8 bytes; the editor uses UTF-16 offsets.
      const lineStart = source.getLineStarts()[line]
      const lineText = text.slice(lineStart).split(/\r?\n/, 1)[0]
      const encoded = new TextEncoder().encode(lineText), decoder = new TextDecoder()
      const column = decoder.decode(encoded.slice(0, location.column)).length
      const endColumn = decoder.decode(encoded.slice(0, location.column + location.length)).length
      throw new CodeMaterialError('SYNTAX', detail!.text, { file, start: lineStart + column, end: lineStart + endColumn, startLine: line + 1, endLine: line + 1, startColumn: column + 1, endColumn: endColumn + 1 })
    }
    throw error
  }
  const output = result.outputFiles?.find(file => file.path.endsWith('.js'))?.text
  const map = result.outputFiles?.find(file => file.path.endsWith('.js.map'))?.text
  if (output === undefined || map === undefined) throw new Error('作者模块未生成完整代码和源码定位信息。')
  // 打包后只剩一个模块：运行时才确定的 import(...) 按入口文件报错；插入只改动所在行的列号，源码定位仍按行对得上。
  const code = rewriteRuntimeAuthorImports(output, input.entry, input)
  return { code, map, locations: authorSourceLocations(input), ...(Object.keys(libraries).length ? { libraries } : {}), ...(input.apiVersion !== undefined ? { apiVersion: input.apiVersion } : {}) }
}
