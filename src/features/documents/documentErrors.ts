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
