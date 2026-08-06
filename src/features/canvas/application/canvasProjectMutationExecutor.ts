import type {
  ApplicationCompletedStepResult,
  ApplicationEvidence,
  ApplicationMutationExecutor,
  ApplicationPlannedStep,
  ApplicationPropertyWriterTable,
} from '@/core/application-control'
import { applyWriterTable, propertyOperations, writableProperties } from '@/core/application-control'
import { createLogger } from '@/core/logging'
import { useProjectStore } from '@/stores/projectStore'

import { renameCanvasProject } from './canvasProjectService'
import { CANVAS_ENTITY_TYPES } from './canvasReflection'

type MutationStep = Extract<ApplicationPlannedStep, { kind: 'mutation' }>

const logger = createLogger('features.canvas.project_mutation')

const NAME_PROPERTY = `${CANVAS_ENTITY_TYPES.project}.name`
const UNDO_PREFIX = 'canvas-project-undo:'

/**
 * 画布工程属性写入执行器。
 *
 * 只覆盖 `name` —— `node_count` 与 `edge_count` 是统计值，逐条声明为只读。
 *
 * 补这个执行器闭合了一个既有缺陷：`canvas.project.name` 早就声明为可写，但画布只注册了
 * `canvas.node` 的 mutation 执行器，工程改名走通用动词会命中 `MUTATION_EXECUTOR_NOT_FOUND`。
 * 与 `asset.tags` 是同一类悬空声明。
 */
/** 写入目标只有工程 id —— 改名直接落到领域服务，没有需要累积的中间态。 */
const WRITERS: ApplicationPropertyWriterTable<string> = {
  [NAME_PROPERTY]: {
    async write(projectId, mutation) {
      if (typeof mutation.value !== 'string' || mutation.value.trim() === '') {
        throw new Error('CANVAS_PROJECT_NAME_INVALID：工程名必须是非空字符串。')
      }
      await renameCanvasProject(projectId, mutation.value)
    },
  },
}

export class CanvasProjectMutationExecutor implements ApplicationMutationExecutor {
  readonly entityType = CANVAS_ENTITY_TYPES.project
  readonly writableProperties = writableProperties(WRITERS)
  readonly propertyOperations = propertyOperations(WRITERS)

  async apply(step: MutationStep): Promise<ApplicationCompletedStepResult> {
    const projectId = step.target.id
    const previousName = useProjectStore.getState().projects.find((project) => project.id === projectId)?.name ?? ''
    await applyWriterTable(WRITERS, projectId, step.mutations)
    const revision = this.revision()
    logger.info('画布工程属性写入完成', {
      event: 'canvas.project_mutation.apply.completed', projectId,
    })
    return {
      status: 'completed',
      resultingRevisions: { canvas: revision },
      producedRefs: [{ kind: this.entityType, id: projectId, revision }],
      evidence: step.mutations.map((mutation) => ({
        kind: 'property_value' as const,
        target: { kind: this.entityType, id: projectId, revision },
        fact: `画布工程属性 ${mutation.propertyId} 已更新。`,
        data: mutation.value ?? null,
        capturedAt: new Date().toISOString(),
      })),
      undoToken: `${UNDO_PREFIX}${JSON.stringify({ projectId, previousName })}`,
    }
  }

  async compensate(_step: MutationStep, result: ApplicationCompletedStepResult): Promise<ApplicationEvidence[]> {
    if (!result.undoToken) return []
    return (await this.undo(result.undoToken)).evidence
  }

  async undo(undoToken: string): Promise<ApplicationCompletedStepResult> {
    if (!undoToken.startsWith(UNDO_PREFIX)) throw new Error('CANVAS_PROJECT_UNDO_INVALID')
    const parsed = JSON.parse(undoToken.slice(UNDO_PREFIX.length)) as Record<string, unknown>
    const projectId = typeof parsed.projectId === 'string' ? parsed.projectId : ''
    const previousName = typeof parsed.previousName === 'string' ? parsed.previousName : ''
    if (!projectId || !previousName) throw new Error('CANVAS_PROJECT_UNDO_INVALID')
    await renameCanvasProject(projectId, previousName)
    const revision = this.revision()
    return {
      status: 'completed',
      resultingRevisions: { canvas: revision },
      producedRefs: [{ kind: this.entityType, id: projectId, revision }],
      evidence: [{
        kind: 'entity_state',
        target: { kind: this.entityType, id: projectId, revision },
        fact: '画布工程属性写入已撤销。',
        capturedAt: new Date().toISOString(),
      }],
    }
  }

  private revision(): number {
    return Math.max(0, Math.trunc(useProjectStore.getState().currentProject?.updatedAt ?? 0))
  }
}
