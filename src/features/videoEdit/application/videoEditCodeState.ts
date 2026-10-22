import { initializeVideoEditCodeSourceRuntime } from './videoEditCodeSourceRuntime'
import { codeMaterialFilesKey, normalizeCodeMaterialFiles, codeVersionContentKey, documentCodeSourceResolver, verifyCodeSourceReferences, loadCodeSourceReferences, type CodeMaterialFiles } from '@/core/videoEdit/codeMaterial/sources'
import { prepareVideoEditAuthorBundle, releaseSharedVideoEditCompiler } from '../engine/videoEditSharedCompiler'
export { prepareVideoEditAuthorBundle } from '../engine/videoEditSharedCompiler'
import { CodeMaterialError } from '@/core/videoEdit/codeMaterial/contract'
import { codeParameterMetadata } from '@/core/videoEdit/codeMaterial/parameterTypes'
import type { CodeAuthorProgram as CodeMaterialProgram } from '@/core/videoEdit/codeAuthorProgram'
import { inspectVideoEditAuthor } from './videoEditAuthorInspection'
import { codeMaterialSource, codeMaterialVersion, validateCodeMaterialDocument, videoEditCodeReferences } from '@/core/videoEdit/codeMaterialDocument'
import type { CodeMaterialMetadata, CodeMaterialMetadataReader } from '@/core/videoEdit/codeMaterialDocument'
import type { VideoEditDocument } from '@/core/videoEdit/document'
import type { CodeMaterialVersion } from '@/core/videoEdit/codeMaterialPersistence'
import { mapWithConcurrency } from '@/utils/mapWithConcurrency'

/** 打开剪辑时同时准备的代码版本数。 */
export const CODE_PREPARATION_CONCURRENCY = 4

interface Checked { definitionId: string; source: string; apiVersion: number; languageVersion: number; metadata: CodeMaterialMetadata; program: CodeMaterialProgram; bytes: number }
export type VideoEditCodeMetadata = Map<string, Checked>
const states = new WeakMap<object, VideoEditCodeMetadata>()
const checkedPrograms = new Map<string, CodeMaterialProgram>()
let checkedProgramBytes = 0
const compilingPrograms = new Map<string, Promise<CodeMaterialProgram>>()
/**
 * 已检查程序按最近使用保留。上限必须高于一份工程常见的代码版本数：按顺序遍历超过上限的版本时，LRU 每次都会
 * 恰好淘汰下一个要用的，导致打开、字体与渲染准备各自全部重新编译（39 个版本的工程实测每轮 2～5 秒）。
 * 程序带着打包后的源码，所以同时按字节限额。
 */
const CHECKED_PROGRAM_LIMIT = 512
const CHECKED_PROGRAM_BYTES = 192 * 1024 ** 2
const programBytes = (program: CodeMaterialProgram): number => program.bundle.code.length * 2
export async function compileVideoEditCode(source: string | CodeMaterialFiles, signal?: AbortSignal): Promise<CodeMaterialProgram> {
  initializeVideoEditCodeSourceRuntime()
  signal?.throwIfAborted()
  const files = normalizeCodeMaterialFiles(source), key = codeMaterialFilesKey(files)
  const cached = checkedPrograms.get(key)
  if (cached) { checkedPrograms.delete(key); checkedPrograms.set(key, cached); return cached }
  // 打开、字体与渲染准备会并发请求同一版本：没有取消信号的请求共用同一次编译。
  if (!signal) {
    const pending = compilingPrograms.get(key)
    if (pending) return pending
    const compiling = compileVideoEditCode(files, new AbortController().signal).finally(() => { if (compilingPrograms.get(key) === compiling) compilingPrograms.delete(key) })
    compilingPrograms.set(key, compiling)
    return compiling
  }
  const bundle = await prepareVideoEditAuthorBundle(files, signal)
  const program = await inspectVideoEditAuthor(bundle, signal)
  signal?.throwIfAborted()
  const previous = checkedPrograms.get(key)
  if (previous) { checkedPrograms.delete(key); checkedProgramBytes -= programBytes(previous) }
  checkedPrograms.set(key, program); checkedProgramBytes += programBytes(program)
  for (const [oldest, value] of checkedPrograms) {
    if (checkedPrograms.size <= CHECKED_PROGRAM_LIMIT && checkedProgramBytes <= CHECKED_PROGRAM_BYTES || oldest === key) break
    checkedPrograms.delete(oldest); checkedProgramBytes -= programBytes(value)
  }
  return program
}
export function releaseVideoEditCodeCompiler(): void { releaseSharedVideoEditCompiler(); checkedPrograms.clear(); checkedProgramBytes = 0 }

