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

const DEFAULT_MODEL_PROPERTY_IDS = [
  'generation.default_image_model',
  'generation.default_video_model',
  'generation.default_audio_model',
] as const

const DEFAULT_MODEL_CASCADE_DECLARATIONS = DEFAULT_MODEL_PROPERTY_IDS.map((propertyId) => ({
  declarationId: `settings.${propertyId}.cleared`,
  effect: 'update' as const,
  entityType: SETTINGS_ENTITY_TYPE,
  propertyIds: [propertyId],
  revisionScopes: ['settings'],
}))

const logger = createLogger('features.settings.mutation')

function createUndoToken(): string {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `settings-undo:${random}`
}

export class SettingsMutationExecutor implements ApplicationMutationExecutor {
  readonly entityType = SETTINGS_ENTITY_TYPE
  readonly effectContract = { direct: [], cascades: DEFAULT_MODEL_CASCADE_DECLARATIONS }
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
    const completed: Array<Array<{ id: string; before: SettingValue }>> = []
    const cascadedPropertyIds: string[][] = []
    logger.info('设置事务开始', {
      event: 'settings.transaction.apply.start', requestId: context.requestId,
      settingIds: steps.flatMap((step) => step.mutations.map((mutation) => mutation.propertyId)),
    })
    try {
      for (const step of steps) {
        if (step.target.kind !== this.entityType || step.target.id !== 'singleton') throw new Error('NOT_FOUND')
        const stepBefore = new Map<string, SettingValue>()
        const stepCompleted: Array<{ id: string; before: SettingValue }> = []
        completed.push(stepCompleted)
        cascadedPropertyIds.push([])
        const defaultModelsBefore = new Map(DEFAULT_MODEL_PROPERTY_IDS.map((propertyId) => {
          const definition = definitions.get(propertyId)
          if (!definition) throw new Error(`NOT_FOUND:${propertyId}`)
          return [propertyId, definition.read()] as const
        }))
        for (const mutation of step.mutations) {
          if (mutation.operation !== 'set') throw new Error('INVALID_MUTATION_OPERATION')
          const definition = definitions.get(mutation.propertyId)
          if (!definition || definition.sensitive) throw new Error('NOT_FOUND')
          const value = definition.schema.parse(mutation.value)
          if (definition.id === 'general.primary_provider') {
            for (const [propertyId, before] of defaultModelsBefore) {
              if (stepBefore.has(propertyId)) continue
              stepBefore.set(propertyId, before)
              stepCompleted.push({ id: propertyId, before })
            }
          }
          if (!stepBefore.has(definition.id)) {
            const before = definition.read()
            stepBefore.set(definition.id, before)
            stepCompleted.push({ id: definition.id, before })
          }
          definition.write(value)
        }
        const directPropertyIds = new Set(step.mutations.map((mutation) => mutation.propertyId))
        const stepCascades = DEFAULT_MODEL_PROPERTY_IDS.filter((propertyId) => {
          if (directPropertyIds.has(propertyId)) return false
          const definition = definitions.get(propertyId)
          return definition?.read() !== defaultModelsBefore.get(propertyId)
        })
        cascadedPropertyIds[cascadedPropertyIds.length - 1] = stepCascades
      }
    } catch (error) {
      for (const stepValues of completed.reverse()) {
        for (const item of stepValues.reverse()) definitions.get(item.id)?.write(item.before)
      }
      logger.error('设置事务失败', error, {
        event: 'settings.transaction.apply.failed', requestId: context.requestId,
      })
      throw error
    }
    const revision = getSettingsRegistryRevision()
    const results = steps.map((step, index) => {
      const values = (completed[index] ?? [])
        .map((item) => ({ id: item.id, value: item.before }))
      const undoToken = createUndoToken()
      this.undoEntries.set(undoToken, { values })
      return {
        status: 'completed' as const,
        resultingRevisions: { settings: revision },
        directRefs: [{ kind: this.entityType, id: 'singleton', revision }],
        evidence: step.mutations.map((mutation) => ({
          kind: 'property_value' as const,
          target: { kind: this.entityType, id: 'singleton', revision },
          fact: `设置 ${mutation.propertyId} 已更新。`,
          data: definitions.get(mutation.propertyId)?.read(),
          capturedAt: new Date().toISOString(),
        })),
        cascadeEffects: (cascadedPropertyIds[index] ?? []).map((propertyId) => ({
          effect: 'update' as const,
          entityType: SETTINGS_ENTITY_TYPE,
          refs: [{ kind: SETTINGS_ENTITY_TYPE, id: 'singleton', revision }],
          propertyIds: [propertyId],
          origin: {
            kind: 'cascade' as const,
            declarationId: `settings.${propertyId}.cleared`,
          },
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
        directRefs: [{ kind: this.entityType, id: 'singleton', revision }],
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
