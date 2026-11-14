import type { ApplicationCapabilityInvocation } from '@/core/application-control/applicationCapabilities'
import type { ApplicationCapabilityFailure, ApplicationCapabilityResult } from '@/core/application-control/hostContracts'
import { createLogger } from '@/core/logging'
import { userErrorText } from '@/core/userErrorText'
type Executor = (invocation: ApplicationCapabilityInvocation, context: { signal: AbortSignal; requestId: string }) => Promise<ApplicationCapabilityResult>
let executor: Executor | undefined
const logger = createLogger('features.application_control.ui')
/** The runtime composition root installs the same registry used by Pi/MCP. No dependency back into domain assembly. */
export function registerUiCapabilityExecutor(value: Executor): void { executor = value }
export async function executeUiApplicationCapability(invocation: ApplicationCapabilityInvocation, signal: AbortSignal): Promise<ApplicationCapabilityResult> {
  if (!executor) throw new Error('应用操作尚未就绪，请稍后重试。')
  return executor(invocation, { signal, requestId: crypto.randomUUID() })
}

const UI_FAILURE_TEXT: Partial<Record<ApplicationCapabilityFailure['error']['code'], string>> = {
  CONFLICT: '内容刚在别处被改过，请再试一次。',
  NOT_FOUND: '要修改的内容已经不在了，请刷新后再试。',
  STALE_CONTEXT: '内容刚在别处被改过，请再试一次。',
  ABORTED: '操作已取消。',
}
/**
 * 界面亲手调用正式操作失败时抛出的错误。失败原因是写给助手的（修订号、重新读取的办法、实体引用），
 * 原文只进日志；界面按失败类别给一句用户能照着做的话。
 */
export function uiCapabilityFailureError(failure: ApplicationCapabilityFailure['error']): Error {
  logger.warn('界面调用的应用操作未完成', { event: 'application.ui_capability.failed', context: { code: failure.code, message: failure.message.slice(0, 500) } })
  const reason = failure.message.replace(/^(?:应用事务执行失败。原因：|操作失败：)/, '').replace(/\s*没有任何步骤被提交，应用状态未改变。?$/, '')
  return Object.assign(new Error(UI_FAILURE_TEXT[failure.code] ?? userErrorText(reason, '这一步没能完成，请重试。'), { cause: failure }), { code: failure.code })
}
