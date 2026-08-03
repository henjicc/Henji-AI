import type {
  ApplicationCollectionExecutor,
  ApplicationCompletedStepResult,
  ApplicationEvidence,
  ApplicationPlannedStep,
  ApplicationRef,
  JsonValue,
} from '@/core/application-control'

import type { StageEasing } from '../domain/animationTypes'
import { CAMERA_STAGE_ENTITY_TYPES } from './cameraStageReflection'
import { cameraStageKeyframeService } from './cameraStageKeyframeService'
import type { CameraStageControlExecutorDependencies } from './cameraStageControlExecutors'
import { restoreCameraStageUndo } from './cameraStageUndo'

type CollectionStep = Extract<ApplicationPlannedStep, { kind: 'collection' }>

const EASINGS = new Set<StageEasing>(['linear', 'easeIn', 'easeOut', 'easeInOut'])

function property(properties: Record<string, JsonValue>, suffix: string): JsonValue | undefined {
  return properties[`${CAMERA_STAGE_ENTITY_TYPES.keyframe}.${suffix}`]
}

/** 引用可能是 `projectId:objectId` 形式的稳定引用，也可能是裸对象 id，两者都接受。 */
function objectIdFromRef(value: JsonValue | undefined): string {
  if (typeof value === 'string') return value.includes(':') ? value.slice(value.indexOf(':') + 1) : value
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const id = (value as Record<string, JsonValue>).id
    if (typeof id === 'string') return id.includes(':') ? id.slice(id.indexOf(':') + 1) : id
  }
  throw new Error('KEYFRAME_OBJECT_REF_INVALID：object_ref 必须是对象引用或对象 id 字符串。')
}

function numberValue(value: JsonValue | undefined, label: string): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value)
  throw new Error(`KEYFRAME_${label}_INVALID：${label} 必须是数字。`)
}

function stringValue(value: JsonValue | undefined, label: string): string {
  if (typeof value === 'string' && value.trim() !== '') return value
  throw new Error(`KEYFRAME_${label}_INVALID：${label} 必须是非空字符串。`)
}

function easingValue(value: JsonValue | undefined): StageEasing | undefined {
  if (value === undefined || value === null) return undefined
  const easing = String(value) as StageEasing
  if (!EASINGS.has(easing)) {
    throw new Error(`KEYFRAME_EASING_INVALID：easing 只能是 ${[...EASINGS].join('、')}。`)
  }
  return easing
}

/**
 * 关键帧集合写入执行器。
 *
 * 这是通用集合动词落到三维领域的第一个实现：助手不需要任何"上下漂浮""自转"之类的专用能力，
 * 只要按属性路径写关键帧就能表达任意对象动画。
 */
export class CameraStageKeyframeCollectionExecutor implements ApplicationCollectionExecutor {
  readonly entityType = CAMERA_STAGE_ENTITY_TYPES.keyframe

  constructor(private readonly dependencies: CameraStageControlExecutorDependencies) {}

  async apply(step: CollectionStep): Promise<ApplicationCompletedStepResult> {
    const projectId = step.parent.id.includes(':')
      ? step.parent.id.slice(0, step.parent.id.indexOf(':'))
      : step.parent.id
    if (step.operation.kind === 'create') {
      const keyframes = step.operation.items.map((item) => ({
        objectId: objectIdFromRef(property(item.properties, 'object_ref')),
        propertyPath: stringValue(property(item.properties, 'property_path'), 'PROPERTY_PATH'),
        time: numberValue(property(item.properties, 'time'), 'TIME'),
        value: numberValue(property(item.properties, 'value'), 'VALUE'),
        easing: easingValue(property(item.properties, 'easing')),
      }))
      const result = await cameraStageKeyframeService.createKeyframes(projectId, keyframes)
      return this.completed(projectId, result.undoToken, keyframes.map((keyframe) => ({
        objectId: keyframe.objectId, propertyPath: keyframe.propertyPath, time: keyframe.time,
      })), `已写入 ${result.createdCount} 个关键帧，时间轴长度 ${result.duration} 秒。`)
    }
    const targets = step.operation.targets.map((target) => parseKeyframeRef(target))
    const result = await cameraStageKeyframeService.removeKeyframes(projectId, targets)
    return this.completed(projectId, result.undoToken, targets, `已删除 ${result.removedCount} 个关键帧。`)
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
        fact: '三维关键帧写入已撤销。',
        capturedAt: new Date().toISOString(),
      }],
    }
  }

  private completed(
    projectId: string,
    undoToken: string,
    keyframes: Array<{ objectId: string; propertyPath: string; time: number }>,
    fact: string
  ): ApplicationCompletedStepResult {
    this.dependencies.bumpRevision()
    const revision = this.dependencies.readRevision()
    const refs: ApplicationRef[] = keyframes.map((keyframe) => ({
      kind: CAMERA_STAGE_ENTITY_TYPES.keyframe,
      id: `${projectId}:${keyframe.objectId}:${keyframe.propertyPath}:${keyframe.time}`,
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
        data: {
          keyframeCount: keyframes.length,
          objectIds: [...new Set(keyframes.map((keyframe) => keyframe.objectId))],
          propertyPaths: [...new Set(keyframes.map((keyframe) => keyframe.propertyPath))],
        },
        capturedAt: new Date().toISOString(),
      }],
      undoToken,
    }
  }
}

/** 关键帧稳定引用形如 `projectId:objectId:propertyPath:time`。 */
function parseKeyframeRef(ref: ApplicationRef): { objectId: string; propertyPath: string; time: number } {
  const parts = ref.id.split(':')
  if (parts.length < 4) {
    throw new Error(`KEYFRAME_REF_INVALID：«${ref.id}» 不是合法关键帧引用，应为 工程:对象:属性路径:时间。`)
  }
  const time = Number(parts[parts.length - 1])
  if (!Number.isFinite(time)) throw new Error(`KEYFRAME_REF_INVALID：«${ref.id}» 的时间段不是数字。`)
  return { objectId: parts[1], propertyPath: parts.slice(2, -1).join(':'), time }
}
