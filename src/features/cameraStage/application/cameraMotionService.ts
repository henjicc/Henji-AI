import { createLogger } from '@/core/logging'

import type { StageCameraObject, StageVec3 } from '../domain/sceneTypes'
import type { StageCameraMovePreset, StageSpeedPreset } from '../domain/stateKeyframeTypes'
import { saveCurrentProject, loadProjectIntoScene } from '../projects/cameraStageProjectService'
import { useCameraStageStore } from '../store/cameraStageStore'
import { captureCameraStageUndo } from './cameraStageUndo'

const logger = createLogger('features.cameraStage.camera_motion')

export interface CameraStageMotionInput {
  projectId: string
  cameraId: string
  move: StageCameraMovePreset
  targetObjectId?: string
  targetPoint?: StageVec3
  startStateKeyframeId?: string
  endStateKeyframeId?: string
  duration: number
  speed: StageSpeedPreset
}

export interface CameraStageMotionResult {
  projectId: string
  cameraId: string
  targetObjectId: string | null
  moveKind: StageCameraMovePreset['kind']
  startTime: number
  endTime: number
  affectedStateKeyframeIds: string[]
  affectedStateKeyframeCount: number
  path: {
    source: StageCameraMovePreset['kind']
    sampleCount: number
    start: StageVec3
    end: StageVec3
  }
  undoToken: string
}

function requireFiniteVec3(value: StageVec3): StageVec3 {
  if (![value.x, value.y, value.z].every(Number.isFinite)) throw new Error('INVALID_TARGET')
  return { ...value }
}

function resolveTarget(input: CameraStageMotionInput): { point: StageVec3; objectId: string | null } {
  const state = useCameraStageStore.getState()
  if (input.targetObjectId) {
    const target = state.objects.find((object) => object.id === input.targetObjectId)
    if (!target || target.type === 'camera') throw new Error('NOT_FOUND')
    const point = { ...target.transform.position }
    if (target.type === 'character') point.y += target.transform.scale.y
    return { point, objectId: target.id }
  }
  if (input.targetPoint) return { point: requireFiniteVec3(input.targetPoint), objectId: null }
  if (input.move.kind !== 'crane') throw new Error('TARGET_REQUIRED')
  const camera = state.objects.find((object): object is StageCameraObject => object.id === input.cameraId && object.type === 'camera')
  if (!camera) throw new Error('NOT_FOUND')
  return camera.lookAt.mode === 'manual'
    ? { point: { ...camera.lookAt.target }, objectId: null }
    : { point: { ...camera.lookAt.fallbackTarget }, objectId: camera.lookAt.objectId }
}

async function ensureLoaded(projectId: string): Promise<void> {
  if (useCameraStageStore.getState().currentProjectId === projectId) return
  if (!await loadProjectIntoScene(projectId)) throw new Error('NOT_FOUND')
}

