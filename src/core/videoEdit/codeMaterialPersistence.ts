import { z } from 'zod'
import { CODE_MATERIAL_LIMITS } from './codeMaterial/contract'
import { codeMaterialCurvesSchema } from './codeMaterialAnimation'

const id = z.string().min(1).max(100)
export const codeMaterialVersionSchema = z.object({ id, apiVersion: z.literal(1), languageVersion: z.union([z.literal(1), z.literal(2)]), source: z.string().max(CODE_MATERIAL_LIMITS.sourceBytes), assetOrigin: z.object({ assetId: id, contentIdentity: z.string().regex(/^[a-f0-9]{64}$/) }).strict().optional() }).strict()
export const codeMaterialDefinitionSchema = z.object({ id, name: z.string().trim().min(1).max(200), defaultVersionId: id, versions: z.array(codeMaterialVersionSchema).min(1).max(64) }).strict().superRefine((value, context) => {
  if (new Set(value.versions.map(version => version.id)).size !== value.versions.length || !value.versions.some(version => version.id === value.defaultVersionId)) context.addIssue({ code: 'custom', message: '代码版本重复或默认版本不存在。' })
})
export const codeMaterialDefinitionsSchema = z.array(codeMaterialDefinitionSchema).max(64).superRefine((definitions, context) => {
  const ids = new Set<string>(); let total = 0
  for (const definition of definitions) {
    if (ids.has(definition.id)) context.addIssue({ code: 'custom', message: '代码定义标识重复。' })
    ids.add(definition.id)
    for (const version of definition.versions) {
      const bytes = new TextEncoder().encode(version.source).byteLength; total += bytes
      if (bytes > CODE_MATERIAL_LIMITS.sourceBytes) context.addIssue({ code: 'custom', message: '单个代码源码最多64KiB。' })
      if (total > 8 * 1024 ** 2) { context.addIssue({ code: 'custom', message: '剪辑代码源码总量最多8MiB。' }); return }
    }
  }
})
export const codeMaterialImageReferenceSchema = z.object({ kind: z.literal('image'), mediaId: id }).strict()
const parameter = z.union([z.number().finite(), z.boolean(), z.string().max(4096), z.tuple([z.number().min(0).max(1), z.number().min(0).max(1), z.number().min(0).max(1), z.number().min(0).max(1)]), codeMaterialImageReferenceSchema, z.null()])
export const codeMaterialInstanceSchema = z.object({ definitionId: id, versionId: id, parameters: z.record(z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/), parameter).refine(value => Object.keys(value).length <= 32, '代码参数最多32个。'), curves: codeMaterialCurvesSchema.optional() }).strict()
export type CodeMaterialVersion = z.infer<typeof codeMaterialVersionSchema>
export type CodeMaterialDefinition = z.infer<typeof codeMaterialDefinitionSchema>
export type CodeMaterialInstance = z.infer<typeof codeMaterialInstanceSchema>
