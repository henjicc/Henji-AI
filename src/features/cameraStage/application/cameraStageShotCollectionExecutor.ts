import type {
  ApplicationCollectionExecutor,
  ApplicationCompletedStepResult,
  ApplicationEvidence,
  ApplicationPlannedStep,
  ApplicationRef,
  JsonValue,
} from '@/core/application-control'

import type { StageShot } from '../domain/shotTypes'
import { CAMERA_STAGE_ENTITY_TYPES } from './cameraStageReflection'
import { cameraStageShotService, type CameraStageShotCreateInput } from './cameraStageShotService'
import type { CameraStageControlExecutorDependencies } from './cameraStageControlExecutors'
import { restoreCameraStageUndo } from './cameraStageUndo'

type CollectionStep = Extract<ApplicationPlannedStep, { kind: 'collection' }>

const CONTINUITY_VALUES = new Set<StageShot['continuity']>(['stop', 'smooth'])

function property(properties: Record<string, JsonValue>, suffix: string): JsonValue | undefined {
  return properties[`${CAMERA_STAGE_ENTITY_TYPES.shot}.${suffix}`]
}

function numberValue(value: JsonValue | undefined, label: string): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value)
  throw new Error(`SHOT_${label}_INVALID：${label} 必须是数字。`)
}

function optionalNumberValue(value: JsonValue | undefined, label: string): number | undefined {
  return value === undefined ? undefined : numberValue(value, label)
}

function optionalStringValue(value: JsonValue | undefined): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string' || value.trim() === '') throw new Error('SHOT_NAME_INVALID：name 必须是非空字符串。')
  return value
}

/** 引用可能是 `projectId:objectId` 形式的稳定引用，也可能是裸对象 id，两者都接受。 */
function optionalCameraId(value: JsonValue | undefined): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  if (typeof value === 'string') return value.includes(':') ? value.slice(value.indexOf(':') + 1) : value
  if (typeof value === 'object' && !Array.isArray(value)) {
    const id = (value as Record<string, JsonValue>).id
    if (typeof id === 'string') return id.includes(':') ? id.slice(id.indexOf(':') + 1) : id
  }
  throw new Error('SHOT_CAMERA_REF_INVALID：camera_ref 必须是对象引用或对象 id 字符串。')
}

function optionalContinuity(value: JsonValue | undefined): StageShot['continuity'] | undefined {
  if (value === undefined) return undefined
  if (typeof value === 'string' && CONTINUITY_VALUES.has(value as StageShot['continuity'])) {
    return value as StageShot['continuity']
  }
  throw new Error(`SHOT_CONTINUITY_INVALID：continuity 只能是 ${[...CONTINUITY_VALUES].join('、')}。`)
}

/** 镜头卡稳定引用形如 `projectId:shotId`。 */
function childShotId(ref: ApplicationRef): string {
  const separator = ref.id.indexOf(':')
  if (separator < 1) throw new Error(`SHOT_REF_INVALID：«${ref.id}» 不是合法镜头卡引用，应为 工程:镜头。`)
  return ref.id.slice(separator + 1)
}

/**
 * 镜头卡集合写入执行器。
 *
 * 助手此前只能靠专用能力 `add_camera_stage_shot` 新建镜头卡，删不掉也排不了序——store 侧的
 * 删除逻辑早就是完整实现，缺的只是这一条正式入口。重排顺序不在这里：镜头卡的顺序完全由
 * `time` 决定，写 `camera_stage.shot.time` 属性就能达到重排效果，不需要单独的 reorder 操作。
 */
export class CameraStageShotCollectionExecutor implements ApplicationCollectionExecutor {
  readonly entityType = CAMERA_STAGE_ENTITY_TYPES.shot

  constructor(private readonly dependencies: CameraStageControlExecutorDependencies) {}

  async apply(step: CollectionStep): Promise<ApplicationCompletedStepResult> {
    const projectId = step.parent.id.includes(':') ? step.parent.id.slice(0, step.parent.id.indexOf(':')) : step.parent.id
    if (step.operation.kind === 'create') {
      const inputs: CameraStageShotCreateInput[] = step.operation.items.map((item) => ({
        time: numberValue(property(item.properties, 'time'), 'TIME'),
        name: optionalStringValue(property(item.properties, 'name')),
        cameraId: optionalCameraId(property(item.properties, 'camera_ref')),
        continuity: optionalContinuity(property(item.properties, 'continuity')),
        hold: optionalNumberValue(property(item.properties, 'hold'), 'HOLD'),
        transitionDuration: optionalNumberValue(property(item.properties, 'transition_duration'), 'TRANSITION_DURATION'),
      }))
      const result = await cameraStageShotService.createShots(projectId, inputs)
      return this.completed(projectId, result.undoToken, result.shotIds, `已新建 ${result.shotIds.length} 张镜头卡。`)
    }
    const targets = step.operation.targets.map((target) => childShotId(target))
    const result = await cameraStageShotService.removeShots(projectId, targets)
    return this.completed(projectId, result.undoToken, targets, `已删除 ${result.removedCount} 张镜头卡。`)
  }

  async compensate(_step: CollectionStep, result: ApplicationCompletedStepResult): Promise<ApplicationEvidence[]> {
    if (!result.undoToken) return []
    return (await this.undo(result.undoToken)).evidence
  }

  async undo(undoToken: string): Promise<ApplicationCompletedStepResult> {
    const restored = await restoreCameraStageUndo(undoToken)
    this.dependencies.bumpRevision()
    const revision = this.dependencies.readRevision()
    return {
      status: 'completed',
      resultingRevisions: { toolbox: revision },
      producedRefs: [{ kind: CAMERA_STAGE_ENTITY_TYPES.project, id: restored.projectId, revision }],
      evidence: [{
        kind: 'entity_state',
        target: { kind: CAMERA_STAGE_ENTITY_TYPES.project, id: restored.projectId, revision },
        fact: '三维镜头卡写入已撤销。',
        capturedAt: new Date().toISOString(),
      }],
    }
  }

  private completed(
    projectId: string,
    undoToken: string,
    shotIds: string[],
    fact: string
  ): ApplicationCompletedStepResult {
    this.dependencies.bumpRevision()
    const revision = this.dependencies.readRevision()
    const refs: ApplicationRef[] = shotIds.map((shotId) => ({
      kind: CAMERA_STAGE_ENTITY_TYPES.shot,
      id: `${projectId}:${shotId}`,
      revision,
    }))
    return {
      status: 'completed',
      resultingRevisions: { toolbox: revision },
      producedRefs: refs.slice(0, 64),
      evidence: [{
        kind: 'operation_result',
        target: { kind: CAMERA_STAGE_ENTITY_TYPES.project, id: projectId, revision },
        fact,
        data: { shotIds },
        capturedAt: new Date().toISOString(),
      }],
      undoToken,
    }
  }
}
