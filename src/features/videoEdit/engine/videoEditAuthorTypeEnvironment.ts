import webgpu from '@webgpu/types/dist/index.d.ts?raw'
import authorApi from '../../../../resources/video-edit-author/author-api.d.ts?raw'
import { AUTHOR_LIBRARY_TYPES_FILE, authorLibraryUrl } from '@/core/videoEdit/codeMaterial/authorLibraries'
import type { AuthorLibraryTypePackage, AuthorTypeEnvironment } from './videoEditAuthorTypeCheck'

/**
 * 只在源码检查 Worker 里导入：标准库约 1.2MB 文本随 Worker 打包，不进渲染主线程，也不在运行时读磁盘。
 * 选取 es5–esnext 与 webworker 系列（含互相引用的子文件），不含 DOM 与 *.full。
 */
const libs = import.meta.glob<string>([
  '/node_modules/typescript/lib/lib.{es5,es20*,esnext*,webworker*,decorators*}.d.ts',
  '!/node_modules/typescript/lib/lib.*.full.d.ts',
], { query: '?raw', import: 'default', eager: true })

/** 读到的类型包常驻；读失败只记一小段时间，之后的检查重试（产物可能刚生成完）。 */
const libraryTypes = new Map<string, AuthorLibraryTypePackage>()
const failedReads = new Map<string, number>()
const TYPE_READ_TIMEOUT_MS = 5_000
const FAILED_READ_RETRY_MS = 30_000
/**
 * 内置库的类型包随 author-libs 发行（three 约 2MB），只在源码导入了该库时读取。检查器是同步的，
 * 所以在源码检查 Worker 里用带超时的同步请求读本地随包文件；读不到（没有生成产物、不在 Worker 里）时退回 any。
 */
function readLibraryTypes(library: string, version: string): AuthorLibraryTypePackage | undefined {
  const key = `${library}@${version}`
  const known = libraryTypes.get(key)
  if (known) return known
  if (typeof XMLHttpRequest !== 'function' || (failedReads.get(key) ?? -Infinity) > Date.now()) return undefined
  try {
    const request = new XMLHttpRequest()
    request.open('GET', authorLibraryUrl(library, version, AUTHOR_LIBRARY_TYPES_FILE), false)
    request.timeout = TYPE_READ_TIMEOUT_MS
    request.send()
    if (request.status === 200) {
      const types = JSON.parse(request.responseText) as AuthorLibraryTypePackage
      libraryTypes.set(key, types); failedReads.delete(key)
      return types
    }
  } catch { /* 超时、读不到或内容损坏都按读失败处理。 */ }
  failedReads.set(key, Date.now() + FAILED_READ_RETRY_MS)
  return undefined
}

export const AUTHOR_TYPE_ENVIRONMENT: AuthorTypeEnvironment = {
  libs: Object.fromEntries(Object.entries(libs).map(([path, text]) => [path.slice(path.lastIndexOf('/') + 1), text])),
  webgpu,
  authorApi,
  libraryTypes: readLibraryTypes,
}
