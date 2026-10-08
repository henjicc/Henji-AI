import { documentCodeSourceResolver, verifyCodeSourceReferences, type CodeMaterialFiles } from '@/core/videoEdit/codeMaterial/sources'
import { VideoEditCodeCompiler } from '../engine/videoEditCodeCompiler'
import { CodeMaterialError } from '@/core/videoEdit/codeMaterial/contract'
import { codeParameterMetadata } from '@/core/videoEdit/codeMaterial/parameterTypes'
import type { CodeMaterialProgram } from '@/core/videoEdit/codeMaterial/contract'
import { codeMaterialSource, validateCodeMaterialDocument, videoEditCodeReferences } from '@/core/videoEdit/codeMaterialDocument'
import type { CodeMaterialMetadata, CodeMaterialMetadataReader } from '@/core/videoEdit/codeMaterialDocument'
import type { VideoEditDocument } from '@/core/videoEdit/document'
import type { CodeMaterialVersion } from '@/core/videoEdit/codeMaterialPersistence'

interface Checked { definitionId: string; source: string; apiVersion: number; languageVersion: number; metadata: CodeMaterialMetadata; program: CodeMaterialProgram; bytes: number }
export type VideoEditCodeMetadata = Map<string, Checked>
const states = new WeakMap<object, VideoEditCodeMetadata>()
let compiler: VideoEditCodeCompiler | undefined
export function compileVideoEditCode(source: string | CodeMaterialFiles, signal?: AbortSignal): Promise<CodeMaterialProgram> {
  compiler ??= new VideoEditCodeCompiler()
  return compiler.compile(source, signal)
}
export function releaseVideoEditCodeCompiler(): void { compiler?.dispose(); compiler = undefined }
export function installVideoEditCodeMetadata(owner: object, metadata: VideoEditCodeMetadata): void { states.set(owner, metadata) }
export function readVideoEditCodeMetadata(owner: object, document: VideoEditDocument): CodeMaterialMetadataReader {
  for (const definition of document.codeMaterials ?? []) for (const version of definition.versions) {
    const known = states.get(owner)?.get(version.id)
    if (known && (known.definitionId !== definition.id || known.source !== JSON.stringify([version.entry, version.files]) || known.apiVersion !== version.apiVersion || known.languageVersion !== version.languageVersion)) throw new CodeMaterialError('COMPATIBILITY', '已检查的不可变源码版本被替换，请创建新版本。')
  }
  return instance => {
    const version = codeMaterialSource(document, instance)
    const entry = states.get(owner)?.get(version.id)
    if (!entry || entry.definitionId !== instance.definitionId || entry.source !== JSON.stringify([version.entry, version.files]) || entry.apiVersion !== version.apiVersion || entry.languageVersion !== version.languageVersion) throw new CodeMaterialError('COMPATIBILITY', '源码版本尚未检查或被替换，请重新打开原剪辑或提交新版本。')
    return entry.metadata
  }
}
export function rememberVideoEditCodeMetadata(owner: object, definitionId: string, version: CodeMaterialVersion, program: CodeMaterialProgram): void {
  const metadata = states.get(owner)
  if (!metadata) throw new Error('剪辑的代码素材会话不存在。')
  put(metadata, definitionId, version, program)
}
export function forgetVideoEditCodeMetadata(owner: object, versionId: string): void { states.get(owner)?.delete(versionId) }
/** Reuse the worker-checked IR; monitor picking never recompiles author source. */
export function readVideoEditCodeProgram(owner: object, document: VideoEditDocument, instance: Parameters<CodeMaterialMetadataReader>[0]): CodeMaterialProgram {
  readVideoEditCodeMetadata(owner, document)(instance)
  return states.get(owner)!.get(instance.versionId)!.program
}
export async function ensureVideoEditCodeDocumentMetadata(owner: object, document: VideoEditDocument, signal?: AbortSignal): Promise<void> {
  const references = videoEditCodeReferences(document)
  for (const instance of references) if (!states.get(owner)?.has(instance.versionId)) {
    const version = codeMaterialSource(document, instance)
    await verifyCodeSourceReferences(version, documentCodeSourceResolver(document))
    const program = await compileVideoEditCode(version.contents, signal); signal?.throwIfAborted()
    rememberVideoEditCodeMetadata(owner, instance.definitionId, version, program)
  }
  validateCodeMaterialDocument(document, readVideoEditCodeMetadata(owner, document))
}
function put(entries: VideoEditCodeMetadata, definitionId: string, version: CodeMaterialVersion, program: CodeMaterialProgram): void {
  if (program.apiVersion !== version.apiVersion || program.languageVersion !== version.languageVersion) throw new CodeMaterialError('COMPATIBILITY', '源码语言版本与检查结果不一致，请保留原源码并重新提交版本。')
  const existing = entries.get(version.id)
  if (existing && (existing.source !== JSON.stringify([version.entry, version.files]) || existing.definitionId !== definitionId || existing.apiVersion !== version.apiVersion || existing.languageVersion !== version.languageVersion)) throw new CodeMaterialError('COMPATIBILITY', '不可变源码版本不能原位替换。')
  if (existing) return
  const { name, kind, mode, width, height, durationSeconds, seed, parameters, types } = program
  const metadata = { name, kind, mode, width, height, durationSeconds, seed, parameters, ...(types ? { types } : {}) }
  const bytes = new TextEncoder().encode(JSON.stringify(program)).byteLength + new TextEncoder().encode(JSON.stringify([version.entry, version.files])).byteLength
  if ([...entries.values()].reduce((sum, entry) => sum + entry.bytes, 0) + bytes > 32 * 1024 ** 2) throw new CodeMaterialError('BUDGET', '剪辑已检查的代码版本超出会话预算；保存并重新打开剪辑可释放历史版本。')
  entries.set(version.id, { definitionId, source: JSON.stringify([version.entry, version.files]), apiVersion: version.apiVersion, languageVersion: version.languageVersion, metadata, program, bytes })
}
/** Rebuild only default/referenced declarations. Unused historical source is
 * checked when explicitly requested; it is never executed or trusted as IR. */
export async function prepareVideoEditCodeMetadata(document: VideoEditDocument): Promise<VideoEditCodeMetadata> {
  const metadata: VideoEditCodeMetadata = new Map()
  const references = videoEditCodeReferences(document)
  for (const instance of references) if (!metadata.has(instance.versionId)) {
    const version = codeMaterialSource(document, instance)
    await verifyCodeSourceReferences(version, documentCodeSourceResolver(document))
    put(metadata, instance.definitionId, version, await compileVideoEditCode(version.contents))
  }
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
  const version = codeMaterialSource(document, { definitionId, versionId, parameters: {} })
  const known = states.get(owner)?.get(versionId)
  if (known && known.source === JSON.stringify([version.entry, version.files]) && known.definitionId === definitionId && known.apiVersion === version.apiVersion && known.languageVersion === version.languageVersion) return
  await verifyCodeSourceReferences(version, documentCodeSourceResolver(document))
  rememberVideoEditCodeMetadata(owner, definitionId, version, await compileVideoEditCode(version.contents))
}
