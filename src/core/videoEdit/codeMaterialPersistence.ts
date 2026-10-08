import { z } from 'zod'
import { codeFilePathSchema, codeSourceHashSchema } from './codeMaterial/sources'
import { codeMaterialCurvesSchema } from './codeMaterialAnimation'
import { codeMaterialParameterKeySchema, codeMaterialParameterValueSchema } from './codeMaterial/parameterValueSchema'
export { codeMaterialImageReferenceSchema } from './codeMaterial/parameterValueSchema'

const id = z.string().min(1).max(100)
export const codeMaterialVersionSchema = z.object({ id, apiVersion: z.literal(1), languageVersion: z.union([z.literal(1), z.literal(2), z.literal(3)]), entry: codeFilePathSchema, files: z.array(z.object({ path: codeFilePathSchema, hash: codeSourceHashSchema }).strict()).min(1), assetOrigin: z.object({ assetId: id, contentIdentity: z.string().regex(/^[a-f0-9]{64}$/) }).strict().optional() }).strict().superRefine((value, context) => {
  if (new Set(value.files.map(file => file.path)).size !== value.files.length || !value.files.some(file => file.path === value.entry)) context.addIssue({ code: 'custom', message: '版本文件重复或入口不存在。' })
  if (value.languageVersion !== 3 && (value.entry !== 'main.ts' || value.files.length !== 1)) context.addIssue({ code: 'custom', message: 'v1/v2 只能使用单文件 main.ts。' })
})
export const codeMaterialDefinitionSchema = z.object({ id, name: z.string().trim().min(1).max(200), defaultVersionId: id, versions: z.array(codeMaterialVersionSchema).min(1) }).strict().superRefine((value, context) => {
  if (new Set(value.versions.map(version => version.id)).size !== value.versions.length || !value.versions.some(version => version.id === value.defaultVersionId)) context.addIssue({ code: 'custom', message: '代码版本重复或默认版本不存在。' })
})
export const codeMaterialDefinitionsSchema = z.array(codeMaterialDefinitionSchema).superRefine((definitions, context) => {
  const ids = new Set<string>()
  for (const definition of definitions) {
    if (ids.has(definition.id)) context.addIssue({ code: 'custom', message: '代码定义标识重复。' })
    ids.add(definition.id)

  }
})
export const codeMaterialInstanceSchema = z.object({ definitionId: id, versionId: id, parameters: z.record(codeMaterialParameterKeySchema, codeMaterialParameterValueSchema), curves: codeMaterialCurvesSchema.optional() }).strict()
export type CodeMaterialVersion = z.infer<typeof codeMaterialVersionSchema>
export type CodeMaterialDefinition = z.infer<typeof codeMaterialDefinitionSchema>
export type CodeMaterialInstance = z.infer<typeof codeMaterialInstanceSchema>
