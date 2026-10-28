import { jsonEqual } from '../../jsonEqual'
import { codeLocationSchema } from '../../storage/gitCodeLocation'
import { z } from 'zod'
import { sha256HexString } from '../../../utils/save/hash'
import { mapWithConcurrency } from '../../../utils/mapWithConcurrency'
import { CODE_MATERIAL_LIMITS, CodeMaterialError } from './contract'
import { authorLibraryVersion, type AuthorLibraryVersions } from './authorLibraries'
import type { CodeAuthorApiVersion } from '../codeAuthorProgram'

/**
 * 一次编译的输入。`apiVersion`：按哪一版作者接口编译，省略即 4（第一个作者 JS 接口）。
 * `libraries`：代码版本记录的内置库版本，省略的库按第一套解析。
 */
export interface CodeMaterialFiles { entry: string; files: Record<string, string>; resolvedImports?: Record<string, Record<string, string>>; apiVersion?: CodeAuthorApiVersion; libraries?: AuthorLibraryVersions }
export interface CodeSourceResolver { read(hash: string, location?: string, path?: string): string; contentKey?(hash: string, location: string): string }
export interface CodeSource { hash: string; source: string }
export interface CodeFileReference { path: string; location: string; hash: string }
export interface CodeComponentPin { name: string; version: number; location: string; hash: string; imports: CodeComponentPin[] }
const rawComponentPinSchema: z.ZodType<CodeComponentPin> = z.lazy(() => z.object({ name: z.string().min(1), version: z.number().int().positive(), location: codeLocationSchema, hash: codeSourceHashSchema, imports: z.array(rawComponentPinSchema) }).strict())
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
export const codeFilePathSchema = z.string().min(1).refine(value => /^[a-zA-Z0-9_\-.\u3400-\u9fff/]+\.(?:[cm]?[jt]sx?|json|wgsl|glsl)$/.test(value) && value.split('/').every(part => part !== '.' && part !== '..' && part.length > 0), '文件路径须为版本内的相对 JS、TS、JSON 或着色器路径，只能使用字母、数字、中文、_、-、. 和 /。')
export const codeSourceHashSchema = z.string().regex(/^[a-f0-9]{64}$/)
// Bundled third-party author modules (including Three.js) exceed the retired DSL limit.
export const CODE_AUTHOR_SOURCE_MAX_BYTES = 16 * 1024 ** 2
const sourceEncoder = new TextEncoder()
/** 一个 UTF-16 码元在 UTF-8 中最多 3 字节：长度三倍不超限时必然不超限，不必逐次整份编码（每次规范化都会校验全部源码）。 */
const withinSourceBytes = (value: string): boolean => value.length * 3 <= CODE_AUTHOR_SOURCE_MAX_BYTES || sourceEncoder.encode(value).byteLength <= CODE_AUTHOR_SOURCE_MAX_BYTES
export const codeSourceTextSchema = z.string().max(CODE_AUTHOR_SOURCE_MAX_BYTES).refine(withinSourceBytes, '单文件源码最多16MiB。')
export const codeMaterialFilesSchema = z.object({ entry: codeFilePathSchema, files: z.record(codeFilePathSchema, codeSourceTextSchema), resolvedImports: z.record(z.string(), z.record(z.string(), z.string())).optional() }).strict().refine(value => Object.prototype.hasOwnProperty.call(value.files, value.entry), '入口文件不存在。')
export const codeSourcesSchema = z.array(z.object({ hash: codeSourceHashSchema, source: codeSourceTextSchema }).strict()).superRefine((sources, context) => {
  if (new Set(sources.map(source => source.hash)).size !== sources.length) context.addIssue({ code: 'custom', message: '源码内容表的哈希不能重复。' })
})
/** `source` is an authoring shorthand only, never a persisted legacy format. */
export function normalizeCodeMaterialFiles(input: string | CodeMaterialFiles): CodeMaterialFiles {
  const raw = typeof input === 'string' ? { entry: 'main.ts', files: { 'main.ts': input } } : input
  if (raw && typeof raw === 'object' && raw.files && typeof raw.files === 'object') for (const [path, source] of Object.entries(raw.files)) if (typeof source === 'string' && (source.length > CODE_AUTHOR_SOURCE_MAX_BYTES || !withinSourceBytes(source))) throw new CodeMaterialError('SOURCE_LIMIT', `${path} 源码最多16MiB。`)
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
// 路径只指向实际内容键；两个原来相同的文件在磁盘上改成不同内容时不能互相覆盖。
const locationHashes = new Map<string, string>()
const readingLocations = new Map<string, Promise<void>>()
const transient = new Set<string>()
/** 最近一次成功读盘时刻；哈希只作内容寻址，不是外部编辑拦截条件。 */
const verifiedLocations = new Map<string, number>()
/** 同一轮参数、字体准备复用已读取文本的时长。 */
export const CODE_SOURCE_REVERIFY_MS = 30_000
let reader: ((file: CodeFileReference) => Promise<string>) | undefined
export function installCodeSourceReader(read: (file: CodeFileReference) => Promise<string>): void { reader = read }
/** 新打开的会话首次使用源码时必须重新读盘，不沿用上个会话的短时 I/O 复用。 */
export function invalidateCodeSourceReads(versions: Iterable<{ files: readonly CodeFileReference[]; imports?: readonly CodeComponentPin[] }>): void {
  for (const version of versions) for (const file of [...version.files, ...componentFileReferences(version.imports)]) verifiedLocations.delete(JSON.stringify([file.location, file.hash]))
}
export function codeSourceReferencesLoaded(version: { files: readonly CodeFileReference[]; imports?: readonly CodeComponentPin[] }): boolean {
  return [...version.files, ...componentFileReferences(version.imports)].every(file => transient.has(file.location) || verifiedLocations.has(JSON.stringify([file.location, file.hash])))
}
export function rememberCodeSource(hash: string, source: string): void { contents.set(hash, source) }
export function rememberTransientCodeSource(hash: string, source: string): string { const location = `memory:${hash}`; transient.add(location); rememberCodeSource(hash, source); return location }
export function documentCodeSourceResolver(_document?: unknown): CodeSourceResolver {
  return { contentKey: (hash, location) => locationHashes.get(location) ?? hash, read(hash, location, path): string { const source = contents.get(location && locationHashes.get(location) || hash); if (source === undefined) throw new CodeMaterialError('COMPATIBILITY', `${path ?? '源码文件'} 尚未读取；若文件缺失，请从项目备份恢复原文件后重试。`); return source } }
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
/**
 * 按需读取版本引用的源码，以实际读到的内容寻址。缺失文件保留可恢复错误。
 * `reuseVerifiedWithinMs` 让同一轮参数、字体准备复用读取结果；新打开会话会清除此时间窗。
 */
export async function loadCodeSourceReferences(version: { files: readonly CodeFileReference[]; imports?: readonly CodeComponentPin[] }, options: { reuseVerifiedWithinMs?: number } = {}): Promise<void> {
  const pending = new Map<string, CodeFileReference>()
  const now = Date.now()
  for (const file of [...version.files, ...componentFileReferences(version.imports)]) {
    const key = JSON.stringify([file.location, file.hash])
    if (pending.has(key) || transient.has(file.location)) continue
    const verifiedAt = verifiedLocations.get(key)
    if (options.reuseVerifiedWithinMs && verifiedAt !== undefined && now - verifiedAt <= options.reuseVerifiedWithinMs && contents.has(locationHashes.get(file.location) ?? file.hash)) continue
    // 渲染 Worker 没有读取服务，使用主线程已校验并发来的源码。
    if (!reader && contents.has(file.hash)) continue
    if (!reader) throw new CodeMaterialError('COMPATIBILITY', '源码文件读取服务尚未就绪，请重新打开剪辑。')
    pending.set(key, file)
  }
  // 同一路径合并并发 I/O，两个不同路径即使原哈希相同也分别读取。
  await Promise.all([...pending.values()].map(file => {
    const readKey = JSON.stringify([file.location, file.hash])
    const known = readingLocations.get(readKey)
    if (known) return known
    const pending = (async () => {
      const source = await reader!(file)
      const hash = await sha256HexString(source)
      if (file.location.startsWith('git:') && hash !== file.hash) throw new CodeMaterialError('COMPATIBILITY', `${file.path} 的版本内容校验失败，请从工程备份恢复。`)
      rememberCodeSource(hash, source); locationHashes.set(file.location, hash)
      verifiedLocations.set(JSON.stringify([file.location, file.hash]), Date.now())
    })().finally(() => { readingLocations.delete(readKey) })
    readingLocations.set(readKey, pending)
    return pending
  }))
}
/** 需要显式传输内容表的调用方按实际内容键收集；正常渲染已改为按需请求路径。 */
export async function collectCodeSourceTexts(versions: Iterable<{ files: readonly CodeFileReference[]; imports?: readonly CodeComponentPin[] }>, sent?: Set<string>): Promise<Record<string, string>> {
  const result: Record<string, string> = {}
  // 已发送过的版本内容不可变，编辑时不再逐次读盘；其余版本并发读取，再按原顺序收集。
  const pending = [...versions].map(version => ({ version, files: [...version.files, ...componentFileReferences(version.imports)] })).filter(({ files }) => !sent || !files.every(file => sent.has(file.hash)))
  await mapWithConcurrency(pending, 8, ({ version }) => loadCodeSourceReferences(version, { reuseVerifiedWithinMs: CODE_SOURCE_REVERIFY_MS }))
  for (const { files } of pending) {
    for (const file of files) {
      const source = documentCodeSourceResolver().read(file.hash, file.location, file.path)
      const hash = locationHashes.get(file.location) ?? file.hash
      if (source === undefined || sent?.has(hash)) continue
      result[hash] = source; sent?.add(hash)
    }
  }
  return result
}
/** Worker 端接收主线程已校验的源码。 */
export function receiveCodeSourceTexts(sources: Readonly<Record<string, string>> | undefined): void { for (const [hash, source] of Object.entries(sources ?? {})) contents.set(hash, source) }
export function resolveCodeMaterialFiles(version: { entry: string; files: readonly CodeFileReference[] }, resolver: CodeSourceResolver): CodeMaterialFiles {
  return normalizeCodeMaterialFiles({ entry: version.entry, files: Object.fromEntries(version.files.map(file => [file.path, resolver.read(file.hash, file.location, file.path)])) })
}
export async function verifyCodeSourceReferences(version: { files: readonly CodeFileReference[] }, resolver: CodeSourceResolver): Promise<void> {
  // Git 引用按内容寻址，必须与记录的哈希一致；旧位置兼容资产导入调用方，只确认可读，内容身份由实际读到的文本决定。
  for (const file of version.files) {
    const source = resolver.read(file.hash, file.location, file.path)
    if (file.location.startsWith('git:') && await sha256HexString(source) !== file.hash) throw new CodeMaterialError('COMPATIBILITY', `${file.path} 的源码内容校验失败，请恢复原版本后重试。`)
  }
}

/** 仅保存快照更新已有 hash；读取不改文档、不标脏，也不写原文件。 */
export function withActualCodeSourceHashes<T extends { codeMaterials?: { versions: { files: CodeFileReference[]; imports?: CodeComponentPin[] }[] }[] }>(document: T): T {
  const pin = (value: CodeComponentPin): CodeComponentPin => ({ ...value, hash: locationHashes.get(value.location) ?? value.hash, imports: value.imports.map(pin) })
  return { ...document, ...(document.codeMaterials ? { codeMaterials: document.codeMaterials.map(definition => ({ ...definition, versions: definition.versions.map(version => ({ ...version, files: version.files.map(file => ({ ...file, hash: locationHashes.get(file.location) ?? file.hash })), ...(version.imports ? { imports: version.imports.map(pin) } : {}) })) })) } : {}) }
}
export function assertCodeSourcesUnchanged(before: { codeMaterials?: { versions: { id: string }[] }[] }, after: { codeMaterials?: { versions: { id: string }[] }[] }): void {
  if (before.codeMaterials === after.codeMaterials) return
  const known = new Map(before.codeMaterials?.flatMap(definition => definition.versions.map(version => [version.id, version])))
  for (const definition of after.codeMaterials ?? []) for (const version of definition.versions) if (known.has(version.id) && !jsonEqual(known.get(version.id), version)) throw new CodeMaterialError('COMPATIBILITY', '不可变源码版本不能原位替换，请创建新版本。')
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
/**
 * 作者接口 4 与没有内置库记录是省略时的含义，键里不写，已有编译与声明缓存继续命中。
 * 记录成第一套版本的库与不记录解析到同一份库，键里同样不写：新代码编译时与按版本记录重读时命中同一份缓存。
 */
export function codeMaterialFilesKey(input: CodeMaterialFiles): string {
  const sorted = <T>(entries: Array<[string, T]>): Array<[string, T]> => entries.sort(([a], [b]) => a.localeCompare(b))
  const pinned = Object.entries(input.libraries ?? {}).filter(([library, version]) => authorLibraryVersion(library) !== version)
  const libraries = pinned.length ? sorted(pinned) : undefined
  const runtime = input.apiVersion !== undefined && input.apiVersion !== 4 || libraries ? [{ apiVersion: input.apiVersion ?? 4, ...(libraries ? { libraries } : {}) }] : []
  return JSON.stringify([input.entry, sorted(Object.entries(input.files)), sorted(Object.entries(input.resolvedImports ?? {})).map(([path, imports]) => [path, sorted(Object.entries(imports))]), ...runtime])
}

/**
 * Container relocation changes locations, never the immutable author content.
 * 内置库版本决定作者代码实际跑的库，同样属于内容；没有 libraries（或为空）的版本键不变，已有缓存继续有效。
 */
export function codeVersionContentKey(version: { entry: string; files: readonly CodeFileReference[]; imports?: readonly CodeComponentPin[]; libraries?: Readonly<Record<string, string>>; apiVersion?: number }): string {
  const pinKey = (pin: CodeComponentPin): unknown => [pin.name, pin.version, pin.hash, pin.imports.map(pinKey)]
  const libraries = version.libraries && Object.keys(version.libraries).length ? [Object.entries(version.libraries).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)] : []
  // 作者接口也是版本身份：同一份源码按 v4 与 v5 是两个版本。v4 不写，已有版本的键不变。
  const api = version.apiVersion !== undefined && version.apiVersion !== 4 ? [{ apiVersion: version.apiVersion }] : []
  return JSON.stringify([version.entry, version.files.map(file => [file.path, file.hash]), (version.imports ?? []).map(pinKey), ...libraries, ...api])
}
