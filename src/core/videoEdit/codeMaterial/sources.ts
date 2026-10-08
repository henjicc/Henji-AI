import { z } from 'zod'
import { sha256HexString } from '../../../utils/save/hash'
import { CODE_MATERIAL_LIMITS, CodeMaterialError } from './contract'

export interface CodeMaterialFiles { entry: string; files: Record<string, string>; resolvedImports?: Record<string, Record<string, string>> }
export interface CodeSourceResolver { read(hash: string, location?: string, path?: string): string }
export interface CodeSource { hash: string; source: string }
export interface CodeFileReference { path: string; location: string; hash: string }
export interface CodeComponentPin { name: string; version: number; location: string; hash: string; imports: CodeComponentPin[] }
const rawComponentPinSchema: z.ZodType<CodeComponentPin> = z.lazy(() => z.object({ name: z.string().min(1), version: z.number().int().positive(), location: z.string().min(1), hash: codeSourceHashSchema, imports: z.array(rawComponentPinSchema) }).strict())
/** Budget the serialized dependency tree before recursive schema parsing can expand a shared DAG. */
function checkComponentMemory(value: unknown, context: z.RefinementCtx): unknown {
  const stack: Array<{ value: unknown; depth: number; leaving?: boolean }> = [{ value, depth: 0 }]
  const active = new WeakSet<object>(); let bytes = 0
  while (stack.length) {
    const entry = stack.pop()!; const item = entry.value
    if (!item || typeof item !== 'object') continue
    if (entry.leaving) { active.delete(item); continue }
    if (active.has(item) || entry.depth > CODE_MATERIAL_LIMITS.depth) { context.addIssue({ code: 'custom', message: '固定组件依赖存在循环或超出64层编译深度。' }); return z.NEVER }
    active.add(item); stack.push({ ...entry, leaving: true })
    if (Array.isArray(item)) { for (const child of item) stack.push({ value: child, depth: entry.depth }); continue }
    const data = item as Record<string, unknown>
    bytes += 128 + ['name', 'location', 'hash'].reduce((sum, key) => sum + (typeof data[key] === 'string' ? data[key].length * 2 : 0), 0)
    if (bytes > 32 * 1024 ** 2) { context.addIssue({ code: 'custom', message: '固定组件依赖描述超出32MiB解析内存预算，请减少重复嵌套后重新保存。' }); return z.NEVER }
    if (Array.isArray(data.imports)) for (const child of data.imports) stack.push({ value: child, depth: entry.depth + 1 })
  }
  return value
}
export const codeComponentPinSchema: z.ZodType<CodeComponentPin> = z.preprocess(checkComponentMemory, rawComponentPinSchema)
export const codeComponentPinsSchema = z.preprocess(checkComponentMemory, z.array(rawComponentPinSchema))
export const codeFilePathSchema = z.string().min(1).refine(value => /^[a-zA-Z0-9_\-.\u3400-\u9fff/]+\.ts$/.test(value) && value.split('/').every(part => part !== '.' && part !== '..' && part.length > 0), '文件路径须为版本内的相对 .ts 路径，只能使用字母、数字、中文、_、-、. 和 /。')
export const codeSourceHashSchema = z.string().regex(/^[a-f0-9]{64}$/)
export const codeSourceTextSchema = z.string().max(CODE_MATERIAL_LIMITS.sourceBytes).refine(value => new TextEncoder().encode(value).byteLength <= CODE_MATERIAL_LIMITS.sourceBytes, '单文件源码最多64KiB。')
export const codeMaterialFilesSchema = z.object({ entry: codeFilePathSchema, files: z.record(codeFilePathSchema, codeSourceTextSchema), resolvedImports: z.record(z.string(), z.record(z.string(), z.string())).optional() }).strict().refine(value => Object.prototype.hasOwnProperty.call(value.files, value.entry), '入口文件不存在。')
export const codeSourcesSchema = z.array(z.object({ hash: codeSourceHashSchema, source: codeSourceTextSchema }).strict()).superRefine((sources, context) => {
  if (new Set(sources.map(source => source.hash)).size !== sources.length) context.addIssue({ code: 'custom', message: '源码内容表的哈希不能重复。' })
})
/** `source` is an authoring shorthand only, never a persisted legacy format. */
export function normalizeCodeMaterialFiles(input: string | CodeMaterialFiles): CodeMaterialFiles {
  const raw = typeof input === 'string' ? { entry: 'main.ts', files: { 'main.ts': input } } : input
  if (raw && typeof raw === 'object' && raw.files && typeof raw.files === 'object') for (const [path, source] of Object.entries(raw.files)) if (typeof source === 'string' && (source.length > CODE_MATERIAL_LIMITS.sourceBytes || new TextEncoder().encode(source).byteLength > CODE_MATERIAL_LIMITS.sourceBytes)) throw new CodeMaterialError('SOURCE_LIMIT', `${path} 源码最多64KiB。`)
  const parsed = codeMaterialFilesSchema.safeParse(raw)
  if (!parsed.success) throw new CodeMaterialError('SYNTAX', parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('；'))
  return parsed.data
}
export function codeFilesFromInput(input: { source?: string; files?: Record<string, string>; entry?: string }): CodeMaterialFiles {
  if ((input.source === undefined) === (input.files === undefined)) throw new CodeMaterialError('SYNTAX', 'source 与 files 必须提供且只能提供其中一个。')
  if (input.source !== undefined) {
    if (input.entry !== undefined && input.entry !== 'main.ts') throw new CodeMaterialError('SYNTAX', 'source 单文件写法的入口必须为 main.ts。')
    return normalizeCodeMaterialFiles(input.source)
  }
  return normalizeCodeMaterialFiles({ entry: input.entry ?? 'main.ts', files: input.files! })
}
// Source content is session memory, never part of a video document. I/O is injected by the host.
const contents = new Map<string, string>()
const transient = new Set<string>()
let reader: ((file: CodeFileReference) => Promise<string>) | undefined
export function installCodeSourceReader(read: (file: CodeFileReference) => Promise<string>): void { reader = read }
export function rememberCodeSource(hash: string, source: string): void { contents.set(hash, source) }
export function rememberTransientCodeSource(hash: string, source: string): string { const location = `memory:${hash}`; transient.add(location); rememberCodeSource(hash, source); return location }
export function documentCodeSourceResolver(_document?: unknown): CodeSourceResolver {
  return { read(hash, _location, path): string { const source = contents.get(hash); if (source === undefined) throw new CodeMaterialError('COMPATIBILITY', `${path ?? '源码文件'} 尚未读取，请重新打开剪辑；若文件缺失，请从项目备份恢复原文件。`); return source } }
}
export function componentFileReferences(imports: readonly CodeComponentPin[] = []): CodeFileReference[] {
  const files: CodeFileReference[] = []; const stack = [...imports]; const seen = new Set<string>()
  while (stack.length) {
    const pin = stack.pop()!; const key = `${pin.location}:${pin.hash}`
    if (seen.has(key)) continue
    seen.add(key); files.push({ path: `@组件/${pin.name}@${pin.version}`, location: pin.location, hash: pin.hash }); stack.push(...pin.imports)
  }
  return files
}
export async function loadCodeSourceReferences(version: { files: readonly CodeFileReference[]; imports?: readonly CodeComponentPin[] }): Promise<void> {
  const checked = new Set<string>()
  for (const file of [...version.files, ...componentFileReferences(version.imports)]) {
    const key = JSON.stringify([file.location, file.hash]); if (checked.has(key)) continue
    checked.add(key)
    if (transient.has(file.location)) continue
    if (!reader) throw new CodeMaterialError('COMPATIBILITY', '源码文件读取服务尚未就绪，请重新打开剪辑。')
    const source = await reader(file)
    if (await sha256HexString(source) !== file.hash) throw new CodeMaterialError('COMPATIBILITY', `${file.path} 已被外部修改，请从项目备份恢复原文件，或将改动保存为新版本。`)
    rememberCodeSource(file.hash, source)
  }
}
export function resolveCodeMaterialFiles(version: { entry: string; files: readonly CodeFileReference[] }, resolver: CodeSourceResolver): CodeMaterialFiles {
  return normalizeCodeMaterialFiles({ entry: version.entry, files: Object.fromEntries(version.files.map(file => [file.path, resolver.read(file.hash, file.location, file.path)])) })
}
export async function verifyCodeSourceReferences(version: { files: readonly CodeFileReference[] }, resolver: CodeSourceResolver): Promise<void> {
  const checked = new Set<string>()
  for (const file of version.files) if (!checked.has(file.hash)) {
    if (await sha256HexString(resolver.read(file.hash, file.location, file.path)) !== file.hash) throw new CodeMaterialError('COMPATIBILITY', `${file.path} 的源码内容与固定哈希不一致，请从项目备份恢复原文件。`)
    checked.add(file.hash)
  }
}
export function assertCodeSourcesUnchanged(before: { codeMaterials?: { versions: { id: string }[] }[] }, after: { codeMaterials?: { versions: { id: string }[] }[] }): void {
  const known = new Map(before.codeMaterials?.flatMap(definition => definition.versions.map(version => [version.id, JSON.stringify(version)])))
  for (const definition of after.codeMaterials ?? []) for (const version of definition.versions) if (known.has(version.id) && known.get(version.id) !== JSON.stringify(version)) throw new CodeMaterialError('COMPATIBILITY', '不可变源码版本不能原位替换，请创建新版本。')
}
export async function addressCodeMaterialFiles(input: string | CodeMaterialFiles): Promise<{ entry: string; files: CodeFileReference[]; codeSources: CodeSource[] }> {
  const contents = normalizeCodeMaterialFiles(input); const sources = new Map<string, string>(); const files: CodeFileReference[] = []
  for (const path of Object.keys(contents.files).sort()) { const source = contents.files[path]; const hash = await sha256HexString(source); sources.set(hash, source); const location = `memory:${hash}`; transient.add(location); rememberCodeSource(hash, source); files.push({ path, location, hash }) }
  return { entry: contents.entry, files, codeSources: [...sources].map(([hash, source]) => ({ hash, source })) }
}
export function mergeCodeSources(...groups: readonly (readonly CodeSource[] | undefined)[]): CodeSource[] {
  const sources = new Map<string, string>()
  for (const group of groups) for (const value of group ?? []) {
    if (sources.has(value.hash) && sources.get(value.hash) !== value.source) throw new CodeMaterialError('COMPATIBILITY', '源码内容哈希对应了不同内容。')
    sources.set(value.hash, value.source)
  }
  return [...sources].map(([hash, source]) => ({ hash, source }))
}
/** Cleanup never deletes ordinary source files visible to the user, including abandoned candidates. */
export function pruneCodeSources<T>(document: T): T { return document }
export function codeMaterialFilesKey(input: CodeMaterialFiles): string { return JSON.stringify([input.entry, Object.entries(input.files).sort(([a], [b]) => a.localeCompare(b))]) }

/** Container relocation changes locations, never the immutable author content. */
export function codeVersionContentKey(version: { entry: string; files: readonly CodeFileReference[]; imports?: readonly CodeComponentPin[] }): string {
  const pinKey = (pin: CodeComponentPin): unknown => [pin.name, pin.version, pin.hash, pin.imports.map(pinKey)]
  return JSON.stringify([version.entry, version.files.map(file => [file.path, file.hash]), (version.imports ?? []).map(pinKey)])
}
