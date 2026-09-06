import type { ApplicationRef } from '../identifiers'
import type { ApplicationEffectReceipt, ApplicationPlannedStep } from '../transactions'
import type { ApplicationCascadeEffectDeclaration, ApplicationCompletedStepResult, ApplicationExecutionContext } from './types'

export interface ApplicationPersistenceReceipt {
  effects: ApplicationEffectReceipt[]
  resultingRevisions: Record<string, number>
}

export interface ApplicationPersistenceRecovery {
  capabilityId: string
  target: ApplicationRef
  replayMutation: false
}

export interface ApplicationPersistenceFacts {
  memoryState: 'modified' | 'preserved'
  persistenceState: 'unconfirmed'
  stage: 'document' | 'projection'
  recovery: ApplicationPersistenceRecovery
}

/** 存储确认失败不是业务命令失败，调用者不得重放或自动撤销已应用命令。 */
export class ApplicationPersistenceFailure extends Error {
  constructor(message: string, readonly facts: ApplicationPersistenceFacts, readonly cause?: unknown,
    readonly receipt?: ApplicationPersistenceReceipt) {
    super(message)
    this.name = 'ApplicationPersistenceFailure'
  }
}

export interface ApplicationPersistenceBatch {
  confirm(): Promise<ApplicationPersistenceReceipt | void>
  release(): void
}

export interface ApplicationPersistenceParticipant {
  readonly key: string
  readonly persistenceEffects?: readonly ApplicationCascadeEffectDeclaration[]
  begin(): ApplicationPersistenceBatch
}

export type ApplicationPersistenceResolver = (
  steps: readonly ApplicationPlannedStep[],
  context: ApplicationExecutionContext,
) => readonly ApplicationPersistenceParticipant[]

export class ApplicationPersistenceBoundaryFailure extends Error {
  constructor(
    readonly failure: ApplicationPersistenceFailure,
    readonly completed: ApplicationCompletedStepResult[],
    readonly executionFailure?: ApplicationExecutionProgressFailure,
    readonly receipts: ApplicationPersistenceReceipt[] = [],
    readonly completedStepIndexes: number[] = executionFailure?.completedStepIndexes ?? completed.map((_, index) => index),
  ) {
    super(failure.message)
    this.name = 'ApplicationPersistenceBoundaryFailure'
  }
}

export class ApplicationExecutionProgressFailure extends Error {
  constructor(message: string, readonly completed: ApplicationCompletedStepResult[],
    readonly compensatedStepIndexes: number[], readonly cause?: unknown,
    readonly completedStepIndexes: number[] = completed.map((_, index) => index)) {
    super(message)
    this.name = 'ApplicationExecutionProgressFailure'
  }
}

/** 唯一整批聚合点；未注册参与者的领域保持原执行语义。 */
export async function withApplicationPersistenceBoundary<T>(input: {
  participants: readonly ApplicationPersistenceParticipant[]
  context: ApplicationExecutionContext
  execute: (context: ApplicationExecutionContext) => Promise<T>
  completed: (result: T) => ApplicationCompletedStepResult[]
  completedIndexes?: (result: T) => number[]
  onReceipt?: (receipt: ApplicationPersistenceReceipt) => void
}): Promise<T> {
  const batches = new Map<string, ApplicationPersistenceBatch>()
  const participants = new Map(input.participants.map((participant) => [participant.key, participant]))
  const receipts: ApplicationPersistenceReceipt[] = []
  const acceptReceipt = (key: string, receipt: ApplicationPersistenceReceipt | void): void => {
    if (!receipt) return
    const declarations = participants.get(key)?.persistenceEffects ?? []
    for (const effect of receipt.effects) {
      const origin = effect.origin
      const declaration = origin.kind === 'cascade'
        ? declarations.find((candidate) => candidate.declarationId === origin.declarationId) : undefined
      if (!declaration || declaration.effect !== effect.effect || declaration.entityType !== effect.entityType
        || effect.refs.some((ref) => ref.kind !== declaration.entityType)
        || effect.propertyIds.some((propertyId) => !declaration.propertyIds.includes(propertyId))) {
        throw new Error('UNDECLARED_PERSISTENCE_EFFECT')
      }
    }
    if (Object.keys(receipt.resultingRevisions).some((scope) => !declarations.some((item) => item.revisionScopes.includes(scope)))) {
      throw new Error('UNDECLARED_PERSISTENCE_REVISION')
    }
    receipts.push(receipt)
    input.onReceipt?.(receipt)
  }
  const confirm = async (key: string, batch: ApplicationPersistenceBatch): Promise<void> => {
    try { acceptReceipt(key, await batch.confirm()) }
    catch (error) {
      if (error instanceof ApplicationPersistenceFailure) acceptReceipt(key, error.receipt)
      throw error
    }
  }
  try {
    for (const participant of input.participants) {
      if (!batches.has(participant.key)) batches.set(participant.key, participant.begin())
    }
    const context = { ...input.context, persistenceScopes: new Set(batches.keys()) }
    let result: T
    try {
      result = await input.execute(context)
    } catch (error) {
      // 业务补偿结束后也确认其最终快照，不能只撤内存就宣称磁盘已恢复。
      for (const [key, batch] of batches) {
        try { await confirm(key, batch) }
        catch (failure) {
          if (failure instanceof ApplicationPersistenceFailure) {
            const progress = error instanceof ApplicationExecutionProgressFailure ? error : undefined
            throw new ApplicationPersistenceBoundaryFailure(failure, progress?.completed ?? [], progress, receipts)
          }
          throw failure
        }
      }
      throw error
    }
    try {
      for (const [key, batch] of batches) await confirm(key, batch)
    } catch (failure) {
      if (failure instanceof ApplicationPersistenceFailure) {
        throw new ApplicationPersistenceBoundaryFailure(failure, input.completed(result), undefined, receipts, input.completedIndexes?.(result))
      }
      throw failure
    }
    return result
  } finally {
    for (const batch of [...batches.values()].reverse()) batch.release()
  }
}
