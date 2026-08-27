/**
 * 媒体文件上传相关工具（供应商官方上传服务封装）：字段识别、上传策略、上传实现、
 * `data:` URI 解析、MIME 推断（任务 2.4 迁入）。
 */
export {
  buildMediaSourceIndex,
  classifyMediaKey,
  inheritMediaKind,
  isLocalMediaSource,
  isRemoteHttpUrl,
  normalizeLocalSource,
  resolveMediaKind,
  type MediaKind,
  type MediaSourceIndex,
  type ResolvedMediaKind,
} from './media-fields'

// 任务 2.4 迁入：`data:` URI 解析 / MIME 推断 / 缺省文件名，宿主的 `MediaReader`
// 实现（如 Electron 侧 sdk-runtime.ts）复用这里的实现，不再各自维护一份重复拷贝。
export { defaultFilename, inferMimeFromPath, parseDataUri, type ParsedDataUri } from './media-binary'

// 任务 2.4 迁入：媒体上传主入口（识别请求体里的媒体字段、按供应商上传策略上传、回填 URL）。
export { preprocessRequestBody } from './preprocess'

// 任务 2.4 迁入：供应商官方上传服务封装（Fal/APIMart/KIE），以及不依赖 `Buffer` 的
// base64 编解码（UXP/浏览器没有 Node 的 `Buffer`）。
export {
  fromBase64,
  toBase64,
  toDataUri,
  uploadToApiMart,
  uploadToKie,
  type PreparedMediaBinary,
} from './providers'
export { uploadToFal } from './fal-legacy'
export { uploadToFalWithTransport } from './fal-transport'
