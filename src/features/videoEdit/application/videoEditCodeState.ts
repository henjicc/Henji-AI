import { VideoEditCodeCompiler } from '../engine/videoEditCodeCompiler'
import { CodeMaterialError } from '@/core/videoEdit/codeMaterial/contract'
import type { CodeMaterialProgram } from '@/core/videoEdit/codeMaterial/contract'
import { codeMaterialSource, validateCodeMaterialDocument } from '@/core/videoEdit/codeMaterialDocument'
import type { CodeMaterialMetadata, CodeMaterialMetadataReader } from '@/core/videoEdit/codeMaterialDocument'
import type { VideoEditDocument } from '@/core/videoEdit/document'
import type { CodeMaterialInstance, CodeMaterialVersion } from '@/core/videoEdit/codeMaterialPersistence'

interface Checked { definitionId: string; source: string; metadata: CodeMaterialMetadata; bytes: number }
export type VideoEditCodeMetadata = Map<string, Checked>
const states = new WeakMap<object, VideoEditCodeMetadata>()
let compiler: VideoEditCodeCompiler | undefined
export function compileVideoEditCode(source: string, signal?: AbortSignal): Promise<CodeMaterialProgram> {
  compiler ??= new VideoEditCodeCompiler()
  return compiler.compile(source, signal)
}
export function releaseVideoEditCodeCompiler(): void { compiler?.dispose(); compiler = undefined }
export function installVideoEditCodeMetadata(owner: object, metadata: VideoEditCodeMetadata): void { states.set(owner, metadata) }
export function readVideoEditCodeMetadata(owner: object, document: VideoEditDocument): CodeMaterialMetadataReader {
  for (const definition of document.codeMaterials ?? []) for (const version of definition.versions) {
    const known = states.get(owner)?.get(version.id)
    if (known && (known.definitionId !== definition.id || known.source !== version.source)) throw new CodeMaterialError('COMPATIBILITY', '已检查的不可变源码版本被替换，请创建新版本。')
  }
  return instance => {
    const version = codeMaterialSource(document, instance)
    const entry = states.get(owner)?.get(version.id)
    if (!entry || entry.definitionId !== instance.definitionId || entry.source !== version.source) throw new CodeMaterialError('COMPATIBILITY', '源码版本尚未检查或被替换，请重新打开原工程或提交新版本。')
    return entry.metadata
  }
}
export function rememberVideoEditCodeMetadata(owner: object, definitionId: string, version: CodeMaterialVersion, program: CodeMaterialProgram): void {
  const metadata = states.get(owner)
  if (!metadata) throw new Error('代码工程会话不存在。')
  put(metadata, definitionId, version, program)
}
export function forgetVideoEditCodeMetadata(owner: object, versionId: string): void { states.get(owner)?.delete(versionId) }
function put(entries: VideoEditCodeMetadata, definitionId: string, version: CodeMaterialVersion, program: CodeMaterialProgram): void {
  const existing = entries.get(version.id)
  if (existing && (existing.source !== version.source || existing.definitionId !== definitionId)) throw new CodeMaterialError('COMPATIBILITY', '不可变源码版本不能原位替换。')
  if (existing) return
  const { name, kind, mode, width, height, durationSeconds, seed, parameters } = program
  const metadata = { name, kind, mode, width, height, durationSeconds, seed, parameters }
  const bytes = new TextEncoder().encode(JSON.stringify(metadata)).byteLength + new TextEncoder().encode(version.source).byteLength
  if (entries.size >= 4096 || [...entries.values()].reduce((sum, entry) => sum + entry.bytes, 0) + bytes > 32 * 1024 ** 2) throw new CodeMaterialError('BUDGET', '工程已检查的代码版本超出会话预算；保存并重新打开工程可释放历史版本。')
  entries.set(version.id, { definitionId, source: version.source, metadata, bytes })
}
/** Rebuild only default/referenced declarations. Unused historical source is
 * checked when explicitly requested; it is never executed or trusted as IR. */
export async function prepareVideoEditCodeMetadata(document: VideoEditDocument): Promise<VideoEditCodeMetadata> {
  const metadata: VideoEditCodeMetadata = new Map()
  const references: CodeMaterialInstance[] = [
    ...(document.codeMaterials ?? []).map(definition => ({ definitionId: definition.id, versionId: definition.defaultVersionId, parameters: {} })),
    ...document.items.flatMap(item => item.code ? [item.code] : []),
    ...document.sequences.flatMap(sequence => sequence.clips.flatMap(clip => clip.code ? [clip.code] : [])),
  ]
  for (const instance of references) if (!metadata.has(instance.versionId)) {
    const version = codeMaterialSource(document, instance)
    put(metadata, instance.definitionId, version, await compileVideoEditCode(version.source))
  }
  validateCodeMaterialDocument(document, instance => {
    const entry = metadata.get(instance.versionId)
    if (!entry) throw new CodeMaterialError('COMPATIBILITY', '固定代码版本未能完成检查。')
    return entry.metadata
  })
  return metadata
}
