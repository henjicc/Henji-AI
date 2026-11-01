import type { CodeAuthorApiVersion } from '../codeAuthorProgram'
import { AUTHOR_LIBRARIES, authorLibraryCompatibilityError, latestAuthorLibraryVersions, type AuthorLibraryVersions } from './authorLibraries'
import { CODE_AUTHOR_API_MIN_VERSION, CODE_AUTHOR_API_VERSION } from '../codeMaterialPersistence'
import { importedAuthorLibraries } from './libraryImports'
import type { CodeMaterialFiles } from './sources'

/**
 * 未记录版本的样片与库模板固定使用发布时快照；不能随新增冻结版漂移。
 * 取文字新版合入前的预览行为：当时按作者接口 9（含调整层）与各库最新版编译未标记样片。
 */
export const HISTORICAL_PREVIEW_AUTHOR = Object.freeze({
  apiVersion: 9 as const,
  libraries: Object.freeze({ 'henji-layout': '1.2.0', 'henji-effects': '1.3.0', three: '0.186.1', 'opentype.js': '2.0.0' }),
})
export interface AuthorVersionPin { apiVersion?: number; libraries?: AuthorLibraryVersions }
export function resolvePreviewAuthor(pin: AuthorVersionPin = {}): { apiVersion: CodeAuthorApiVersion; libraries: AuthorLibraryVersions } {
  const apiVersion = pin.apiVersion ?? HISTORICAL_PREVIEW_AUTHOR.apiVersion
  if (!Number.isInteger(apiVersion) || apiVersion < CODE_AUTHOR_API_MIN_VERSION || apiVersion > CODE_AUTHOR_API_VERSION) throw new Error(`不支持作者接口 ${apiVersion}`)
  const libraries = { ...(pin.apiVersion === undefined ? HISTORICAL_PREVIEW_AUTHOR.libraries : latestAuthorLibraryVersions(apiVersion)), ...pin.libraries }
  for (const [library, version] of Object.entries(pin.libraries ?? {})) {
    if (!AUTHOR_LIBRARIES[library]?.[version]) throw new Error(`未提供内置库 ${library}@${version}`)
    const error = authorLibraryCompatibilityError(library, version, apiVersion)
    if (error) throw new Error(error)
  }
  return { apiVersion: apiVersion as CodeAuthorApiVersion, libraries }
}
/**
 * 补齐等价历史字段不改变既有样片摘要；实际换引擎才加入版本身份。
 * 只计入源码实际导入的库：以后发行兼容的新库版本不能让没用到它的样片被判为需要重渲。
 */
export function previewAuthorIdentity(code: CodeMaterialFiles, pin: AuthorVersionPin): AuthorVersionPin | undefined {
  const resolved = resolvePreviewAuthor(pin)
  let libraries: AuthorLibraryVersions
  try { libraries = importedAuthorLibraries({ ...code, libraries: resolved.libraries }) }
  catch { libraries = pin.libraries ?? {} } // 源码解析失败时保留已记录的固定版本，摘要仍可计算。
  if (resolved.apiVersion === HISTORICAL_PREVIEW_AUTHOR.apiVersion && Object.entries(libraries).every(([key, value]) => HISTORICAL_PREVIEW_AUTHOR.libraries[key as keyof typeof HISTORICAL_PREVIEW_AUTHOR.libraries] === value)) return undefined
  return { apiVersion: resolved.apiVersion, libraries }
}
export function pinPreviewAuthor(code: CodeMaterialFiles, pin: AuthorVersionPin = {}): { apiVersion: CodeAuthorApiVersion; libraries: AuthorLibraryVersions } {
  const resolved = resolvePreviewAuthor({ ...pin, apiVersion: pin.apiVersion ?? CODE_AUTHOR_API_VERSION })
  const libraries = importedAuthorLibraries({ ...code, ...resolved })
  for (const [name, version] of Object.entries(libraries)) {
    const error = authorLibraryCompatibilityError(name, version, resolved.apiVersion)
    if (error) throw new Error(error)
  }
  return { apiVersion: resolved.apiVersion, libraries }
}
