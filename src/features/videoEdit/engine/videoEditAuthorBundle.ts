import type { BuildFailure, BuildOptions, BuildResult, Plugin } from 'esbuild-wasm'
import ts from 'typescript'
import { CodeMaterialError } from '@/core/videoEdit/codeMaterial/contract'
import type { CodeSourceSpan } from '@/core/videoEdit/codeMaterial/contract'
import type { CodeMaterialFiles } from '@/core/videoEdit/codeMaterial/sources'

export interface AuthorSourceLocations { layers: Record<string, CodeSourceSpan>; fallback?: CodeSourceSpan }
export interface AuthorBundle { code: string; map: string; locations: AuthorSourceLocations }
type Build = (options: BuildOptions) => Promise<BuildResult>

/** Syntax is read for navigation only, never to approve/reject author JS. */
export function authorSourceLocations(input: CodeMaterialFiles): AuthorSourceLocations {
  const layers: Record<string, CodeSourceSpan> = Object.create(null)
  const duplicates = new Set<string>()
  let fallback: CodeSourceSpan | undefined
  for (const [file, text] of Object.entries(input.files)) {
    if (!/\.[cm]?[jt]sx?$/.test(file)) continue
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, /\.tsx?$/.test(file) ? ts.ScriptKind.TS : ts.ScriptKind.JS)
    const span = (node: ts.Node): CodeSourceSpan => {
      const start = node.getStart(source), end = node.getEnd()
      const a = source.getLineAndCharacterOfPosition(start), b = source.getLineAndCharacterOfPosition(end)
      return { file, start, end, startLine: a.line + 1, startColumn: a.character + 1, endLine: b.line + 1, endColumn: b.character + 1 }
    }
    const visit = (node: ts.Node): void => {
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
  }
  // Ambiguous/dynamic IDs use the defining entry span; never point to an arbitrary duplicate.
  for (const id of duplicates) delete layers[id]
  return { layers, ...(fallback ? { fallback } : {}) }
}

/** esbuild owns ESM linking, cycles, syntax and source maps. The host supplies an
 * immutable file snapshot, so imports cannot silently drift between frames. */
export async function bundleAuthorFiles(input: CodeMaterialFiles, build: Build): Promise<AuthorBundle> {
  const root = 'file:///author-project/'
  const paths = new Map(Object.keys(input.files).map(path => [new URL(path, root).href, path]))
  const plugin: Plugin = {
    name: 'author-project',
    setup(api) {
      api.onResolve({ filter: /.*/ }, args => {
        if (/^(?:https?:|data:|blob:)/.test(args.path)) return { path: args.path, external: true }
        const mapped = input.resolvedImports?.[args.importer]?.[args.path]
        const file = mapped ?? (args.kind === 'entry-point' ? input.entry : paths.get(new URL(args.path, new URL(args.importer || input.entry, root)).href) ?? (Object.hasOwn(input.files, args.path) ? args.path : undefined))
        if (!file || !Object.hasOwn(input.files, file)) return { errors: [{ text: `找不到模块 ${args.path}${args.importer ? `（由 ${args.importer} 导入）` : ''}。请将模块或打包好的第三方库加入项目源码。` }] }
        return { path: file, namespace: 'author-project' }
      })
      api.onLoad({ filter: /.*/, namespace: 'author-project' }, args => ({ contents: input.files[args.path], loader: /\.json$/.test(args.path) ? 'json' : /\.tsx$/.test(args.path) ? 'tsx' : /\.ts$/.test(args.path) ? 'ts' : 'js' }))
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
  const code = result.outputFiles?.find(file => file.path.endsWith('.js'))?.text
  const map = result.outputFiles?.find(file => file.path.endsWith('.js.map'))?.text
  if (code === undefined || map === undefined) throw new Error('作者模块未生成完整代码和源码定位信息。')
  return { code, map, locations: authorSourceLocations(input) }
}
