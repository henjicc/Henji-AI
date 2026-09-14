import type { ApplicationTransactionResult } from '../transactions'

/** 只允许在首次业务派发前创建；输出校验和执行异常不得使用此标记。 */
export class ApplicationPreflightFailure extends Error {
  constructor(cause: unknown) { super(cause instanceof Error ? cause.message : String(cause)); this.name = 'ApplicationPreflightFailure' }
}

/** 保留引擎确认过的失败事实；适配器不再把 partial / recovery 降成一句文本。 */
export class ApplicationTransactionFailure extends Error {
  constructor(readonly result: Extract<ApplicationTransactionResult, { status: 'failed' }>) {
    super(result.message)
    this.name = 'ApplicationTransactionFailure'
  }
}
