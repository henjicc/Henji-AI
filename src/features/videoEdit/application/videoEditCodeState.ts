import { initializeVideoEditCodeSourceRuntime } from './videoEditCodeSourceRuntime'
import { codeMaterialFilesKey, normalizeCodeMaterialFiles, codeVersionContentKey, loadCodeSourceReferences, codeSourceReferencesLoaded, CODE_SOURCE_REVERIFY_MS, type CodeMaterialFiles } from '@/core/videoEdit/codeMaterial/sources'
import { prepareVideoEditAuthorBundle, releaseSharedVideoEditCompiler } from '../engine/videoEditSharedCompiler'
export { prepareVideoEditAuthorBundle } from '../engine/videoEditSharedCompiler'
import { CodeMaterialError } from '@/core/videoEdit/codeMaterial/contract'
import { codeParameterMetadata } from '@/core/videoEdit/codeMaterial/parameterTypes'
import type { CodeAuthorProgram as CodeMaterialProgram } from '@/core/videoEdit/codeAuthorProgram'
import { inspectVideoEditAuthor } from './videoEditAuthorInspection'
import { codeMaterialSource, codeMaterialVersion, videoEditCodeReferences, changedCodeMaterialVersions, validateCodeMaterialDocument } from '@/core/videoEdit/codeMaterialDocument'
import type { CodeMaterialMetadata, CodeMaterialMetadataReader } from '@/core/videoEdit/codeMaterialDocument'
import type { VideoEditDocument } from '@/core/videoEdit/document'
import type { CodeMaterialVersion } from '@/core/videoEdit/codeMaterialPersistence'
import { readCodeMetadataCache, writeCodeMetadataCache } from './videoEditCodeMetadataCache'
import { createLogger } from '@/core/logging'
const logger = createLogger('features.videoEdit.codeMetadata')

interface Checked { definitionId: string; source: string; apiVersion: number; languageVersion: number; metadata: CodeMaterialMetadata; program: CodeMaterialProgram; bytes: number }
export type VideoEditCodeMetadata = Map<string, Checked>
const states = new WeakMap<object, VideoEditCodeMetadata>()
const releasedOwners = new WeakSet<object>()
/** 正在进行的换版本操作已确认读不到的旧版本；操作期间读取它们直接报代码错误，不再进入“读取中”等待。 */
const unreadableVersions = new WeakMap<object, Set<string>>()
export class VideoEditCodeVersionUnreadable extends CodeMaterialError {
  constructor() { super('COMPATIBILITY', '旧代码版本无法读取（源码缺失或编译不过）。') }
}
const checkedPrograms = new Map<string, CodeMaterialProgram>()
let checkedProgramBytes = 0
const compilingPrograms = new Map<string, Promise<CodeMaterialProgram>>()
let compilerGeneration = 0
/**
 * 已检查程序按最近使用保留。上限必须高于一份工程常见的代码版本数：按顺序遍历超过上限的版本时，LRU 每次都会
 * 恰好淘汰下一个要用的，导致打开、字体与渲染准备各自全部重新编译（39 个版本的工程实测每轮 2～5 秒）。
 * 程序带着打包后的源码，所以同时按字节限额。
 */
const CHECKED_PROGRAM_LIMIT = 512
const CHECKED_PROGRAM_BYTES = 192 * 1024 ** 2
const programBytes = (program: CodeMaterialProgram): number => 2 * (program.bundle.modules ? Object.values(program.bundle.modules.files).reduce((sum, source) => sum + source.length, 0) : program.bundle.code.length + program.bundle.map.length)
export async function compileVideoEditCode(source: string | CodeMaterialFiles, signal?: AbortSignal): Promise<CodeMaterialProgram> {
  initializeVideoEditCodeSourceRuntime()
  signal?.throwIfAborted()
  const files = normalizeCodeMaterialFiles(source), key = codeMaterialFilesKey(files)
  const generation = compilerGeneration
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
  const metadata = await readCodeMetadataCache(key)
  const program = metadata ? { ...metadata, bundle } : await inspectVideoEditAuthor(bundle, signal)
  if (!metadata) void writeCodeMetadataCache(key, program)
  signal?.throwIfAborted()
  if (generation !== compilerGeneration) return program
  const previous = checkedPrograms.get(key)
  if (previous) { checkedPrograms.delete(key); checkedProgramBytes -= programBytes(previous) }
  checkedPrograms.set(key, program); checkedProgramBytes += programBytes(program)
  for (const [oldest, value] of checkedPrograms) {
    if (checkedPrograms.size <= CHECKED_PROGRAM_LIMIT && checkedProgramBytes <= CHECKED_PROGRAM_BYTES || oldest === key) break
    checkedPrograms.delete(oldest); checkedProgramBytes -= programBytes(value)
  }
  return program
}
export function releaseVideoEditCodeCompiler(): void { compilerGeneration++; releaseSharedVideoEditCompiler(); checkedPrograms.clear(); compilingPrograms.clear(); checkedProgramBytes = 0 }

