import type { ApplicationTransactionResult } from '../transactions'

/** 保留引擎确认过的失败事实；适配器不再把 partial / recovery 降成一句文本。 */
export class ApplicationTransactionFailure extends Error {
  constructor(readonly result: Extract<ApplicationTransactionResult, { status: 'failed' }>) {
    super(result.message)
    this.name = 'ApplicationTransactionFailure'
  }
}
