import type { ApplicationControlExecutionEngine, ApplicationEntityRegistration } from '@/core/application-control'
import type { ApplicationPersistenceResolver } from '@/core/application-control/execution/persistence'
import type { ApplicationCapabilityHandlerRegistrar } from './capabilities/handlerTypes'
import type { ApplicationCapabilityFailure } from '@/core/application-control/hostContracts'
import type { LocalHostRequest } from '@/core/application-control/localHostContracts'
import type { ApplicationExecutionContext } from '@/core/application-control/execution/types'

/** 领域拥有反射、执行器与能力入口；装配层只组合完整模块。 */
export interface ApplicationDomainModule {
  readonly id: string
  entities(): ApplicationEntityRegistration[]
  registerExecutors(engine: ApplicationControlExecutionEngine): void
  registerCapabilities(registrar: ApplicationCapabilityHandlerRegistrar): void
  resolvePersistenceParticipants?: ApplicationPersistenceResolver
  validate?(): void
  failure?(error: unknown, normalize: (error: unknown) => ApplicationCapabilityFailure): ApplicationCapabilityFailure | undefined
  /** 新宿主按领域持久事实核对原操作，不派发修改或付费任务。 */
  recoverOperation?(request: NonNullable<LocalHostRequest['recoveryOperation']>, context: ApplicationExecutionContext): Promise<Record<string, unknown> | undefined>
}
