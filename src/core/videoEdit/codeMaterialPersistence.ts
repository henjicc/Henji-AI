import { codeLocationSchema } from '../storage/gitCodeLocation'
import { z } from 'zod'
import { codeFilePathSchema, codeSourceHashSchema, codeComponentPinsSchema } from './codeMaterial/sources'
import { codeMaterialCurvesSchema } from './codeMaterialAnimation'
import { codeMaterialParameterKeySchema, codeMaterialParameterValueSchema } from './codeMaterial/parameterValueSchema'
export { codeMaterialImageReferenceSchema } from './codeMaterial/parameterValueSchema'

const id = z.string().min(1).max(100)
/** 作者宿主接口版本：4 = 标准 ES 模块（Canvas2D/layers/WebGL/WebGPU）。接口变化时递增，并按版本保持旧代码原行为。 */
export const CODE_AUTHOR_API_VERSION = 4
/** 第一个作者 JS 接口；更早的作者语言已退役，不再执行。 */
export const CODE_AUTHOR_API_MIN_VERSION = 4
export const codeAuthorApiVersionSchema = z.number().int().min(CODE_AUTHOR_API_MIN_VERSION).max(CODE_AUTHOR_API_VERSION)
export const codeAuthorApiSchema = z.object({ apiVersion: codeAuthorApiVersionSchema }).strict()
/** 代码版本记录的结构版本；记录嵌在剪辑内容里，随剪辑文档版本读写。 */
export const CODE_MATERIAL_VERSION_RECORD = 2
export const codeMaterialVersionSchema = z.object({ id, apiVersion: codeAuthorApiVersionSchema, languageVersion: z.literal(4), entry: codeFilePathSchema, files: z.array(z.object({ path: codeFilePathSchema, location: codeLocationSchema, hash: codeSourceHashSchema }).strict()).min(1), imports: codeComponentPinsSchema.optional(), assetOrigin: z.object({ assetId: id, contentIdentity: z.string().regex(/^[a-f0-9]{64}$/) }).strict().optional() }).strict().superRefine((value, context) => {
  if (new Set(value.files.map(file => file.path)).size !== value.files.length || !value.files.some(file => file.path === value.entry)) context.addIssue({ code: 'custom', message: '版本文件重复或入口不存在。' })
})
export const codeMaterialDefinitionSchema = z.object({ id, name: z.string().trim().min(1).max(200), folder: z.string().min(1).optional(), defaultVersionId: id, versions: z.array(codeMaterialVersionSchema).min(1) }).strict().superRefine((value, context) => {
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
