import { codeMaterialDefinitionSchema } from './codeMaterialPersistence'
import type { CodeMaterialDefinition } from './codeMaterialPersistence'
import { CodeMaterialError } from './codeMaterial/contract'
import type { CodeAuthorProgram as CodeMaterialProgram } from './codeAuthorProgram'
import { addressCodeMaterialFiles, codeVersionContentKey, resolveCodeMaterialFiles, documentCodeSourceResolver, type CodeMaterialFiles, type CodeSourceResolver, type CodeComponentPin, type CodeFileReference } from './codeMaterial/sources'
import { expandPinnedCodeComponents } from './codeMaterial/components'

export type CodeSourceCompiler = (files: CodeMaterialFiles) => Promise<CodeMaterialProgram>
export interface CodeMaterialDefinitionResult { definition: CodeMaterialDefinition; program: CodeMaterialProgram }
export interface CodeVersionPublication { imports: CodeComponentPin[]; name?: string; project?: { commit: string; entry: string }; write(definitionId: string, name: string, files: CodeMaterialFiles, folder?: string): Promise<{ folder?: string; files: CodeFileReference[] }> }
/** Hash-addressed source is stored separately; IR is rebuildable cache. */
export async function makeCodeMaterialDefinition(source: string | CodeMaterialFiles, compile: CodeSourceCompiler, publication: CodeVersionPublication, identity?: { id: string; folder?: string }): Promise<CodeMaterialDefinitionResult> {
  const addressed = await addressCodeMaterialFiles(source)
  const contents = resolveCodeMaterialFiles(addressed, documentCodeSourceResolver())
  const program = await compile(expandPinnedCodeComponents(contents, publication.imports, documentCodeSourceResolver()))
  const id = identity?.id ?? crypto.randomUUID(); const name = publication.name ?? program.name
  const stored = await publication.write(id, name, contents, identity?.folder)
  const version = { id: crypto.randomUUID(), apiVersion: program.apiVersion, languageVersion: program.languageVersion, entry: addressed.entry, files: stored.files, ...(publication.project ? { project: publication.project } : {}), ...(publication.imports.length ? { imports: publication.imports } : {}) }
  const definition = codeMaterialDefinitionSchema.parse({ id, name, ...(stored.folder ? { folder: stored.folder } : {}), defaultVersionId: version.id, versions: [version] })
  return { definition, program }
}
/** A resolver is required for the previous immutable version; t89 can replace its storage. */
export async function appendCodeMaterialVersion(definition: CodeMaterialDefinition, source: string | CodeMaterialFiles, compile: CodeSourceCompiler, resolver: CodeSourceResolver, publication: CodeVersionPublication): Promise<CodeMaterialDefinitionResult & { versionId: string; kindUnverified?: true }> {
  const previousVersion = definition.versions.find(version => version.id === definition.defaultVersionId)
  if (!previousVersion) throw new CodeMaterialError('COMPATIBILITY', '固定代码版本不存在。')
  // 原有版本用来核对种类与语言版本。默认版本源码缺失或编译不过时依次改用其他历史版本，
  // 不挡住新版本；全部读不到才不核对种类（kindUnverified），由调用方记录。取消会在随后编译新版本时照常抛出。
  let previous: CodeMaterialProgram | undefined
  for (const version of [previousVersion, ...definition.versions.filter(value => value !== previousVersion).reverse()]) {
    try { previous = await compile(expandPinnedCodeComponents(resolveCodeMaterialFiles(version, resolver), version.imports ?? [], resolver)) } catch { continue }
    if (previous.apiVersion !== version.apiVersion || previous.languageVersion !== version.languageVersion) throw new CodeMaterialError('COMPATIBILITY', '源码语言版本与固定版本不一致。')
    break
  }
  const addressed = await addressCodeMaterialFiles(source)
  const existing = definition.versions.find(version => codeVersionContentKey(version) === codeVersionContentKey({ ...addressed, imports: publication.imports }))
  const result = await makeCodeMaterialDefinition(source, async files => {
    const program = await compile(files)
    if (previous && previous.kind !== program.kind) throw new CodeMaterialError('COMPATIBILITY', '生成素材与输入滤镜不能在同一定义中互换，请另建素材。')
    return program
  }, { ...publication, name: definition.name, ...(existing ? { write: async () => ({ files: existing.files, folder: definition.folder! }) } : {}) }, definition)
  const version = result.definition.versions[0]
  const kind = previous ? {} : { kindUnverified: true as const }
  if (existing) return { ...result, definition, versionId: existing.id, ...kind }
  return { ...result, definition: codeMaterialDefinitionSchema.parse({ ...definition, folder: result.definition.folder, versions: [...definition.versions, version] }), versionId: version.id, ...kind }
}
