/*
 * 通用文档会话（存储底座 2.4）的对外入口。接入说明见
 * docs/task/项目体系与数据目录/任务/第二阶段-存储底座/2.4-文档会话与草稿.md。
 */

export { DocumentSession, DEFAULT_DOCUMENT_SESSION_TIMING, type DocumentSessionTiming } from './documentSession'
export {
  DocumentSessionRegistry,
  getDocumentSessionRegistry,
  parentFolderOf,
  type DocumentSessionRegistryOptions,
  type LeaveProjectRequest,
  type LeftoverDraftQuery,
  type OpenDocumentOptions,
} from './documentSessionRegistry'
export { createJsonDocumentPersistence, resolveDocumentPersistence } from './documentPersistence'
export {
  DocumentSessionBusyError,
  DocumentSessionClosedError,
  DocumentSessionConflictError,
  DocumentSessionUnsupportedError,
  isDocumentServiceError,
  type DocumentServiceErrorName,
} from './documentErrors'
export type * from './documentSessionTypes'
export { useDocumentSessionState } from './useDocumentSessionState'
export { DocumentSessionDialogs } from './DocumentSessionDialogs'
export { DocumentDraftRecoveryNotice, type DocumentDraftRecoveryNoticeProps } from './DocumentDraftRecoveryNotice'

// 通用文档操作与项目页通用数据源（存储底座 2.5）
export {
  DocumentOperations,
  DocumentInUseError,
  DocumentNotOpenableError,
  DocumentStandaloneNotAllowedError,
  ProjectInUseError,
  getDocumentOperations,
  isDocumentNameConflict,
  registerDocumentOpener,
  registerDocumentReleaser,
  type CreateNamedDocumentRequest,
  type DocumentOpener,
  type DocumentReleaser,
  type DocumentOperationCommands,
  type DocumentOperationsOptions,
} from './documentOperations'
export { documentKindPresentation, type DocumentKindPresentation } from './documentKindPresentation'
export {
  ALL_DOCUMENTS_FILTER,
  documentLibraryFilterToContainer,
  toDocumentCardItems,
  toProjectCardItems,
  useDocumentLibrary,
  useProjectLibrary,
  type DocumentCardItem,
  type DocumentLibraryFilter,
  type DocumentLibraryState,
  type ProjectCardItem,
  type ProjectLibraryState,
} from './useDocumentLibrary'
export { DocumentLibraryPage, type DocumentLibraryPageProps } from './DocumentLibraryPage'
export { MoveToProjectDialog, type MoveToProjectChoice } from './MoveToProjectDialog'
