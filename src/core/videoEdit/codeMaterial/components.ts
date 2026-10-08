import ts from 'typescript'
import { z } from 'zod'
import { CodeMaterialError, CODE_V3_LIMITS } from './contract'
import { type CodeComponentPin, type CodeMaterialFiles, type CodeSourceResolver, codeSourceHashSchema } from './sources'

export const codeComponentNameSchema = z.string().trim().min(1).max(200).refine(name => [...name].every(character => character.charCodeAt(0) >= 32) && !/[\\/:*?"<>|@]/.test(name) && !/[. ]$/.test(name) && name !== '.' && name !== '..' && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name), '组件名不能含路径、@ 或非法文件名字符。')
export interface CodeComponentVersion extends CodeComponentPin { source: string; exports: string[]; description: string }
export interface CodeComponent { name: string; latestVersion: number; versions: CodeComponentVersion[] }
const headerPrefix = '// henji-component '
const metadataSchema = z.object({ name: codeComponentNameSchema, version: z.number().int().positive(), description: z.string(), exports: z.array(z.string()), imports: z.array(z.object({ name: codeComponentNameSchema, version: z.number().int().positive(), hash: codeSourceHashSchema }).strict()) }).strict()
export type CodeComponentMetadata = z.infer<typeof metadataSchema>
export function componentSourceMetadata(source: string): { metadata: CodeComponentMetadata; source: string } {
  if (!source.startsWith(headerPrefix)) throw new Error('项目组件说明缺失，请从项目备份恢复原组件文件。')
  try {
    const newline = source.indexOf('\n')
    if (newline < 0) throw new Error('缺失源码')
    return { metadata: metadataSchema.parse(JSON.parse(source.slice(headerPrefix.length, newline))), source: source.slice(newline + 1) }
  } catch { throw new Error('项目组件说明损坏，请从项目备份恢复原组件文件。') }
}
/** A comment keeps all version metadata with the immutable text file during ordinary file transfers. */
export function packageComponentSource(source: string, metadata: CodeComponentMetadata): string { return `${headerPrefix}${JSON.stringify(metadataSchema.parse(metadata))}\n${source}` }
export function codeComponentImports(source: string, fileName = '组件.ts'): Array<{ specifier: string; name: string; version?: number }> {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.ES2020, true, ts.ScriptKind.TS)
  return file.statements.flatMap(statement => {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) return []
    const specifier = statement.moduleSpecifier.text
    if (!specifier.startsWith('@组件/')) return []
    const match = /^@组件\/(.+?)(?:@([1-9]\d*))?$/.exec(specifier)
    if (!match || !codeComponentNameSchema.safeParse(match[1]).success) throw new CodeMaterialError('SYNTAX', `${fileName} 的组件导入名称无效：${specifier}`)
    return [{ specifier, name: match[1], ...(match[2] ? { version: Number(match[2]) } : {}) }]
  })
}
export function rewriteCodeComponentImports(source: string, original: readonly CodeComponentPin[], replacement: readonly CodeComponentPin[]): string {
  const file = ts.createSourceFile('模块.ts', source, ts.ScriptTarget.ES2020, true, ts.ScriptKind.TS)
  const edits: Array<{ start: number; end: number; value: string }> = []
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue
    const request = codeComponentImports(statement.getText(file))[0]; if (!request) continue
    const index = original.indexOf(selectPinnedComponent(original, request.name, request.version)!)
    const pin = replacement[index]; if (!pin) throw new Error(`组件 ${request.specifier} 的导入映射缺失。`)
    edits.push({ start: statement.moduleSpecifier.getStart(file), end: statement.moduleSpecifier.end, value: JSON.stringify(`@组件/${pin.name}@${pin.version}`) })
  }
  for (const edit of edits.sort((a, b) => b.start - a.start)) source = source.slice(0, edit.start) + edit.value + source.slice(edit.end)
  return source
}
export function codeComponentExportNames(source: string): string[] {
  const file = ts.createSourceFile('组件.ts', source, ts.ScriptTarget.ES2020, true, ts.ScriptKind.TS)
  const names: string[] = []
  for (const statement of file.statements) {
    if (ts.isImportDeclaration(statement)) continue
    if (!ts.isVariableStatement(statement) || !(statement.declarationList.flags & ts.NodeFlags.Const) || statement.modifiers?.some(modifier => modifier.kind !== ts.SyntaxKind.ExportKeyword)) throw new CodeMaterialError('SYNTAX', '项目组件只允许 import、const、export const 与纯箭头函数，不能默认导出或执行副作用。')
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) throw new CodeMaterialError('SYNTAX', '组件声明必须有名称与静态值或箭头函数。')
      if (statement.modifiers?.length) names.push(declaration.name.text)
    }
  }
  if (!names.length) throw new CodeMaterialError('SYNTAX', '项目组件至少需要一个具名导出。')
  return names
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
      if (chain.length >= CODE_V3_LIMITS.depth) throw new CodeMaterialError('BUDGET', '组件依赖深度超出编译预算。')
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
  const expand = (path: string, source: string, pins: readonly CodeComponentPin[], chain: string[]): void => {
    for (const request of codeComponentImports(source, path)) {
      const pin = selectPinnedComponent(pins, request.name, request.version)
      if (!pin) throw new CodeMaterialError('COMPATIBILITY', `${path} 的 ${request.specifier} 未钉住版本，请重新保存素材。`)
      const key = `${pin.name}@${pin.version}:${pin.hash}`
      if (chain.includes(key)) throw new CodeMaterialError('COMPATIBILITY', `组件循环依赖：${[...chain, key].join(' → ')}`)
      if (chain.length >= CODE_V3_LIMITS.depth) throw new CodeMaterialError('BUDGET', '组件依赖深度超出编译预算。')
      let target = paths.get(key)
      if (!target) {
        const stem = pin.name.replace(/[^a-zA-Z0-9_\-.\u3400-\u9fff]/g, '_')
        let suffix = 1; target = `项目组件/${stem}/v${pin.version}.ts`
        while ([...paths.values()].includes(target)) target = `项目组件/${stem}_${++suffix}/v${pin.version}.ts`
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
    const parsed = ts.createSourceFile(path, source, ts.ScriptTarget.ES2020, true, ts.ScriptKind.TS)
    const edits: Array<{ start: number; end: number; value: string }> = []
    for (const statement of parsed.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue
      const target = compilation.resolvedImports?.[path]?.[statement.moduleSpecifier.text]
      if (!target) continue
      const from = path.split('/').slice(0, -1); const to = target.split('/')
      while (from.length && to.length && from[0] === to[0]) { from.shift(); to.shift() }
      const relative = [...from.map(() => '..'), ...to].join('/')
      edits.push({ start: statement.moduleSpecifier.getStart(parsed), end: statement.moduleSpecifier.end, value: JSON.stringify(relative.startsWith('../') ? relative : `./${relative}`) })
    }
    for (const edit of edits.reverse()) source = source.slice(0, edit.start) + edit.value + source.slice(edit.end)
    return [path, source]
  }))
  return { entry: compilation.entry, files }
}
