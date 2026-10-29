import { foreignContentSchema } from '../contentTrust'
import { codeLocationSchema } from '../storage/gitCodeLocation'
import { z } from 'zod'
import { codeFilePathSchema, codeSourceHashSchema, codeComponentPinsSchema } from './codeMaterial/sources'
import { codeMaterialCurvesSchema } from './codeMaterialAnimation'
import { codeMaterialParameterKeySchema, codeMaterialParameterValueSchema } from './codeMaterial/parameterValueSchema'
import { authorLibraryCompatibilityError } from './codeMaterial/authorLibraries'
export { codeMaterialImageReferenceSchema } from './codeMaterial/parameterValueSchema'

const id = z.string().min(1).max(100)
/**
 * 作者宿主接口版本：4 = 标准 ES 模块（Canvas2D/layers/WebGL/WebGPU）；5 = 片子数据参数与内置库；6 = 冻结发行的文字与 flex 排版库。
 * 接口变化时递增，并按版本保持旧代码原行为。
 */
export const CODE_AUTHOR_API_VERSION = 6
/** 第一个作者 JS 接口；更早的作者语言已退役，不再执行。 */
export const CODE_AUTHOR_API_MIN_VERSION = 4
export const codeAuthorApiVersionSchema = z.number().int().min(CODE_AUTHOR_API_MIN_VERSION).max(CODE_AUTHOR_API_VERSION)
export const codeAuthorApiSchema = z.object({ apiVersion: codeAuthorApiVersionSchema }).strict()
/** 内置库从这一版作者接口起可用。 */
export const CODE_AUTHOR_LIBRARIES_MIN_API_VERSION = 5
/**
 * 代码版本用到的内置第三方库：npm 包名 → 精确版本，例如 { three: '0.186.1' }。随应用发行、多个效果共用一份。
 * 没有这一项的版本按第一套内置库运行。空对象与省略是同一个意思，读写时一律规范成省略。
 */
export const codeAuthorLibrariesSchema = z.record(
  z.string().max(214).regex(/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/, '内置库名须是 npm 包名。'),
  z.string().max(64).regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, '内置库版本须是精确版本号，例如 0.186.1。'),
).refine(value => Object.keys(value).length <= 32, '一个代码版本最多用 32 个内置库。')
const optionalCodeAuthorLibrariesSchema = codeAuthorLibrariesSchema.optional().overwrite(value => value && Object.keys(value).length ? value : undefined)
/** 代码版本记录的结构版本；记录嵌在剪辑内容里，随剪辑文档版本读写。 */
export const CODE_MATERIAL_VERSION_RECORD = 7
export const codeMaterialVersionSchema = z.object({ id, foreign: foreignContentSchema.optional(), apiVersion: codeAuthorApiVersionSchema, languageVersion: z.literal(4), project: z.object({ commit: z.string().regex(/^[a-f0-9]{40}$/), entry: codeFilePathSchema }).strict().optional(), entry: codeFilePathSchema, files: z.array(z.object({ path: codeFilePathSchema, location: codeLocationSchema, hash: codeSourceHashSchema }).strict()).min(1), imports: codeComponentPinsSchema.optional(), libraries: optionalCodeAuthorLibrariesSchema, assetOrigin: z.object({ assetId: id, contentIdentity: z.string().regex(/^[a-f0-9]{64}$/) }).strict().optional() }).strict().superRefine((value, context) => {
  if (new Set(value.files.map(file => file.path)).size !== value.files.length || !value.files.some(file => file.path === value.entry)) context.addIssue({ code: 'custom', message: '版本文件重复或入口不存在。' })
  if (value.libraries && value.apiVersion < CODE_AUTHOR_LIBRARIES_MIN_API_VERSION) context.addIssue({ code: 'custom', message: `内置库从作者接口 v${CODE_AUTHOR_LIBRARIES_MIN_API_VERSION} 起可用。` })
  for (const [library, version] of Object.entries(value.libraries ?? {})) {
    const message = authorLibraryCompatibilityError(library, version, value.apiVersion)
    if (message) context.addIssue({ code: 'custom', message, path: ['libraries', library] })
  }
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
