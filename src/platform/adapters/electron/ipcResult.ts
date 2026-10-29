import type { HenjiIpcResultEnvelope } from '../../../../electron/preload/api-assistant'
import { readPaidFailureFacts } from '../../../core/application-control/paidApproval'
import { restoreContentTrustError } from '../../../core/contentTrust'

/** 在普通值完成跨桥之后恢复错误，费用事实只取共享 DTO 允许的字段。 */
export function unwrapIpcResult<T>(reply: HenjiIpcResultEnvelope<T>): T {
  if (reply.ok) return reply.data
  throw restoreContentTrustError(Object.assign(new Error(reply.error.message), {
    name: reply.error.name,
    code: reply.error.code,
    paidFailureFacts: readPaidFailureFacts(reply.error),
  }), reply.error.contentTrust)
}
