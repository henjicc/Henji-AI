import type {
  ApplicationChangePlan,
  ApplicationCommitRequest,
  ApplicationEvidence,
  ApplicationPlannedStep,
  ApplicationPropertyMutation,
  ApplicationTransactionMode,
  ApplicationTransactionResult,
  ApplicationUndoRequest,
  ApplicationVerificationCondition,
  ApplicationVerificationResult,
} from '../transactions'
import type { ApplicationControlAccessContext } from '../registry'
import type { ApplicationRef, JsonValue } from '../identifiers'
import type { ApplicationMutationOperation } from './writerTable'

export type ApplicationRisk = 'R0' | 'R1' | 'R2' | 'R3' | 'R4'

export interface ApplicationPlanRequest {
  summary: string
  transactionMode: ApplicationTransactionMode
  steps: ApplicationPlannedStep[]
  verificationConditions?: ApplicationVerificationCondition[]
  expiresInMs?: number
}

export interface ApplicationExecutionContext extends ApplicationControlAccessContext {
  requestId: string
  signal?: AbortSignal
}

export interface ApplicationCompletedStepResult {
  status: 'completed'
  resultingRevisions: Record<string, number>
  producedRefs: ApplicationRef[]
  evidence: ApplicationEvidence[]
  undoToken?: string
}

export interface ApplicationSubmittedStepResult {
  status: 'submitted'
  taskRef: ApplicationRef
  resultingRevisions: Record<string, number>
}

export interface ApplicationWaitingUserStepResult {
  status: 'waiting_user'
  reason: string
  resumeRef: string
}

export type ApplicationStepExecutionResult =
  | ApplicationCompletedStepResult
  | ApplicationSubmittedStepResult
  | ApplicationWaitingUserStepResult

export interface ApplicationMutationExecutor {
  readonly entityType: string
  /**
   * 这个执行器**真的能写**的属性 id 全集。必须由写入表派生（`writableProperties(TABLE)`），
   * 不许手写字面量——手写就等于又开了一条会漂移的路。
   *
   * 门禁拿它与反射层「无 readOnlyReason 且有写权限」的属性集做双向比对：
   * 少了 → 声明可写却写不了（`camera_stage.shot.time` 就是这么漏掉的，实体级门禁看不见）；
   * 多了 → 执行器能写但模型看不见，是死代码。
   *
   * 设计成**必填字段**而非可选方法：可选就是复刻同一个盲区，没声明的照旧静默；
   * 字段而非方法，是因为门禁要在不执行任何事务的前提下读到它。
   * 允许用 getter 实现——设置项的可写集合是运行期从注册表算出来的。
   */
  readonly writableProperties: ReadonlySet<string>
  /**
   * 每条可写属性接受的 operation。反射层据此告诉模型该用 set 还是 append/remove，不必试错。
   */
  readonly propertyOperations: ReadonlyMap<string, ReadonlySet<ApplicationMutationOperation>>
  apply(
    step: Extract<ApplicationPlannedStep, { kind: 'mutation' }>,
    context: ApplicationExecutionContext
  ): Promise<ApplicationCompletedStepResult>
  applyAtomic?(
    steps: Array<Extract<ApplicationPlannedStep, { kind: 'mutation' }>>,
    context: ApplicationExecutionContext
  ): Promise<ApplicationCompletedStepResult[]>
  compensate?(
    step: Extract<ApplicationPlannedStep, { kind: 'mutation' }>,
    result: ApplicationCompletedStepResult,
    context: ApplicationExecutionContext
  ): Promise<ApplicationEvidence[]>
  undo?(
    undoToken: string,
    context: ApplicationExecutionContext
  ): Promise<ApplicationCompletedStepResult>
}

/**
 * 集合写入执行器：负责在父实体下新建或删除子实体。
 *
 * 与 `ApplicationMutationExecutor` 平行——一个管"改已有的"，一个管"增删成员"。领域只要实现
 * 它，助手就能在不写任何专门能力的前提下创建实例。
 */
export interface ApplicationCollectionExecutor {
  readonly entityType: string
  apply(
    step: Extract<ApplicationPlannedStep, { kind: 'collection' }>,
    context: ApplicationExecutionContext
  ): Promise<ApplicationCompletedStepResult>
  compensate?(
    step: Extract<ApplicationPlannedStep, { kind: 'collection' }>,
    result: ApplicationCompletedStepResult,
    context: ApplicationExecutionContext
  ): Promise<ApplicationEvidence[]>
  undo?(
    undoToken: string,
    context: ApplicationExecutionContext
  ): Promise<ApplicationCompletedStepResult>
}

export interface ApplicationSemanticOperationExecutor {
  readonly capabilityId: string
  readonly capabilityVersion: number
  readonly risk: ApplicationRisk
  readonly requiredPermissions: string[]
  readonly supportsAtomic: boolean
  normalizeInput(input: JsonValue): JsonValue
  getCurrentRevisions(input: JsonValue): Promise<Record<string, number>>
  execute(input: JsonValue, context: ApplicationExecutionContext): Promise<ApplicationStepExecutionResult>
  compensate?(
    input: JsonValue,
    result: ApplicationCompletedStepResult,
    context: ApplicationExecutionContext
  ): Promise<ApplicationEvidence[]>
  undo?(
    undoToken: string,
    context: ApplicationExecutionContext
  ): Promise<ApplicationCompletedStepResult>
}

export interface ApplicationCustomVerifier {
  readonly id: string
  verify(
    input: JsonValue,
    context: ApplicationExecutionContext
  ): Promise<ApplicationVerificationResult>
}

export interface ApplicationControlExecutionDependencies {
  now?: () => Date
  createOpaqueRef?: (kind: 'plan' | 'transaction' | 'undo') => string
  maxPlans?: number
  maxIdempotencyResults?: number
}

export interface ApplicationControlExecutionApi {
  plan(request: ApplicationPlanRequest, context: ApplicationExecutionContext): Promise<ApplicationChangePlan>
  commit(request: ApplicationCommitRequest, context: ApplicationExecutionContext): Promise<ApplicationTransactionResult>
  undo(request: ApplicationUndoRequest, context: ApplicationExecutionContext): Promise<ApplicationTransactionResult>
}

export interface PreparedMutationValue {
  mutation: ApplicationPropertyMutation
  resultingValue: JsonValue
}