export function installVideoEditCodeMetadata(owner: object, metadata: VideoEditCodeMetadata): void { states.set(owner, metadata) }
export function readVideoEditCodeMetadata(owner: object, document: VideoEditDocument): CodeMaterialMetadataReader {
  for (const definition of document.codeMaterials ?? []) for (const version of definition.versions) {
    const known = states.get(owner)?.get(version.id)
    if (known && (known.definitionId !== definition.id || known.source !== codeVersionContentKey(version) || known.apiVersion !== version.apiVersion || known.languageVersion !== version.languageVersion)) throw new CodeMaterialError('COMPATIBILITY', '已检查的不可变源码版本被替换，请创建新版本。')
  }
  return instance => {
    const version = codeMaterialVersion(document, instance)
    const entry = states.get(owner)?.get(version.id)
    if (!entry || entry.definitionId !== instance.definitionId || entry.source !== codeVersionContentKey(version) || entry.apiVersion !== version.apiVersion || entry.languageVersion !== version.languageVersion) throw new CodeMaterialError('COMPATIBILITY', '源码版本尚未检查或被替换，请重新打开原剪辑或提交新版本。')
    return entry.metadata
  }
}
export function rememberVideoEditCodeMetadata(owner: object, definitionId: string, version: CodeMaterialVersion, program: CodeMaterialProgram): void {
  const metadata = states.get(owner)
  if (!metadata) throw new Error('剪辑的代码素材会话不存在。')
  put(metadata, definitionId, version, program)
}
export function forgetVideoEditCodeMetadata(owner: object, versionId: string): void { states.get(owner)?.delete(versionId) }
/** 已检查版本的执行模块；未缓存时返回 undefined，不触发编译。 */
export function peekVideoEditCodeProgram(owner: object, versionId: string): CodeMaterialProgram | undefined { return states.get(owner)?.get(versionId)?.program }
/** Reuse the worker-checked module; monitor picking never recompiles author source. */
export function readVideoEditCodeProgram(owner: object, document: VideoEditDocument, instance: Parameters<CodeMaterialMetadataReader>[0]): CodeMaterialProgram {
  readVideoEditCodeMetadata(owner, document)(instance)
  return states.get(owner)!.get(instance.versionId)!.program
}
export async function ensureVideoEditCodeDocumentMetadata(owner: object, document: VideoEditDocument, signal?: AbortSignal): Promise<void> {
  initializeVideoEditCodeSourceRuntime()
  const references = videoEditCodeReferences(document)
  for (const instance of references) if (!states.get(owner)?.has(instance.versionId)) {
    const manifest = document.codeMaterials!.find(definition => definition.id === instance.definitionId)!.versions.find(version => version.id === instance.versionId)!
    await loadCodeSourceReferences(manifest)
    const version = codeMaterialSource(document, instance)
    await verifyCodeSourceReferences(version, documentCodeSourceResolver(document))
    const program = await compileVideoEditCode(version.compilation, signal); signal?.throwIfAborted()
    rememberVideoEditCodeMetadata(owner, instance.definitionId, version, program)
  }
  validateCodeMaterialDocument(document, readVideoEditCodeMetadata(owner, document))
}
function put(entries: VideoEditCodeMetadata, definitionId: string, version: CodeMaterialVersion, program: CodeMaterialProgram): void {
  if (program.apiVersion !== version.apiVersion || program.languageVersion !== version.languageVersion) throw new CodeMaterialError('COMPATIBILITY', '源码语言版本与检查结果不一致，请保留原源码并重新提交版本。')
  const existing = entries.get(version.id)
  if (existing && (existing.source !== codeVersionContentKey(version) || existing.definitionId !== definitionId || existing.apiVersion !== version.apiVersion || existing.languageVersion !== version.languageVersion)) throw new CodeMaterialError('COMPATIBILITY', '不可变源码版本不能原位替换。')
  if (existing) return
  const { name, kind, mode, width, height, durationSeconds, seed, parameters, types } = program
  const metadata = { name, kind, mode, width, height, durationSeconds, seed, parameters, ...(types ? { types } : {}) }
  const bytes = new TextEncoder().encode(JSON.stringify(program)).byteLength + new TextEncoder().encode(codeVersionContentKey(version)).byteLength
  if ([...entries.values()].reduce((sum, entry) => sum + entry.bytes, 0) + bytes > 32 * 1024 ** 2) throw new CodeMaterialError('BUDGET', '剪辑已检查的代码版本超出会话预算；保存并重新打开剪辑可释放历史版本。')
  entries.set(version.id, { definitionId, source: codeVersionContentKey(version), apiVersion: version.apiVersion, languageVersion: version.languageVersion, metadata, program, bytes })
}
/** Rebuild only default/referenced declarations. Unused historical source is
 * checked when explicitly requested; it is never executed or trusted as IR. */
