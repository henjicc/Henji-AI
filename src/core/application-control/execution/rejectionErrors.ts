/*
 * 写入前的拒绝错误：这些类型名是领域服务对执行层的约定——只在“还没有写入任何东西”时抛出
 * （位置不合法、重名、文档或项目不存在、类型不支持、格式读不懂、读到的版本已变化）。
 * 写执行层据此把失败判为“没有执行”，调用方修正后可直接重试，不必请用户核对。
 *
 * 只按错误类型名判断，不看错误文案；新增类型前先确认它的每个抛出点都在第一次写入之前。
 * 主进程定义见 electron/main/services/documents/errors.ts（IPC 只传 name 与 message，name 原样保留）。
 */
export const REJECTED_BEFORE_WRITE_ERROR_NAMES: ReadonlySet<string> = new Set([
  'DocumentLocationError',
  'DocumentNameConflictError',
  'DocumentNameInvalidError',
  'DocumentNotFoundError',
  'ProjectNotFoundError',
  'DocumentUnsupportedError',
  'DocumentNotEmptyError',
  'DocumentRevisionConflictError',
  'DocumentFormatError',
  'DocumentKindError',
  'DocumentNotOpenableError',
])

/** 错误本身或它包着的原因（cause 链）是写入前的拒绝。处理器加了改道说明再抛出时，用 cause 保留原错误。 */
export function isRejectedBeforeWrite(error: unknown): boolean {
  for (let current = error, depth = 0; current instanceof Error && depth < 8; current = current.cause, depth += 1) {
    if (REJECTED_BEFORE_WRITE_ERROR_NAMES.has(current.name)) return true
  }
  return false
}
