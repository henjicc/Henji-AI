import { codeMaterialDefinitionSchema } from './codeMaterialPersistence'
import type { CodeMaterialDefinition } from './codeMaterialPersistence'
import { CodeMaterialError, type CodeMaterialProgram } from './codeMaterial/contract'
import { addressCodeMaterialFiles, codeVersionContentKey, resolveCodeMaterialFiles, documentCodeSourceResolver, type CodeMaterialFiles, type CodeSourceResolver, type CodeComponentPin, type CodeFileReference } from './codeMaterial/sources'
import { expandPinnedCodeComponents } from './codeMaterial/components'

export type CodeSourceCompiler = (files: CodeMaterialFiles) => Promise<CodeMaterialProgram>
export interface CodeMaterialDefinitionResult { definition: CodeMaterialDefinition; program: CodeMaterialProgram }
export interface CodeVersionPublication { imports: CodeComponentPin[]; name?: string; write(definitionId: string, name: string, files: CodeMaterialFiles, folder?: string): Promise<{ folder: string; files: CodeFileReference[] }> }
/** Hash-addressed source is stored separately; IR is rebuildable cache. */
export async function makeCodeMaterialDefinition(source: string | CodeMaterialFiles, compile: CodeSourceCompiler, publication: CodeVersionPublication, identity?: { id: string; folder?: string }): Promise<CodeMaterialDefinitionResult> {
  const addressed = await addressCodeMaterialFiles(source)
  const contents = resolveCodeMaterialFiles(addressed, documentCodeSourceResolver())
  const program = await compile(expandPinnedCodeComponents(contents, publication.imports, documentCodeSourceResolver()))
  const id = identity?.id ?? crypto.randomUUID(); const name = publication.name ?? program.name
  const stored = await publication.write(id, name, contents, identity?.folder)
  const version = { id: crypto.randomUUID(), apiVersion: 1, languageVersion: program.languageVersion, entry: addressed.entry, files: stored.files, ...(publication.imports.length ? { imports: publication.imports } : {}) }
  const definition = codeMaterialDefinitionSchema.parse({ id, name, ...(stored.folder ? { folder: stored.folder } : {}), defaultVersionId: version.id, versions: [version] })
  return { definition, program }
}
/** A resolver is required for the previous immutable version; t89 can replace its storage. */
export async function appendCodeMaterialVersion(definition: CodeMaterialDefinition, source: string | CodeMaterialFiles, compile: CodeSourceCompiler, resolver: CodeSourceResolver, publication: CodeVersionPublication): Promise<CodeMaterialDefinitionResult & { versionId: string }> {
  const previousVersion = definition.versions.find(version => version.id === definition.defaultVersionId)
  if (!previousVersion) throw new CodeMaterialError('COMPATIBILITY', '固定代码版本不存在。')
  const previous = await compile(expandPinnedCodeComponents(resolveCodeMaterialFiles(previousVersion, resolver), previousVersion.imports ?? [], resolver))
  if (previous.apiVersion !== previousVersion.apiVersion || previous.languageVersion !== previousVersion.languageVersion) throw new CodeMaterialError('COMPATIBILITY', '源码语言版本与固定版本不一致。')
  const addressed = await addressCodeMaterialFiles(source)
  const existing = definition.versions.find(version => codeVersionContentKey(version) === codeVersionContentKey({ ...addressed, imports: publication.imports }))
  const result = await makeCodeMaterialDefinition(source, async files => {
    const program = await compile(files)
    if (previous.kind !== program.kind) throw new CodeMaterialError('COMPATIBILITY', '生成素材与输入滤镜不能在同一定义中互换，请另建素材。')
    return program
  }, { ...publication, name: definition.name, ...(existing ? { write: async () => ({ files: existing.files, folder: definition.folder! }) } : {}) }, definition)
  const version = result.definition.versions[0]
  if (existing) return { ...result, definition, versionId: existing.id }
  return { ...result, definition: codeMaterialDefinitionSchema.parse({ ...definition, folder: result.definition.folder, versions: [...definition.versions, version] }), versionId: version.id }
}
