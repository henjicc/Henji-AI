import type {
  ApplicationCompletedStepResult,
  ApplicationEvidence,
  ApplicationMutationExecutor,
  ApplicationPlannedStep,
} from '@/core/application-control'
import { applyWriterTable, fieldWriterTable, propertyOperations, writableProperties } from '@/core/application-control'
import { createLogger } from '@/core/logging'

import {
  buildModelKey,
  getGenerationModelsRevision,
  GENERATION_MODEL_FIELDS as FIELDS,
  isModelHidden,
  setModelHidden,
  type GenerationModelDraft,
} from './generationModelFields'
import { getGenerationModelSchema } from './generationPreparationService'
import { GENERATION_ENTITY_TYPES } from './generationReflection'

type MutationStep = Extract<ApplicationPlannedStep, { kind: 'mutation' }>

const logger = createLogger('features.generation.model_mutation')

const UNDO_PREFIX = 'generation-model-undo:'

/*
 * fieldWriterTable(FIELDS) 只收编声明了 writer 的字段——目前只有 hidden，所以这张表
 * 天然只有一个 key。provider_id/media_type/name/tags/parameter_schema_ref 没有 writer，
 * 写它们会走 applyWriterTable 的 PROPERTY_NOT_WRITABLE 分支，不需要在这里额外判断。
 */
const WRITERS = fieldWriterTable(FIELDS)

/** generation.model 属性写入执行器（4.4）：目前唯一可写的是 hidden，只碰 hidden_models 集合。 */
export class GenerationModelMutationExecutor implements ApplicationMutationExecutor {
  readonly entityType = GENERATION_ENTITY_TYPES.model
  readonly writableProperties = writableProperties(WRITERS)
  readonly propertyOperations = propertyOperations(WRITERS)

  async apply(step: MutationStep): Promise<ApplicationCompletedStepResult> {
    const modelId = step.target.id
    const schema = getGenerationModelSchema(modelId)
    const key = buildModelKey(String((schema.meta as Record<string, unknown>).provider), modelId)
    const previousHidden = isModelHidden(key)

    const draft: GenerationModelDraft = {}
    await applyWriterTable(WRITERS, draft, step.mutations)
    if (draft.hidden !== undefined) setModelHidden(key, draft.hidden)

    const revision = getGenerationModelsRevision()
    logger.info('生成模型属性写入完成', {
      event: 'generation.model_mutation.apply.completed', modelId,
    })
    return {
      status: 'completed',
      resultingRevisions: { models: revision },
      producedRefs: [{ kind: this.entityType, id: modelId, revision }],
      evidence: step.mutations.map((mutation) => ({
        kind: 'property_value' as const,
        target: { kind: this.entityType, id: modelId, revision },
        fact: `模型属性 ${mutation.propertyId} 已更新。`,
        data: mutation.value ?? null,
        capturedAt: new Date().toISOString(),
      })),
      undoToken: `${UNDO_PREFIX}${JSON.stringify({ modelId, key, previousHidden })}`,
    }
  }

  async compensate(_step: MutationStep, result: ApplicationCompletedStepResult): Promise<ApplicationEvidence[]> {
    if (!result.undoToken) return []
    return (await this.undo(result.undoToken)).evidence
  }

  async undo(undoToken: string): Promise<ApplicationCompletedStepResult> {
    if (!undoToken.startsWith(UNDO_PREFIX)) throw new Error('GENERATION_MODEL_UNDO_INVALID')
    const parsed = JSON.parse(undoToken.slice(UNDO_PREFIX.length)) as Record<string, unknown>
    const modelId = typeof parsed.modelId === 'string' ? parsed.modelId : ''
    const key = typeof parsed.key === 'string' ? parsed.key : ''
    const previousHidden = typeof parsed.previousHidden === 'boolean' ? parsed.previousHidden : undefined
    if (!modelId || !key || previousHidden === undefined) throw new Error('GENERATION_MODEL_UNDO_INVALID')
    setModelHidden(key, previousHidden)
    const revision = getGenerationModelsRevision()
    return {
      status: 'completed',
      resultingRevisions: { models: revision },
      producedRefs: [{ kind: this.entityType, id: modelId, revision }],
      evidence: [{
        kind: 'entity_state',
        target: { kind: this.entityType, id: modelId, revision },
        fact: '生成模型属性写入已撤销。',
        capturedAt: new Date().toISOString(),
      }],
    }
  }
}
