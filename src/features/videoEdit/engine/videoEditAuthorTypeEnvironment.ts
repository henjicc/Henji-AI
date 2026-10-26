import webgpu from '@webgpu/types/dist/index.d.ts?raw'
import authorApi from '../../../../resources/video-edit-author/author-api.d.ts?raw'
import type { AuthorTypeEnvironment } from './videoEditAuthorTypeCheck'

/**
 * 只在源码检查 Worker 里导入：标准库约 1.2MB 文本随 Worker 打包，不进渲染主线程，也不在运行时读磁盘。
 * 选取 es5–esnext 与 webworker 系列（含互相引用的子文件），不含 DOM 与 *.full。
 */
const libs = import.meta.glob<string>([
  '/node_modules/typescript/lib/lib.{es5,es20*,esnext*,webworker*,decorators*}.d.ts',
  '!/node_modules/typescript/lib/lib.*.full.d.ts',
], { query: '?raw', import: 'default', eager: true })

export const AUTHOR_TYPE_ENVIRONMENT: AuthorTypeEnvironment = {
  libs: Object.fromEntries(Object.entries(libs).map(([path, text]) => [path.slice(path.lastIndexOf('/') + 1), text])),
  webgpu,
  authorApi,
}
