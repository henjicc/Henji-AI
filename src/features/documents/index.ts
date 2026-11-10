/*
 * 通用文档会话（存储底座 2.4）的对外入口。接入说明见
 * docs/task/项目体系与数据目录/任务/第二阶段-存储底座/2.4-文档会话与草稿.md。
 */

export {
  getDocumentSessionRegistry,
} from './documentSessionRegistry'
export type * from './documentSessionTypes'

// 通用文档操作与项目页通用数据源（存储底座 2.5）
export {
  getDocumentOperations,
  registerDocumentOpener,
  registerDocumentBusyCheck,
} from './documentOperations'
export { documentKindPresentation } from './documentKindPresentation'
export { registerDocumentCoverProvider, invalidateDocumentHoverRead } from './documentCovers'
export { defaultDocumentOperationChanges, markSessionDocumentOpened } from './documentOperationChanges'

export { currentDocumentContext, registerCurrentDocumentProvider } from './currentDocumentContext'
