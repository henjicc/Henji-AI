import { codeMaterialDefinitionSchema, codeMaterialDefinitionsSchema, codeMaterialInstanceSchema } from './codeMaterialPersistence'
import type { CodeMaterialDefinition, CodeMaterialInstance, CodeMaterialVersion } from './codeMaterialPersistence'
import { CodeMaterialError } from './codeMaterial/contract'
import type { CodeMaterialProgram } from './codeMaterial/contract'
import { checkCodeMaterialParameterCompatibility, validateCodeMaterialParameters } from './codeMaterial/parameters'
import { prepareCodeMaterialParameters } from './codeMaterialAnimation'

export type CodeSourceCompiler = (source: string) => Promise<CodeMaterialProgram>
const version = (definition: CodeMaterialDefinition, id: string): CodeMaterialVersion => {
  const value = definition.versions.find(version => version.id === id)
  if (!value) throw new CodeMaterialError('COMPATIBILITY', '固定代码版本不存在，不能切换到当前默认版本。')
  return value
}
async function checkedVersion(definition: CodeMaterialDefinition, id: string, compile: CodeSourceCompiler): Promise<CodeMaterialProgram> {
  const sourceVersion = version(definition, id); const program = await compile(sourceVersion.source)
  if (program.apiVersion !== sourceVersion.apiVersion || program.languageVersion !== sourceVersion.languageVersion) throw new CodeMaterialError('COMPATIBILITY', '源码语言版本与固定版本不一致。')
  return program
}
/** Persist source only. Checked IR and schemas are rebuildable cache, never file
 * authority. The host supplies its bounded compiler worker at this boundary. */
export async function makeCodeMaterialDefinition(source: string, compile: CodeSourceCompiler): Promise<{ definition: CodeMaterialDefinition; program: CodeMaterialProgram }> {
  const program = await compile(source)
  const sourceVersion: CodeMaterialVersion = { id: crypto.randomUUID(), apiVersion: 1, languageVersion: program.languageVersion, source }
  const definition = codeMaterialDefinitionSchema.parse({ id: crypto.randomUUID(), name: program.name, defaultVersionId: sourceVersion.id, versions: [sourceVersion] })
  codeMaterialDefinitionsSchema.parse([definition])
  return { definition, program }
}
/** Candidate publication appends a version, preserving every existing version
 * and instance. Changing the default is a separate explicit host edit. */
export async function appendCodeMaterialVersion(definition: CodeMaterialDefinition, source: string, compile: CodeSourceCompiler): Promise<{ definition: CodeMaterialDefinition; versionId: string; program: CodeMaterialProgram }> {
  const previous = await checkedVersion(definition, definition.defaultVersionId, compile)
  const program = await compile(source)
  if (previous.kind !== program.kind) throw new CodeMaterialError('COMPATIBILITY', '生成素材与输入滤镜不能在同一定义中互换，请另建素材。')
  const existing = definition.versions.find(value => value.source === source)
  if (existing) { if (existing.apiVersion !== program.apiVersion || existing.languageVersion !== program.languageVersion) throw new CodeMaterialError('COMPATIBILITY', '源码语言版本与固定版本不一致。'); return { definition, versionId: existing.id, program } }
  const sourceVersion: CodeMaterialVersion = { id: crypto.randomUUID(), apiVersion: 1, languageVersion: program.languageVersion, source }
  const candidate = codeMaterialDefinitionSchema.parse({ ...definition, versions: [...definition.versions, sourceVersion] })
  codeMaterialDefinitionsSchema.parse([candidate])
  return { definition: candidate, versionId: sourceVersion.id, program }
}
export async function bindCodeMaterialInstance(definition: CodeMaterialDefinition, versionId: string, parameters: Readonly<Record<string, unknown>>, compile: CodeSourceCompiler): Promise<CodeMaterialInstance> {
  const program = await checkedVersion(definition, versionId, compile)
  return codeMaterialInstanceSchema.parse({ definitionId: definition.id, versionId, parameters: validateCodeMaterialParameters(program, parameters) })
}
export async function changeCodeMaterialInstanceVersion(definition: CodeMaterialDefinition, instance: CodeMaterialInstance, versionId: string, compile: CodeSourceCompiler): Promise<CodeMaterialInstance> {
  if (instance.definitionId !== definition.id) throw new CodeMaterialError('COMPATIBILITY', '代码实例不属于此定义。')
  const old = await checkedVersion(definition, instance.versionId, compile)
  const next = await checkedVersion(definition, versionId, compile)
  prepareCodeMaterialParameters(old, instance)
  const result = codeMaterialInstanceSchema.parse({ ...instance, versionId, parameters: checkCodeMaterialParameterCompatibility(old, next, instance.parameters) })
  prepareCodeMaterialParameters(next, result)
  return result
}
