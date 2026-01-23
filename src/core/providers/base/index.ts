/**
 * Provider Base 模块统一导出
 *
 * 提供 Provider 系统的核心基础设施
 */

// 抽象基类
export { ProviderHandler } from './ProviderHandler'

// 类型定义
export type {
  GenerateResult,
  ProgressStatus,
  ProviderConfig,
  PollingConfig,
  PreprocessedParams,
  ApiResponse,
  UploadResult,
  SaveMediaOptions,
} from './types'

// 错误处理
export {
  ProviderError,
  ProviderErrorCode,
  createApiKeyMissingError,
  createPollingTimeoutError,
  createInvalidResponseError,
} from './errors'

// 工具函数
export {
  // 文件转换
  dataURItoBlob,
  blobToDataURI,
  blobToBase64,

  // 本地文件处理
  readLocalFile,
  isLocalPath,
  normalizeFilePath,

  // URL 处理
  isDataURI,
  isRemoteURL,
  extractMimeType,
  extractExtension,

  // API 密钥管理
  getApiKey,
  setApiKey,
  getFalApiKey,

  // 辅助函数
  sleep,
  retry,
  formatFileSize,
  generateFilename,
} from './utils'