function applyStateKeyframeMotion(
  input: CameraStageMotionInput,
  camera: StageCameraObject,
  target: { point: StageVec3; objectId: string | null },
): Omit<CameraStageMotionResult, 'projectId' | 'cameraId' | 'targetObjectId' | 'moveKind' | 'undoToken'> {
  let state = useCameraStageStore.getState()
  const startStateKeyframe = input.startStateKeyframeId
    ? state.stateKeyframes.find((stateKeyframe) => stateKeyframe.id === input.startStateKeyframeId)
    : state.stateKeyframes.find((stateKeyframe) => stateKeyframe.id === state.selectedStateKeyframeId) ?? state.stateKeyframes[0]
  if (!startStateKeyframe) throw new Error('NOT_AVAILABLE')
  state.selectStateKeyframe(startStateKeyframe.id)
  state = useCameraStageStore.getState()
  state.updateObject(camera.id, {
    lookAt: target.objectId
      ? { mode: 'object', objectId: target.objectId, fallbackTarget: target.point }
      : { mode: 'manual', target: target.point },
  })
  state = useCameraStageStore.getState()
  state.captureIntoSelectedStateKeyframe([camera.id])

  const startIndex = state.stateKeyframes.findIndex((stateKeyframe) => stateKeyframe.id === startStateKeyframe.id)
  let endStateKeyframe = input.endStateKeyframeId
    ? state.stateKeyframes.find((stateKeyframe) => stateKeyframe.id === input.endStateKeyframeId)
    : state.stateKeyframes[startIndex + 1]
  if (input.endStateKeyframeId && (!endStateKeyframe || state.stateKeyframes[startIndex + 1]?.id !== input.endStateKeyframeId)) {
    throw new Error('STATE_KEYFRAME_RANGE_NOT_ADJACENT')
  }
  if (!endStateKeyframe) {
    state.seek(startStateKeyframe.time + input.duration)
    useCameraStageStore.getState().addStateKeyframe()
    state = useCameraStageStore.getState()
    endStateKeyframe = state.stateKeyframes.find((stateKeyframe) => stateKeyframe.id === state.selectedStateKeyframeId)
  }
  if (!endStateKeyframe) throw new Error('CAPABILITY_REJECTED')

  state.updateStateKeyframeCamera(startStateKeyframe.id, camera.id)
  state.updateStateKeyframeCamera(endStateKeyframe.id, camera.id)
  state.updateStateKeyframeTiming(startStateKeyframe.id, { transitionDuration: input.duration })
  state.updateStateKeyframeTransition(startStateKeyframe.id, {
    perObject: { [camera.id]: { speedPreset: input.speed } },
  })
  state.applyCameraPathPreset(startStateKeyframe.id, camera.id, input.move)
  const updated = useCameraStageStore.getState()
  const updatedStart = updated.stateKeyframes.find((stateKeyframe) => stateKeyframe.id === startStateKeyframe.id)
  const updatedEnd = updated.stateKeyframes.find((stateKeyframe) => stateKeyframe.id === endStateKeyframe?.id)
  const path = updatedStart?.transition.perObject[camera.id]?.spatialPath
  const startPosition = updatedStart?.objectStates[camera.id]?.transform.position ?? camera.transform.position
  const endPosition = updatedEnd?.objectStates[camera.id]?.transform.position ?? camera.transform.position
  return {
    startTime: startStateKeyframe.time,
    endTime: updatedEnd?.time ?? startStateKeyframe.time + input.duration,
    affectedStateKeyframeIds: [startStateKeyframe.id, endStateKeyframe.id],
    affectedStateKeyframeCount: 2,
    path: {
      source: input.move.kind,
      sampleCount: (path?.knots.length ?? 0) + 2,
      start: { ...startPosition },
      end: { ...endPosition },
    },
  }
}

export async function applyCameraStageMotion(input: CameraStageMotionInput): Promise<CameraStageMotionResult> {
  logger.info('三维运镜应用开始', {
    event: 'camera_stage.motion.apply.start',
    projectId: input.projectId,
    cameraId: input.cameraId,
    moveKind: input.move.kind,
  })
  try {
    if (!Number.isFinite(input.duration) || input.duration <= 0 || input.duration > 3_600) throw new Error('INVALID_TIME_RANGE')
    await ensureLoaded(input.projectId)
    const state = useCameraStageStore.getState()
    const camera = state.objects.find((object): object is StageCameraObject => object.id === input.cameraId && object.type === 'camera')
    if (!camera) throw new Error('NOT_FOUND')
    const target = resolveTarget(input)
    const undoToken = captureCameraStageUndo(input.projectId)
    const applied = applyStateKeyframeMotion(input, camera, target)
    await saveCurrentProject()
    const result: CameraStageMotionResult = {
      projectId: input.projectId,
      cameraId: camera.id,
      targetObjectId: target.objectId,
      moveKind: input.move.kind,
      undoToken,
      ...applied,
    }
    logger.info('三维运镜应用完成', {
      event: 'camera_stage.motion.apply.completed',
      projectId: input.projectId,
      cameraId: input.cameraId,
      moveKind: input.move.kind,
      affectedStateKeyframeCount: result.affectedStateKeyframeCount,
    })
    return result
  } catch (error) {
    logger.error('三维运镜应用失败', error, {
      event: 'camera_stage.motion.apply.failed',
      projectId: input.projectId,
      cameraId: input.cameraId,
      moveKind: input.move.kind,
    })
    throw error
  }
}
