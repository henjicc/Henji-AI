import type {
  ApplicationCompletedStepResult,
  ApplicationEvidence,
  ApplicationMutationExecutor,
  ApplicationPlannedStep,
} from '@/core/application-control'
import { applyWriterTable, fieldWriterTable, propertyOperations, writableProperties } from '@/core/application-control'
import { createLogger } from '@/core/logging'

import { GENERATION_DRAFT_ENTITY_TYPE, GENERATION_DRAFT_FIELDS as FIELDS, type GenerationDraftPatch } from './generationDraftFields'
import { useGenerationDraftStore } from '../store/generationDraftStore'
import type { GenerationDraft } from '../domain/generationDraft'

type MutationStep = Extract<ApplicationPlannedStep, { kind: 'mutation' }>

const logger = createLogger('features.generation.draft_mutation')

const UNDO_PREFIX = 'generation-draft-undo:'
const SINGLETON_ID = 'singleton'

const WRITERS = fieldWriterTable(FIELDS)

/** generation.draft 属性写入执行器（5.4）：写入表由 generationDraftFields.ts 派生，
 * 不重写 reducer——最终提交都落在 5.1 的 applyGenerationDraftPatch 上（经 5.3 的
 * store.patch）。 */
export class GenerationDraftMutationExecutor implements ApplicationMutationExecutor {
  readonly effectContract = { direct: [], cascades: [] }
  readonly entityType = GENERATION_DRAFT_ENTITY_TYPE
  readonly writableProperties = writableProperties(WRITERS)
  readonly propertyOperations = propertyOperations(WRITERS)

  async apply(step: MutationStep): Promise<ApplicationCompletedStepResult> {
    if (step.target.id !== SINGLETON_ID) throw new Error('NOT_FOUND')

    const patch: GenerationDraftPatch = {}
    await applyWriterTable(WRITERS, patch, step.mutations)

    const previousDraft = useGenerationDraftStore.getState().draft
    const previousValues: GenerationDraftPatch = {}
    for (const key of Object.keys(patch) as Array<keyof GenerationDraft>) {
      previousValues[key] = previousDraft[key] as never
    }

    useGenerationDraftStore.getState().patch(patch)
    const revision = useGenerationDraftStore.getState().revision

    logger.info('生成草稿属性写入完成', {
      event: 'generation.draft_mutation.apply.completed',
      properties: step.mutations.map((mutation) => mutation.propertyId),
    })

    return {
      status: 'completed',
      resultingRevisions: { generation_draft: revision },
      directRefs: [{ kind: this.entityType, id: SINGLETON_ID, revision }],
      evidence: step.mutations.map((mutation) => ({
        kind: 'property_value' as const,
        target: { kind: this.entityType, id: SINGLETON_ID, revision },
        fact: `生成草稿属性 ${mutation.propertyId} 已更新。`,
        data: mutation.value ?? null,
        capturedAt: new Date().toISOString(),
      })),
      undoToken: `${UNDO_PREFIX}${JSON.stringify(previousValues)}`,
    }
  }

  async compensate(_step: MutationStep, result: ApplicationCompletedStepResult): Promise<ApplicationEvidence[]> {
    if (!result.undoToken) return []
    return (await this.undo(result.undoToken)).evidence
  }

  async undo(undoToken: string): Promise<ApplicationCompletedStepResult> {
    if (!undoToken.startsWith(UNDO_PREFIX)) throw new Error('GENERATION_DRAFT_UNDO_INVALID')
    const previousValues = JSON.parse(undoToken.slice(UNDO_PREFIX.length)) as GenerationDraftPatch
    useGenerationDraftStore.getState().patch(previousValues)
    const revision = useGenerationDraftStore.getState().revision
    return {
      status: 'completed',
      resultingRevisions: { generation_draft: revision },
      directRefs: [{ kind: this.entityType, id: SINGLETON_ID, revision }],
      evidence: [{
        kind: 'entity_state',
        target: { kind: this.entityType, id: SINGLETON_ID, revision },
        fact: '生成草稿属性写入已撤销。',
        capturedAt: new Date().toISOString(),
      }],
    }
  }
}
