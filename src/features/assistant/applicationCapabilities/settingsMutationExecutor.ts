import type {
  ApplicationCompletedStepResult,
  ApplicationEvidence,
  ApplicationExecutionContext,
  ApplicationMutationExecutor,
  ApplicationPlannedStep,
} from '@/core/application-control'
import { createLogger } from '@/core/logging'

import {
  getSettingsRegistryRevision,
  listApplicationSettingDefinitions,
  type SettingValue,
} from './settingsRegistry'

type MutationStep = Extract<ApplicationPlannedStep, { kind: 'mutation' }>

interface SettingsUndoEntry {
  values: Array<{ id: string; value: SettingValue }>
}

const logger = createLogger('features.assistant.settings_application_control')

function createUndoToken(): string {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `settings-undo:${random}`
}

export class SettingsMutationExecutor implements ApplicationMutationExecutor {
  readonly entityType = 'settings.registry'
  private readonly undoEntries = new Map<string, SettingsUndoEntry>()

  async apply(
    step: MutationStep,
    context: ApplicationExecutionContext
  ): Promise<ApplicationCompletedStepResult> {
    return (await this.applyAtomic([step], context))[0]
  }

  async applyAtomic(
    steps: MutationStep[],
    context: ApplicationExecutionContext
  ): Promise<ApplicationCompletedStepResult[]> {
    const definitions = new Map(listApplicationSettingDefinitions().map((definition) => [definition.id, definition]))
    const completed: Array<{ id: string; before: SettingValue }> = []
    logger.info('settings_control.apply.start', {
      event: 'application_control.settings.apply.start',
      requestId: context.requestId,
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
      logger.error('settings_control.apply.failed', error, {
        event: 'application_control.settings.apply.failed',
        requestId: context.requestId,
      })
      throw error
    }
    const revision = getSettingsRegistryRevision()
    let offset = 0
    const results = steps.map((step) => {
      const values = completed
        .slice(offset, offset + step.mutations.length)
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
    logger.info('settings_control.apply.completed', {
      event: 'application_control.settings.apply.completed',
      requestId: context.requestId,
      revision,
    })
    return results
  }

  async compensate(
    _step: MutationStep,
    result: ApplicationCompletedStepResult,
    context: ApplicationExecutionContext
  ): Promise<ApplicationEvidence[]> {
    if (!result.undoToken) throw new Error('UNDO_NOT_SUPPORTED')
    const undone = await this.undo(result.undoToken, context)
    return undone.evidence
  }

  async undo(
    undoToken: string,
    _context: ApplicationExecutionContext
  ): Promise<ApplicationCompletedStepResult> {
    const entry = this.undoEntries.get(undoToken)
    if (!entry) throw new Error('NOT_FOUND')
    const definitions = new Map(listApplicationSettingDefinitions().map((definition) => [definition.id, definition]))
    for (const item of [...entry.values].reverse()) definitions.get(item.id)?.write(item.value)
    this.undoEntries.delete(undoToken)
    const revision = getSettingsRegistryRevision()
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
  }
}
