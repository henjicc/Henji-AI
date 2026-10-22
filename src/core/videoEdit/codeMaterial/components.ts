import { CODE_COMPONENT_SCHEMA_VERSION } from '../../persistence/schemaVersions'
import { parse } from 'es-module-lexer/js'
import { migratePersistenceContent, PersistenceError } from '../../persistence/migrations'
import { formatMigrations } from '../../persistence/formatMigrations'
import { z } from 'zod'
import { CodeMaterialError, CODE_MATERIAL_LIMITS } from './contract'
import { type CodeComponentPin, type CodeMaterialFiles, type CodeSourceResolver, codeSourceHashSchema } from './sources'

export const codeComponentNameSchema = z.string().trim().min(1).max(200).refine(name => [...name].every(character => character.charCodeAt(0) >= 32) && !/[\\/:*?"<>|@]/.test(name) && !/[. ]$/.test(name) && name !== '.' && name !== '..' && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name), '组件名不能含路径、@ 或非法文件名字符。')
export interface CodeComponentVersion extends CodeComponentPin { source: string; exports: string[]; description: string }
export interface CodeComponent { name: string; latestVersion: number; versions: CodeComponentVersion[] }
const headerPrefix = '// henji-component '
export const codeComponentMetadataSchema = z.object({ schemaVersion: z.literal(CODE_COMPONENT_SCHEMA_VERSION).default(CODE_COMPONENT_SCHEMA_VERSION), name: codeComponentNameSchema, version: z.number().int().positive(), description: z.string(), exports: z.array(z.string()), imports: z.array(z.object({ name: codeComponentNameSchema, version: z.number().int().positive(), hash: codeSourceHashSchema }).strict()) }).strict()
export type CodeComponentMetadata = z.input<typeof codeComponentMetadataSchema>
export function componentSourceMetadata(source: string): { metadata: CodeComponentMetadata; source: string } {
  if (!source.startsWith(headerPrefix)) throw new Error('项目组件说明缺失，请从项目备份恢复原组件文件。')
  const newline = source.indexOf('\n')
  if (newline < 0) throw new PersistenceError('corrupt', 'code-component', '项目组件说明', 0, 1)
  let raw: unknown
  try { raw = JSON.parse(source.slice(headerPrefix.length, newline)) as unknown }
  catch (cause) { throw new PersistenceError('corrupt', 'code-component', '项目组件说明', 0, 1, [], undefined, { cause }) }
  const version = raw && typeof raw === 'object' && 'schemaVersion' in raw ? raw.schemaVersion : 1
  const contract = { id: 'code-component', name: '项目组件说明', version: CODE_COMPONENT_SCHEMA_VERSION, migrations: formatMigrations('code-component') }
  const value = migratePersistenceContent(contract, raw, typeof version === 'number' ? version : 0)
  const parsed = codeComponentMetadataSchema.safeParse(value)
  if (!parsed.success) throw new PersistenceError('invalid-content', contract.id, contract.name, Number(version), 1, parsed.error.issues.map(issue => issue.path.join('.')))
  return { metadata: parsed.data, source: source.slice(newline + 1) }
}
/** A comment keeps all version metadata with the immutable text file during ordinary file transfers. */
export function packageComponentSource(source: string, metadata: CodeComponentMetadata): string { return `${headerPrefix}${JSON.stringify(codeComponentMetadataSchema.parse(metadata))}\n${source}` }
type CodeComponentImport = { specifier: string; name: string; version?: number }
/**
 * 用轻量词法器读取导入并按源码文本缓存，参数、字体和 Worker 共用同一条路径。
 * 解析出错的源码不缓存，每次都照常报错。
 */
const componentImportCache = new Map<string, readonly CodeComponentImport[]>()
const COMPONENT_IMPORT_CACHE_LIMIT = 1024
export function codeComponentImports(source: string, fileName = '组件.ts'): CodeComponentImport[] {
  if (!/\.[cm]?[jt]sx?$/.test(fileName)) return []
  const cached = componentImportCache.get(source)
  if (cached) { componentImportCache.delete(source); componentImportCache.set(source, cached); return cached.map(entry => ({ ...entry })) }
  const parsed = parseCodeComponentImports(source, fileName)
  componentImportCache.set(source, parsed.map(entry => ({ ...entry })))
  while (componentImportCache.size > COMPONENT_IMPORT_CACHE_LIMIT) componentImportCache.delete(componentImportCache.keys().next().value!)
  return parsed
}
function parseCodeComponentImports(source: string, fileName: string): CodeComponentImport[] {
  const [imports] = parse(source)
  return imports.flatMap(request => {
    const specifier = request.specifier
    if (!specifier) return []
    if (!specifier.startsWith('@组件/')) return []
    const match = /^@组件\/(.+?)(?:@([1-9]\d*))?$/.exec(specifier)
    if (!match || !codeComponentNameSchema.safeParse(match[1]).success) throw new CodeMaterialError('SYNTAX', `${fileName} 的组件导入名称无效：${specifier}`)
    return [{ specifier, name: match[1], ...(match[2] ? { version: Number(match[2]) } : {}) }]
  })
}
export function rewriteCodeComponentImports(source: string, original: readonly CodeComponentPin[], replacement: readonly CodeComponentPin[]): string {
  const edits: Array<{ start: number; end: number; value: string }> = []
  for (const entry of parse(source)[0]) {
    const request = codeComponentImports(source).find(request => request.specifier === entry.specifier); if (!request) continue
    const index = original.indexOf(selectPinnedComponent(original, request.name, request.version)!)
    const pin = replacement[index]; if (!pin) throw new Error(`组件 ${request.specifier} 的导入映射缺失。`)
    const name = `@组件/${pin.name}@${pin.version}`
    edits.push({ start: entry.start, end: entry.end, value: entry.type === 'dynamic' ? JSON.stringify(name) : name })
  }
  for (const edit of edits.sort((a, b) => b.start - a.start)) source = source.slice(0, edit.start) + edit.value + source.slice(edit.end)
  return source
}
export function pinCodeComponentImports(files: CodeMaterialFiles, library: readonly CodeComponent[], publishingName?: string): CodeComponentPin[] {
  const pins = new Map<string, CodeComponentPin>()
  for (const [file, source] of Object.entries(files.files)) for (const request of codeComponentImports(source, file)) {
    const component = library.find(value => value.name === request.name)
    const version = component?.versions.find(value => value.version === (request.version ?? component.latestVersion))
    if (!version) throw new CodeMaterialError('COMPATIBILITY', `${file} 引用的 ${request.specifier} 不存在，请先发布组件或选择已有版本。`)
    const checked = new Set<string>()
    const visit = (pin: CodeComponentPin, chain: string[]): void => {
      if (chain.includes(pin.name) || publishingName === pin.name) throw new CodeMaterialError('COMPATIBILITY', `组件循环依赖：${[...(publishingName ? [publishingName] : []), ...chain, pin.name].join(' → ')}。`)
      if (chain.length >= CODE_MATERIAL_LIMITS.depth) throw new CodeMaterialError('BUDGET', '组件依赖深度超出编译预算。')
      const key = `${pin.location}:${pin.hash}`; if (checked.has(key)) return; checked.add(key)
      pin.imports.forEach(child => visit(child, [...chain, pin.name]))
    }
    const pin = { name: version.name, version: version.version, location: version.location, hash: version.hash, imports: structuredClone(version.imports) }
    visit(pin, []); pins.set(`${request.name}@${request.version ?? ''}`, pin)
  }
  return [...pins.values()]
}
/** Keep original author text and spans. The linker receives resolved edges separately. */
export function expandPinnedCodeComponents(contents: CodeMaterialFiles, imports: readonly CodeComponentPin[], resolver: CodeSourceResolver): CodeMaterialFiles {
  const files = { ...contents.files }; const resolvedImports: Record<string, Record<string, string>> = {}
  const visited = new Set<string>(); const paths = new Map<string, string>()
  const keys = new WeakMap<CodeComponentPin, string>()
  const contentKey = (pin: CodeComponentPin): string => {
    const known = keys.get(pin); if (known) return known
    const key = JSON.stringify([pin.name, pin.version, resolver.contentKey?.(pin.hash, pin.location) ?? pin.hash, pin.imports.map(contentKey)])
    keys.set(pin, key); return key
  }
  const expand = (path: string, source: string, pins: readonly CodeComponentPin[], chain: string[]): void => {
    for (const request of codeComponentImports(source, path)) {
      const pin = selectPinnedComponent(pins, request.name, request.version)
      if (!pin) throw new CodeMaterialError('COMPATIBILITY', `${path} 的 ${request.specifier} 未钉住版本，请重新保存素材。`)
      const key = contentKey(pin)
      if (chain.includes(key)) throw new CodeMaterialError('COMPATIBILITY', `组件循环依赖：${[...chain, key].join(' → ')}`)
      if (chain.length >= CODE_MATERIAL_LIMITS.depth) throw new CodeMaterialError('BUDGET', '组件依赖深度超出编译预算。')
      let target = paths.get(key)
      if (!target) {
        const stem = pin.name.replace(/[^a-zA-Z0-9_\-.\u3400-\u9fff]/g, '_')
        const extension = /\.(mjs|js|tsx|ts)$/.exec(pin.location)?.[1] ?? 'ts'
        let suffix = 1; target = `项目组件/${stem}/v${pin.version}.${extension}`
        while ([...paths.values()].includes(target)) target = `项目组件/${stem}_${++suffix}/v${pin.version}.${extension}`
        paths.set(key, target)
      }
      if (contents.files[target] !== undefined) throw new CodeMaterialError('SYNTAX', '项目组件/ 是编译时的组件目录，请重命名作者文件。')
      resolvedImports[path] ??= {}; resolvedImports[path][request.specifier] = target
      if (!visited.has(key)) { visited.add(key); const child = resolver.read(pin.hash, pin.location, `@组件/${pin.name}@${pin.version}`); files[target] = child; expand(target, child, pin.imports, [...chain, key]) }
    }
  }
  for (const [path, source] of Object.entries(contents.files)) expand(path, source, imports, [])
  return { ...contents, files, resolvedImports }
}

function selectPinnedComponent(pins: readonly CodeComponentPin[], name: string, version?: number): CodeComponentPin | undefined {
  const candidates = pins.filter(pin => pin.name === name && (version === undefined || pin.version === version))
  return candidates.reduce<CodeComponentPin | undefined>((latest, pin) => !latest || pin.version > latest.version ? pin : latest, undefined)
}

/** Standalone style samples contain their fixed modules, without requiring the source project's library. */
export function portableCodeComponentFiles(compilation: CodeMaterialFiles): CodeMaterialFiles {
  const files = Object.fromEntries(Object.entries(compilation.files).map(([path, source]) => {
    if (!/\.[cm]?[jt]sx?$/.test(path)) return [path, source]
    const edits: Array<{ start: number; end: number; value: string }> = []
    for (const entry of parse(source)[0]) {
      if (!entry.specifier) continue
      const target = compilation.resolvedImports?.[path]?.[entry.specifier]
      if (!target) continue
      const from = path.split('/').slice(0, -1); const to = target.split('/')
      while (from.length && to.length && from[0] === to[0]) { from.shift(); to.shift() }
      const relative = [...from.map(() => '..'), ...to].join('/')
      const request = relative.startsWith('../') ? relative : `./${relative}`
      edits.push({ start: entry.start, end: entry.end, value: entry.type === 'dynamic' ? JSON.stringify(request) : request })
    }
    for (const edit of edits.reverse()) source = source.slice(0, edit.start) + edit.value + source.slice(edit.end)
    return [path, source]
  }))
  return { entry: compilation.entry, files }
}
