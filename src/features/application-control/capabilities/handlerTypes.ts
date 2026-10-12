import type { ApplicationControlExecutionEngine } from '@/core/application-control'
import type { ApplicationCallerGrant } from '@/core/application-control/callerContext'
import type { ApplicationWriteExecution } from '@/core/application-control/execution/writeExecution'

export interface CapabilityExecutionContext {
  /** 写能力由唯一注册器注入；只读调用与直接领域测试不携带。 */
  execution?: ApplicationWriteExecution
  /** 装配层注入同一事务引擎，领域适配器不回引组合根。 */
  getExecutionEngine?: () => ApplicationControlExecutionEngine
  /** 可信宿主注入；工具输入不能覆盖。缺省仅供保留的旧助手适配器。 */
  callerGrant?: ApplicationCallerGrant
  signal: AbortSignal
  requestId?: string
  taskId?: string
  /** Gateway 信封中的权威并发基线；业务输入里的兼容字段不能覆盖它。 */
  expectedRevisions?: Record<string, number>
}

export type CapabilityHandler = (
  input: unknown,
  context: CapabilityExecutionContext
) => Promise<Record<string, unknown>> | Record<string, unknown>

export interface ApplicationCapabilityHandlerRegistrar {
  registerHandler(id: string, handler: CapabilityHandler): void
}
