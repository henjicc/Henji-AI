import { z } from 'zod'
import { sha256HexString } from '../../../utils/save/hash'
import { mapWithConcurrency } from '../../../utils/mapWithConcurrency'
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
const transient = new Set<string>()
/** 位置与内容最近一次读盘核对通过的时刻。 */
const verifiedLocations = new Map<string, number>()
/** 打开剪辑后紧接着的内部准备步骤复用核对结果的时长。 */
export const CODE_SOURCE_REVERIFY_MS = 30_000
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
/**
 * 读取并核对一个版本引用的源码。默认每次都读盘核对位置与内容（外部修改、缺失要及时报出）；
 * `reuseVerifiedWithinMs` 只给紧跟在一次完整核对之后的内部步骤用（打开剪辑后的字体与渲染准备），
 * 同一位置与内容在这段时间内核对过就不再重读。
 */
export async function loadCodeSourceReferences(version: { files: readonly CodeFileReference[]; imports?: readonly CodeComponentPin[] }, options: { reuseVerifiedWithinMs?: number } = {}): Promise<void> {
  const pending = new Map<string, CodeFileReference>()
  const now = Date.now()
  for (const file of [...version.files, ...componentFileReferences(version.imports)]) {
    const key = JSON.stringify([file.location, file.hash])
    if (pending.has(key) || transient.has(file.location)) continue
    const verifiedAt = verifiedLocations.get(key)
    if (options.reuseVerifiedWithinMs && verifiedAt !== undefined && now - verifiedAt <= options.reuseVerifiedWithinMs && contents.has(file.hash)) continue
    // 渲染 Worker 没有读取服务，使用主线程已校验并发来的源码。
    if (!reader && contents.has(file.hash)) continue
    if (!reader) throw new CodeMaterialError('COMPATIBILITY', '源码文件读取服务尚未就绪，请重新打开剪辑。')
    pending.set(key, file)
  }
  // 每次读取都核对磁盘上的位置与内容（外部修改、缺失要及时报出）；同一版本的文件并发读取。
  await Promise.all([...pending.values()].map(async file => {
    const source = await reader!(file)
    if (await sha256HexString(source) !== file.hash) throw new CodeMaterialError('COMPATIBILITY', `${file.path} 已被外部修改，请从项目备份恢复原文件，或将改动保存为新版本。`)
    rememberCodeSource(file.hash, source)
    verifiedLocations.set(JSON.stringify([file.location, file.hash]), Date.now())
  }))
}
/** 渲染 Worker 不读盘：主线程读好并校验后，把尚未发送的源码随文档一起发过去。 */
export async function collectCodeSourceTexts(versions: Iterable<{ files: readonly CodeFileReference[]; imports?: readonly CodeComponentPin[] }>, sent?: Set<string>): Promise<Record<string, string>> {
  const result: Record<string, string> = {}
  // 已发送过的版本内容不可变，编辑时不再逐次读盘；其余版本并发读取，再按原顺序收集。
  const pending = [...versions].map(version => ({ version, files: [...version.files, ...componentFileReferences(version.imports)] })).filter(({ files }) => !sent || !files.every(file => sent.has(file.hash)))
  await mapWithConcurrency(pending, 8, ({ version }) => loadCodeSourceReferences(version, { reuseVerifiedWithinMs: CODE_SOURCE_REVERIFY_MS }))
  for (const { files } of pending) {
    for (const file of files) {
      const source = contents.get(file.hash)
      if (source === undefined || sent?.has(file.hash)) continue
      result[file.hash] = source; sent?.add(file.hash)
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