export async function prepareVideoEditCodeMetadata(document: VideoEditDocument): Promise<VideoEditCodeMetadata> {
  const metadata: VideoEditCodeMetadata = new Map()
  initializeVideoEditCodeSourceRuntime()
  const references = videoEditCodeReferences(document)
  // 各版本互不依赖：并发读取与编译（编译检查共用有界的检查会话池），结果按引用顺序写入。
  const unique = [...new Map(references.map(instance => [instance.versionId, instance])).values()]
  const compiled = await mapWithConcurrency(unique, CODE_PREPARATION_CONCURRENCY, async instance => {
    const manifest = document.codeMaterials!.find(definition => definition.id === instance.definitionId)!.versions.find(version => version.id === instance.versionId)!
    await loadCodeSourceReferences(manifest)
    const version = codeMaterialSource(document, instance)
    await verifyCodeSourceReferences(version, documentCodeSourceResolver(document))
    return { instance, version, program: await compileVideoEditCode(version.compilation) }
  })
  for (const { instance, version, program } of compiled) put(metadata, instance.definitionId, version, program)
  validateCodeMaterialDocument(document, instance => {
    const entry = metadata.get(instance.versionId)
    if (!entry) throw new CodeMaterialError('COMPATIBILITY', '固定代码版本未能完成检查。')
    return entry.metadata
  })
  return metadata
}
export function readVideoEditCodeParameterMetadata(owner: object, document: VideoEditDocument, definitionId: string, versionId: string): { parameters: Record<string, unknown>[]; types: Record<string, unknown> } {
  const entry = readVideoEditCodeMetadata(owner, document)({ definitionId, versionId, parameters: {} })
  return { parameters: entry.parameters.map(codeParameterMetadata), types: Object.fromEntries(Object.entries(entry.types ?? {}).map(([name, type]) => [name, { ...type, fields: Object.fromEntries(Object.entries(type.fields).map(([key, field]) => [key, codeParameterMetadata(field)])) }])) }
}
/** Metadata queries compile unused immutable versions through the same Worker, without changing the document. */
export async function ensureVideoEditCodeParameterMetadata(owner: object, document: VideoEditDocument, definitionId: string, versionId: string): Promise<void> {
  const manifest = document.codeMaterials?.find(definition => definition.id === definitionId)?.versions.find(version => version.id === versionId)
  if (!manifest) throw new Error('固定源码版本不存在。')
  initializeVideoEditCodeSourceRuntime()
  await loadCodeSourceReferences(manifest)
  const version = codeMaterialSource(document, { definitionId, versionId, parameters: {} })
  const known = states.get(owner)?.get(versionId)
  if (known && known.source === codeVersionContentKey(version) && known.definitionId === definitionId && known.apiVersion === version.apiVersion && known.languageVersion === version.languageVersion) return
  await verifyCodeSourceReferences(version, documentCodeSourceResolver(document))
  rememberVideoEditCodeMetadata(owner, definitionId, version, await compileVideoEditCode(version.compilation))
}