export function installVideoEditCodeMetadata(owner: object, metadata: VideoEditCodeMetadata): void { releasedOwners.delete(owner); states.set(owner, metadata); pendingMetadata.delete(owner) }
export function releaseVideoEditCodeMetadata(owner: object): void { releasedOwners.add(owner); states.delete(owner); pendingMetadata.delete(owner) }
export function readVideoEditCodeMetadata(owner: object, document: VideoEditDocument): CodeMaterialMetadataReader {
  return instance => {
    const version = codeMaterialVersion(document, instance)
    let entry = states.get(owner)?.get(version.id)
    if (!entry && codeSourceReferencesLoaded(version)) {
      // 当前帧准备字体时已取得同一内容的元数据，直接接入实例，避免元素编辑再读一次。
      let program: CodeMaterialProgram | undefined
      try { program = checkedPrograms.get(codeMaterialFilesKey(codeMaterialSource(document, instance).compilation)) } catch { /* 尚未读取的文件由下方按需入口处理。 */ }
      if (program) { rememberVideoEditCodeMetadata(owner, instance.definitionId, version, program); entry = states.get(owner)?.get(version.id) }
    }
    if (!entry || entry.definitionId !== instance.definitionId || entry.source !== codeVersionContentKey(version) || entry.apiVersion !== version.apiVersion || entry.languageVersion !== version.languageVersion) {
      if (unreadableVersions.get(owner)?.has(version.id)) throw new VideoEditCodeVersionUnreadable()
      throw new VideoEditCodeMetadataPending(ensureVideoEditCodeParameterMetadata(owner, document, instance.definitionId, instance.versionId))
    }
    return entry.metadata
  }
}
export function rememberVideoEditCodeMetadata(owner: object, definitionId: string, version: CodeMaterialVersion, program: CodeMaterialProgram): void {
  unreadableVersions.get(owner)?.delete(version.id)
  const metadata = states.get(owner)
  if (!metadata) { const entries: VideoEditCodeMetadata = new Map(); states.set(owner, entries); put(entries, definitionId, version, program); return }
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
export async function ensureVideoEditCodeDocumentMetadata(owner: object, document: VideoEditDocument, signal?: AbortSignal, versions?: ReadonlySet<string>): Promise<void> {
  for (const instance of videoEditCodeReferences(document)) {
    if (versions && !versions.has(instance.versionId)) continue
    signal?.throwIfAborted()
    await ensureVideoEditCodeParameterMetadata(owner, document, instance.definitionId, instance.versionId)
  }
}
/**
 * 把一个定义的实例换到 targetVersionId 前，读好各实例原版本的声明。目标版本必须读得到（尚未创建时省略）；
 * 旧版本源码缺失或编译不过不挡住换版本，返回这些版本，由调用方只按新版本声明处理。
 */
export async function ensureVideoEditRetargetMetadata(owner: object, document: VideoEditDocument, definitionId: string, targetVersionId?: string, signal?: AbortSignal): Promise<Set<string>> {
  if (targetVersionId) await ensureVideoEditCodeParameterMetadata(owner, document, definitionId, targetVersionId)
  const unreadable = new Set<string>()
  for (const versionId of new Set(videoEditCodeReferences(document).filter(code => code.definitionId === definitionId && code.versionId !== targetVersionId).map(code => code.versionId))) {
    signal?.throwIfAborted()
    try { await ensureVideoEditCodeParameterMetadata(owner, document, definitionId, versionId) }
    catch (error) {
      signal?.throwIfAborted()
      if (releasedOwners.has(owner)) throw error
      unreadable.add(versionId)
      logger.warn('旧代码版本无法读取，换版本按新版本声明处理', { event: 'video_edit.code.retarget.previous_unreadable', error, context: { definitionId, versionId } })
    }
  }
  return unreadable
}
/**
 * 换版本写入期间把读不到的旧版本标记出来，同步校验（如字体变化核对）据此不再等待它们。
 * 标记只在这次操作里有效：失败可能是暂时的，之后读取照常重试。
 */
export async function withVideoEditUnreadableCodeVersions<T>(owner: object, versions: ReadonlySet<string>, operation: () => Promise<T>): Promise<T> {
  const marked = unreadableVersions.get(owner) ?? new Set<string>(); unreadableVersions.set(owner, marked)
  const added = [...versions].filter(version => !marked.has(version)); added.forEach(version => marked.add(version))
  try { return await operation() }
  finally { added.forEach(version => marked.delete(version)) }
}
export async function ensureVideoEditChangedCodeMetadata(owner: object, before: VideoEditDocument, next: VideoEditDocument, signal?: AbortSignal): Promise<void> {
  const versions = changedCodeMaterialVersions(before, next)
  await ensureVideoEditCodeDocumentMetadata(owner, next, signal, versions)
  await ensureVideoEditCodeDocumentMetadata(owner, before, signal, versions)
  await withVideoEditCodeMetadata(() => validateCodeMaterialDocument(next, readVideoEditCodeMetadata(owner, next), versions))
}
/** 同步手势使用明确的读取中状态；异步调用可等同一个 promise 后重试。 */
export class VideoEditCodeMetadataPending extends Error {
  constructor(readonly ready: Promise<void>) { super('正在读取代码参数…'); void ready.catch(() => undefined) }
}
export async function withVideoEditCodeMetadata<T>(operation: () => T | Promise<T>): Promise<T> {
  for (;;) {
    try { return await operation() }
    catch (error) { if (!(error instanceof VideoEditCodeMetadataPending)) throw error; await error.ready }
  }
}
let metadataRevision = 0
const metadataListeners = new Set<() => void>()
export const videoEditCodeMetadataRevision = (): number => metadataRevision
export function subscribeVideoEditCodeMetadata(listener: () => void): () => void { metadataListeners.add(listener); return () => { metadataListeners.delete(listener) } }
function publishMetadata(): void { metadataRevision++; for (const listener of metadataListeners) listener() }
function put(entries: VideoEditCodeMetadata, definitionId: string, version: CodeMaterialVersion, program: CodeMaterialProgram): void {
  if (program.apiVersion !== version.apiVersion || program.languageVersion !== version.languageVersion) throw new CodeMaterialError('COMPATIBILITY', '源码语言版本与检查结果不一致，请保留原源码并重新提交版本。')
  const existing = entries.get(version.id)
  if (existing?.program === program && existing.definitionId === definitionId && existing.source === codeVersionContentKey(version)) return
  const { name, kind, mode, width, height, durationSeconds, seed, parameters, types } = program
  const metadata = { name, kind, mode, width, height, durationSeconds, seed, parameters, ...(types ? { types } : {}) }
  // 模块由共享 LRU 计费；会话只持有引用和声明，不能把每份多文件源码重复计入声明预算。
  const bytes = new TextEncoder().encode(JSON.stringify(metadata)).byteLength + new TextEncoder().encode(codeVersionContentKey(version)).byteLength
  if ([...entries.values()].reduce((sum, entry) => sum + entry.bytes, 0) - (existing?.bytes ?? 0) + bytes > 32 * 1024 ** 2) throw new CodeMaterialError('BUDGET', '剪辑已读取的代码版本超出会话预算；保存并重新打开剪辑可释放历史版本。')
  entries.set(version.id, { definitionId, source: codeVersionContentKey(version), apiVersion: version.apiVersion, languageVersion: version.languageVersion, metadata, program, bytes }); publishMetadata()
}
export function readVideoEditCodeParameterMetadata(owner: object, document: VideoEditDocument, definitionId: string, versionId: string): { parameters: Record<string, unknown>[]; types: Record<string, unknown> } {
  const entry = readVideoEditCodeMetadata(owner, document)({ definitionId, versionId, parameters: {} })
  return { parameters: entry.parameters.map(codeParameterMetadata), types: Object.fromEntries(Object.entries(entry.types ?? {}).map(([name, type]) => [name, { ...type, fields: Object.fromEntries(Object.entries(type.fields).map(([key, field]) => [key, codeParameterMetadata(field)])) }])) }
}
/** 参数查询按需读取历史版本，与画面复用内容缓存，不改变文档。 */
const pendingMetadata = new WeakMap<object, Map<string, Promise<void>>>()
export async function ensureVideoEditCodeParameterMetadata(owner: object, document: VideoEditDocument, definitionId: string, versionId: string): Promise<void> {
  if (releasedOwners.has(owner)) throw new Error('剪辑已关闭，请重新打开后读取代码参数。')
  if (!states.has(owner)) states.set(owner, new Map())
  const state = states.get(owner)!
  const manifest = codeMaterialVersion(document, { definitionId, versionId, parameters: {} })
  const known = states.get(owner)?.get(versionId)
  if (known && known.source === codeVersionContentKey(manifest) && known.definitionId === definitionId && known.apiVersion === manifest.apiVersion && known.languageVersion === manifest.languageVersion) return
  let jobs = pendingMetadata.get(owner)
  if (!jobs) { jobs = new Map(); pendingMetadata.set(owner, jobs) }
  const key = JSON.stringify([definitionId, versionId, codeVersionContentKey(manifest)])
  const pending = jobs.get(key)
  if (pending) return pending
  const run = (async () => {
    initializeVideoEditCodeSourceRuntime()
    logger.debug('读取代码参数', { event: 'video_edit.code.metadata.start', context: { versionId } })
    try {
      await loadCodeSourceReferences(manifest, { reuseVerifiedWithinMs: CODE_SOURCE_REVERIFY_MS })
      const version = codeMaterialSource(document, { definitionId, versionId, parameters: {} })
      const program = await compileVideoEditCode(version.compilation)
      if (states.get(owner) !== state) return
      rememberVideoEditCodeMetadata(owner, definitionId, version, program)
      logger.debug('代码参数读取完成', { event: 'video_edit.code.metadata.completed', context: { versionId } })
    } catch (error) { logger.warn('代码参数读取失败', { event: 'video_edit.code.metadata.failed', error, context: { versionId } }); throw error }
  })().finally(() => { jobs.delete(key) })
  jobs.set(key, run)
  return run
}
