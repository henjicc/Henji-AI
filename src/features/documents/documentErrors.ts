/*
 * 文档会话的错误。主进程文档仓库的错误跨 IPC 后只保留 name，这里按 name 判断（见 2.2 任务记录的错误名列表）。
 */

export type DocumentServiceErrorName =
  | 'DocumentNotFoundError'
  | 'DocumentRevisionConflictError'
  | 'DocumentNameConflictError'
  | 'DocumentNameInvalidError'
  | 'DocumentLocationError'
  | 'DocumentNotEmptyError'
  | 'DocumentFormatError'
  | 'DocumentUnsupportedError'
  | 'ProjectNotFoundError'
  | 'FileInUseError'

export function isDocumentServiceError(error: unknown, name: DocumentServiceErrorName): boolean {
  return error instanceof Error && error.name === name
}

/** 文档处于冲突状态、用户暂未选择“重新载入 / 覆盖”时，保存与关闭以此失败。 */
/** 助手事务撞上别处写入的新版本、已按磁盘重新载入时的回执原因（见 DocumentSession.flushOrReloadOnConflict）。 */
export const DOCUMENT_CHANGED_ELSEWHERE_RELOADED = (subject: string): string =>
  `${subject}在别处被改过（例如命令行助手或另一个实例），已按磁盘上的最新版本重新载入：这次在它上面的修改没有生效，也没有覆盖别处的修改（同一次提交里其他文档的修改可能已保存，以读回为准）。请重新读取后按最新内容再改。`

export class DocumentSessionConflictError extends Error {
  constructor(documentName: string) {
    super(`“${documentName}”已在别处被修改，请选择重新载入或覆盖后再继续。`)
    this.name = 'DocumentSessionConflictError'
  }
}

export class DocumentSessionClosedError extends Error {
  constructor() {
    super('文档已关闭。')
    this.name = 'DocumentSessionClosedError'
  }
}

/** 单文件包类型需要调用方提供保存策略（3.5 实现）。 */
export class DocumentSessionUnsupportedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DocumentSessionUnsupportedError'
  }
}

/** 有修改持续写入、始终没能写到一致状态（关闭屏障用）。 */
export class DocumentSessionBusyError extends Error {
  constructor(documentName: string) {
    super(`“${documentName}”仍在修改中，请稍后再试。`)
    this.name = 'DocumentSessionBusyError'
  }
}

export function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}
