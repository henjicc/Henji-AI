/**
 * 媒体文件上传相关工具（供应商官方上传服务封装）：字段识别、上传策略、上传实现、
 * `data:` URI 解析与 MIME 推断供宿主共享，避免重复实现媒体判定。
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

// 宿主的 MediaReader 共用解析规则，确保上传与本地读取的媒体类型一致。
export { defaultFilename, inferMimeFromPath, parseDataUri, type ParsedDataUri } from './media-binary'

export { preprocessRequestBody } from './preprocess'

// UXP 与浏览器没有 Node Buffer，公共上传工具只依赖可移植的二进制契约。
export {
  fromBase64,
  toBase64,
  toDataUri,
  uploadToApiMart,
  uploadToKie,
  type PreparedMediaBinary,
} from './providers'
export { uploadToFal } from './fal-host-fetch'
export { uploadToFalWithTransport } from './fal-transport'
