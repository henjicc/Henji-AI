import type { BuildFailure, BuildOptions, BuildResult, Plugin } from 'esbuild-wasm'
import ts from 'typescript'
import { readStaticTextFonts, type StaticTextFonts } from '@/core/videoEdit/codeMaterial/textFonts'
import { CODE_AUTHOR_SHAPED_TEXT_MIN_API_VERSION } from '@/core/videoEdit/codeAuthorVersions'
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
  const duplicates = new Set<string>(), adjust = new Set<string>()
  const factories: Record<string, Record<string, CodeSourceSpan>> = Object.create(null)
  let fallback: CodeSourceSpan | undefined
  let dynamicIds = false
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
        const draw = node.properties.find(property => ['draw', 'adjust'].includes(key(property) ?? ''))
        const id = node.properties.find(property => key(property) === 'id')
        const spread = node.properties.some(ts.isSpreadAssignment)
        if (draw && id && ts.isPropertyAssignment(id) && ts.isStringLiteral(id.initializer) && !spread) {
          const value = id.initializer.text
          if (Object.hasOwn(layers, value)) duplicates.add(value)
          else layers[value] = span(node)
          if (node.properties.some(property => key(property) === 'adjust')) adjust.add(value)
        } else if (draw || id && spread) dynamicIds = true // 展开对象可能带来 draw 或 id，静态表就不完整。
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
  const adjustLayerIds = [...adjust].filter(id => Object.hasOwn(layers, id))
  return { layers, factories, ...(fallback ? { fallback } : {}), ...(dynamicIds || duplicates.size ? {} : { staticLayerIds: true as const }), ...(adjustLayerIds.length ? { adjustLayerIds } : {}) }
}

/** esbuild owns ESM linking, cycles, syntax and source maps. The host supplies an
 * immutable file snapshot, so imports cannot silently drift between frames. */
export async function bundleAuthorFiles(input: CodeMaterialFiles, build: Build): Promise<AuthorBundle> {
  const libraries: Record<string, string> = {}
  const textFonts = new Map<string, StaticTextFonts>()
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
      api.onLoad({ filter: /.*/, namespace: 'author-project' }, args => {
        const text = input.files[args.path]
        if ((input.apiVersion ?? 4) >= CODE_AUTHOR_SHAPED_TEXT_MIN_API_VERSION && /\.[cm]?[jt]sx?$/.test(args.path)) {
          const source = ts.createSourceFile(args.path, text, ts.ScriptTarget.Latest, true, /\.tsx$/.test(args.path) ? ts.ScriptKind.TSX : /\.ts$/.test(args.path) ? ts.ScriptKind.TS : ts.ScriptKind.JS)
          const resources = readStaticTextFonts(source, input.apiVersion!)
          const errors = resources.diagnostics.filter(value => value.severity === 'error').map(value => {
            const start = source.getLineAndCharacterOfPosition(value.start)
            return { text: value.message, location: { file: args.path, line: start.line + 1, column: new TextEncoder().encode(text.slice(source.getLineStarts()[start.line], value.start)).length, length: new TextEncoder().encode(text.slice(value.start, value.end)).length, lineText: text.slice(source.getLineStarts()[start.line]).split(/\r?\n/, 1)[0] } }
          })
          if (errors.length) return { errors }
          if (resources.usesText || args.path === input.entry || resources.parameters?.length) textFonts.set(args.path, resources)
        }
        return { contents: text, loader: /\.(?:wgsl|glsl)$/.test(args.path) ? 'text' : /\.json$/.test(args.path) ? 'json' : /\.tsx$/.test(args.path) ? 'tsx' : /\.ts$/.test(args.path) ? 'ts' : 'js' }
      })
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
  // JS 保持完整原生模块图，运行时 import(name) 仍由模块地址表解析项目文件。
  const shapedText = (input.apiVersion ?? 4) >= CODE_AUTHOR_SHAPED_TEXT_MIN_API_VERSION
  const modules = shapedText && !Object.keys(input.files).some(path => /\.[cm]?tsx?$/.test(path)) ? input : undefined
  return { code, map, locations: authorSourceLocations(input), ...(modules ? { modules } : {}), ...(shapedText ? { textEntry: input.entry, textFonts: [...textFonts].sort(([a], [b]) => a.localeCompare(b)).map(([file, resources]) => ({ file, ...resources })) } : {}), ...(Object.keys(libraries).length ? { libraries } : {}), ...(input.apiVersion !== undefined ? { apiVersion: input.apiVersion } : {}) }
}
