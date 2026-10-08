import { z } from 'zod'
import { sha256HexString } from '../../../utils/save/hash'
import { CODE_MATERIAL_LIMITS, CodeMaterialError } from './contract'

export interface CodeMaterialFiles { entry: string; files: Record<string, string> }
export interface CodeSourceResolver { read(hash: string): string }
export interface CodeSource { hash: string; source: string }
export interface CodeFileReference { path: string; hash: string }
export const codeFilePathSchema = z.string().min(1).refine(value => /^[a-zA-Z0-9_\-.\u3400-\u9fff/]+\.ts$/.test(value) && value.split('/').every(part => part !== '.' && part !== '..' && part.length > 0), '文件路径须为版本内的相对 .ts 路径，只能使用字母、数字、中文、_、-、. 和 /。')
export const codeSourceHashSchema = z.string().regex(/^[a-f0-9]{64}$/)
export const codeSourceTextSchema = z.string().max(CODE_MATERIAL_LIMITS.sourceBytes).refine(value => new TextEncoder().encode(value).byteLength <= CODE_MATERIAL_LIMITS.sourceBytes, '单文件源码最多64KiB。')
export const codeMaterialFilesSchema = z.object({ entry: codeFilePathSchema, files: z.record(codeFilePathSchema, codeSourceTextSchema) }).strict().refine(value => Object.prototype.hasOwnProperty.call(value.files, value.entry), '入口文件不存在。')
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
/** Storage seam for t89: every source consumer accepts this synchronous resolver. */
export function documentCodeSourceResolver(document: { codeSources?: readonly CodeSource[] }): CodeSourceResolver {
  const sources = new Map(document.codeSources?.map(value => [value.hash, value.source]))
  return { read(hash): string { const source = sources.get(hash); if (source === undefined) throw new CodeMaterialError('COMPATIBILITY', '固定版本的源码内容缺失，请恢复源码文件。'); return source } }
}
export function resolveCodeMaterialFiles(version: { entry: string; files: readonly CodeFileReference[] }, resolver: CodeSourceResolver): CodeMaterialFiles {
  return normalizeCodeMaterialFiles({ entry: version.entry, files: Object.fromEntries(version.files.map(file => [file.path, resolver.read(file.hash)])) })
}
export async function verifyCodeSourceReferences(version: { files: readonly CodeFileReference[] }, resolver: CodeSourceResolver): Promise<void> {
  const checked = new Set<string>()
  for (const file of version.files) if (!checked.has(file.hash)) {
    if (await sha256HexString(resolver.read(file.hash)) !== file.hash) throw new CodeMaterialError('COMPATIBILITY', `${file.path} 的源码内容与固定哈希不一致。`)
    checked.add(file.hash)
  }
}
export function assertCodeSourcesUnchanged(before: { codeSources?: readonly CodeSource[] }, after: { codeSources?: readonly CodeSource[] }): void {
  const resolver = documentCodeSourceResolver(before); const known = new Set(before.codeSources?.map(value => value.hash))
  for (const value of after.codeSources ?? []) if (known.has(value.hash) && resolver.read(value.hash) !== value.source) throw new CodeMaterialError('COMPATIBILITY', '不可变源码内容不能原位替换，请创建新版本。')
}
export async function addressCodeMaterialFiles(input: string | CodeMaterialFiles): Promise<{ entry: string; files: CodeFileReference[]; codeSources: CodeSource[] }> {
  const contents = normalizeCodeMaterialFiles(input); const sources = new Map<string, string>(); const files: CodeFileReference[] = []
  for (const path of Object.keys(contents.files).sort()) { const source = contents.files[path]; const hash = await sha256HexString(source); sources.set(hash, source); files.push({ path, hash }) }
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
export function pruneCodeSources<T extends { codeSources?: CodeSource[]; codeMaterials?: { versions: { files: CodeFileReference[] }[] }[] }>(document: T): T {
  const referenced = new Set(document.codeMaterials?.flatMap(definition => definition.versions.flatMap(version => version.files.map(file => file.hash))))
  return { ...document, ...(document.codeSources ? { codeSources: document.codeSources.filter(source => referenced.has(source.hash)) } : {}) }
}
export function codeMaterialFilesKey(input: CodeMaterialFiles): string { return JSON.stringify([input.entry, Object.entries(input.files).sort(([a], [b]) => a.localeCompare(b))]) }
