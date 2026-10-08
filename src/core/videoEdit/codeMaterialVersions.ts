import { codeMaterialDefinitionSchema } from './codeMaterialPersistence'
import type { CodeMaterialDefinition } from './codeMaterialPersistence'
import { CodeMaterialError, type CodeMaterialProgram } from './codeMaterial/contract'
import { addressCodeMaterialFiles, resolveCodeMaterialFiles, type CodeMaterialFiles, type CodeSource, type CodeSourceResolver } from './codeMaterial/sources'

export type CodeSourceCompiler = (files: CodeMaterialFiles) => Promise<CodeMaterialProgram>
export interface CodeMaterialDefinitionResult { definition: CodeMaterialDefinition; program: CodeMaterialProgram; codeSources: CodeSource[] }
/** Hash-addressed source is stored separately; IR is rebuildable cache. */
export async function makeCodeMaterialDefinition(source: string | CodeMaterialFiles, compile: CodeSourceCompiler): Promise<CodeMaterialDefinitionResult> {
  const addressed = await addressCodeMaterialFiles(source)
  const program = await compile(resolveCodeMaterialFiles(addressed, { read: hash => addressed.codeSources.find(value => value.hash === hash)!.source }))
  const { codeSources, ...manifest } = addressed
  const version = { id: crypto.randomUUID(), apiVersion: 1, languageVersion: program.languageVersion, ...manifest }
  const definition = codeMaterialDefinitionSchema.parse({ id: crypto.randomUUID(), name: program.name, defaultVersionId: version.id, versions: [version] })
  return { definition, program, codeSources }
}
/** A resolver is required for the previous immutable version; t89 can replace its storage. */
export async function appendCodeMaterialVersion(definition: CodeMaterialDefinition, source: string | CodeMaterialFiles, compile: CodeSourceCompiler, resolver: CodeSourceResolver): Promise<CodeMaterialDefinitionResult & { versionId: string }> {
  const previousVersion = definition.versions.find(version => version.id === definition.defaultVersionId)
  if (!previousVersion) throw new CodeMaterialError('COMPATIBILITY', '固定代码版本不存在。')
  const previous = await compile(resolveCodeMaterialFiles(previousVersion, resolver))
  if (previous.apiVersion !== previousVersion.apiVersion || previous.languageVersion !== previousVersion.languageVersion) throw new CodeMaterialError('COMPATIBILITY', '源码语言版本与固定版本不一致。')
  const result = await makeCodeMaterialDefinition(source, compile)
  if (previous.kind !== result.program.kind) throw new CodeMaterialError('COMPATIBILITY', '生成素材与输入滤镜不能在同一定义中互换，请另建素材。')
  const version = result.definition.versions[0]
  const existing = definition.versions.find(value => value.entry === version.entry && JSON.stringify([...value.files].sort((a, b) => a.path.localeCompare(b.path))) === JSON.stringify([...version.files].sort((a, b) => a.path.localeCompare(b.path))))
  if (existing) return { ...result, definition, versionId: existing.id }
  return { ...result, definition: codeMaterialDefinitionSchema.parse({ ...definition, versions: [...definition.versions, version] }), versionId: version.id }
}
