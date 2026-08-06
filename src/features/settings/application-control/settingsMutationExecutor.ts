import type {
  ApplicationCompletedStepResult,
  ApplicationEvidence,
  ApplicationExecutionContext,
  ApplicationMutationExecutor,
  ApplicationMutationOperation,
  ApplicationPlannedStep,
} from '@/core/application-control'
import { createLogger } from '@/core/logging'

import { getSettingsRegistryRevision, listApplicationSettingDefinitions } from './settingsApplicationService'
import { SETTINGS_ENTITY_TYPE } from './settingsReflection'
import type { SettingValue } from './types'

type MutationStep = Extract<ApplicationPlannedStep, { kind: 'mutation' }>
interface SettingsUndoEntry { values: Array<{ id: string; value: SettingValue }> }

const logger = createLogger('features.settings.mutation')

function createUndoToken(): string {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `settings-undo:${random}`
}

export class SettingsMutationExecutor implements ApplicationMutationExecutor {
  readonly entityType = SETTINGS_ENTITY_TYPE
  private readonly undoEntries = new Map<string, SettingsUndoEntry>()

  /*
   * 设置项这一支天然就是表驱动的（definitions 就是那张表），所以这里不需要 writerTable，
   * 只要把「表的 key 集合」暴露出来给门禁。用 getter 而不是构造期快照：设置定义是运行期
   * 从注册表算的，模型目录加载前后条数会变。
   *
   * 可写 = 非敏感。敏感项在反射层同样被标成不可读不可写，两侧口径必须是同一个判断。
   */
  get writableProperties(): ReadonlySet<string> {
    return new Set(listApplicationSettingDefinitions()
      .filter((definition) => !definition.sensitive)
      .map((definition) => definition.id))
  }

  get propertyOperations(): ReadonlyMap<string, ReadonlySet<ApplicationMutationOperation>> {
    return new Map([...this.writableProperties].map((id) => [id, new Set<ApplicationMutationOperation>(['set'])]))
  }

  async apply(step: MutationStep, context: ApplicationExecutionContext): Promise<ApplicationCompletedStepResult> {
    return (await this.applyAtomic([step], context))[0]
  }

  async applyAtomic(
    steps: MutationStep[],
    context: ApplicationExecutionContext
  ): Promise<ApplicationCompletedStepResult[]> {
    const definitions = new Map(listApplicationSettingDefinitions().map((definition) => [definition.id, definition]))
    const completed: Array<{ id: string; before: SettingValue }> = []
    logger.info('设置事务开始', {
      event: 'settings.transaction.apply.start', requestId: context.requestId,
      settingIds: steps.flatMap((step) => step.mutations.map((mutation) => mutation.propertyId)),
    })
    try {
      for (const step of steps) {
        if (step.target.kind !== this.entityType || step.target.id !== 'singleton') throw new Error('NOT_FOUND')
        for (const mutation of step.mutations) {
          if (mutation.operation !== 'set') throw new Error('INVALID_MUTATION_OPERATION')
          const definition = definitions.get(mutation.propertyId)
          if (!definition || definition.sensitive) throw new Error('NOT_FOUND')
          const value = definition.schema.parse(mutation.value)
          completed.push({ id: definition.id, before: definition.read() })
          definition.write(value)
        }
      }
    } catch (error) {
      for (const item of completed.reverse()) definitions.get(item.id)?.write(item.before)
      logger.error('设置事务失败', error, {
        event: 'settings.transaction.apply.failed', requestId: context.requestId,
      })
      throw error
    }
    const revision = getSettingsRegistryRevision()
    let offset = 0
    const results = steps.map((step) => {
      const values = completed.slice(offset, offset + step.mutations.length)
        .map((item) => ({ id: item.id, value: item.before }))
      offset += step.mutations.length
      const undoToken = createUndoToken()
      this.undoEntries.set(undoToken, { values })
      return {
        status: 'completed' as const,
        resultingRevisions: { settings: revision },
        producedRefs: [{ kind: this.entityType, id: 'singleton', revision }],
        evidence: step.mutations.map((mutation) => ({
          kind: 'property_value' as const,
          target: { kind: this.entityType, id: 'singleton', revision },
          fact: `设置 ${mutation.propertyId} 已更新。`,
          data: definitions.get(mutation.propertyId)?.read(),
          capturedAt: new Date().toISOString(),
        })),
        undoToken,
      }
    })
    logger.info('设置事务完成', {
      event: 'settings.transaction.apply.completed', requestId: context.requestId, revision,
    })
    return results
  }

  async compensate(
    _step: MutationStep,
    result: ApplicationCompletedStepResult,
    context: ApplicationExecutionContext
  ): Promise<ApplicationEvidence[]> {
    if (!result.undoToken) throw new Error('UNDO_NOT_SUPPORTED')
    return (await this.undo(result.undoToken, context)).evidence
  }

  async undo(undoToken: string, context: ApplicationExecutionContext): Promise<ApplicationCompletedStepResult> {
    const entry = this.undoEntries.get(undoToken)
    if (!entry) throw new Error('NOT_FOUND')
    const definitions = new Map(listApplicationSettingDefinitions().map((definition) => [definition.id, definition]))
    logger.info('设置撤销开始', { event: 'settings.transaction.undo.start', requestId: context.requestId })
    try {
      for (const item of [...entry.values].reverse()) definitions.get(item.id)?.write(item.value)
      this.undoEntries.delete(undoToken)
      const revision = getSettingsRegistryRevision()
      logger.info('设置撤销完成', {
        event: 'settings.transaction.undo.completed', requestId: context.requestId, revision,
      })
      return {
        status: 'completed',
        resultingRevisions: { settings: revision },
        producedRefs: [{ kind: this.entityType, id: 'singleton', revision }],
        evidence: [{
          kind: 'entity_state',
          target: { kind: this.entityType, id: 'singleton', revision },
          fact: '应用设置已撤销到事务前状态。',
          capturedAt: new Date().toISOString(),
        }],
      }
    } catch (error) {
      logger.error('设置撤销失败', error, {
        event: 'settings.transaction.undo.failed', requestId: context.requestId,
      })
      throw error
    }
  }
}
