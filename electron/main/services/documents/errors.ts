/*
 * 文档底座的错误类型。IPC 只把 name 与 message 传回渲染层，渲染层按 name 区分处理
 * （如 DocumentRevisionConflictError → 提示“重新载入 / 覆盖”，DocumentNameConflictError → 提示重名）。
 */

export { DocumentFormatError } from '../../../../src/core/documents/envelope'

export class DocumentNotFoundError extends Error {
  constructor(readonly documentId: string) {
    super('找不到这份文档，它可能已被移动、改名或删除。')
    this.name = 'DocumentNotFoundError'
  }
}

export class DocumentRevisionConflictError extends Error {
  constructor(
    readonly documentId: string,
    readonly expectedRevision: number,
    readonly actualRevision: number,
  ) {
    super(`文档已在别处被修改（期望版本 ${expectedRevision}，实际版本 ${actualRevision}），请重新载入或选择覆盖。`)
    this.name = 'DocumentRevisionConflictError'
  }
}

export class DocumentNameConflictError extends Error {
  constructor(readonly existingPath: string) {
    super('同一位置已有同名的文件或文件夹，请换一个名称。')
    this.name = 'DocumentNameConflictError'
  }
}

export class DocumentNameInvalidError extends Error {
  constructor(readonly reason: string, message: string) {
    super(message)
    this.name = 'DocumentNameInvalidError'
  }
}

export class DocumentLocationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DocumentLocationError'
  }
}

export class DocumentNotEmptyError extends Error {
  constructor(message = '这份文档不是空草稿，不能直接删除；请移到回收站。') {
    super(message)
    this.name = 'DocumentNotEmptyError'
  }
}

export class DocumentUnsupportedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DocumentUnsupportedError'
  }
}

export class ProjectNotFoundError extends Error {
  constructor(readonly projectId: string) {
    super('找不到这个项目，它可能已被移动、改名或删除。')
    this.name = 'ProjectNotFoundError'
  }
}

export class FileInUseError extends Error {
  constructor(message = '文件正在被使用（预览、导出或其他程序），请关闭后重试。', options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'FileInUseError'
  }
}

export function errorCode(error: unknown): string | undefined {
  return error instanceof Error && 'code' in error ? String((error as NodeJS.ErrnoException).code) : undefined
}

export function isInUseError(error: unknown): boolean {
  const code = errorCode(error)
  return code === 'EBUSY' || code === 'EPERM' || code === 'EACCES'
}
