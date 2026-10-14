import type { ApplicationCapabilityInvocation } from '@/core/application-control/applicationCapabilities'
import type { ApplicationCapabilityResult } from '@/core/application-control/hostContracts'
type Executor = (invocation: ApplicationCapabilityInvocation, context: { signal: AbortSignal; requestId: string }) => Promise<ApplicationCapabilityResult>
let executor: Executor | undefined
/** The runtime composition root installs the same registry used by Pi/MCP. No dependency back into domain assembly. */
export function registerUiCapabilityExecutor(value: Executor): void { executor = value }
export async function executeUiApplicationCapability(invocation: ApplicationCapabilityInvocation, signal: AbortSignal): Promise<ApplicationCapabilityResult> {
  if (!executor) throw new Error('应用操作尚未就绪，请稍后重试。')
  return executor(invocation, { signal, requestId: crypto.randomUUID() })
}
