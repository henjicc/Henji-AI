import { createLogger } from '@/core/logging'

import type { StageEasingPreset, StageSceneAnimation } from '../domain/animationTypes'
import { compileCameraMoveSamples } from '../domain/shotCameraMovePresets'
import type { StageCameraObject, StageVec3 } from '../domain/sceneTypes'
import type { StageCameraMovePreset, StageSpeedPreset } from '../domain/shotTypes'
import { saveCurrentProject, loadProjectIntoScene } from '../projects/cameraStageProjectService'
import { upsertTrackKeyframe } from '../store/animationActions'
import { useCameraStageStore } from '../store/cameraStageStore'
import { captureCameraStageUndo } from './cameraStageUndo'

const logger = createLogger('features.cameraStage.camera_motion')

export interface CameraStageMotionInput {
  projectId: string
  cameraId: string
  move: StageCameraMovePreset
  targetObjectId?: string
  targetPoint?: StageVec3
  startShotId?: string
  endShotId?: string
  startTime?: number
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
  affectedShotIds: string[]
  affectedKeyframeCount: number
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

function speedToEasing(speed: StageSpeedPreset): StageEasingPreset {
  if (speed === 'uniform') return 'linear'
  if (speed === 'fastStart') return 'easeOut'
  if (speed === 'slowStart') return 'easeIn'
  return 'easeInOut'
}

function countCameraPositionKeyframes(animation: StageSceneAnimation, cameraId: string): number {
  return animation.tracks
    .filter((track) => track.objectId === cameraId && track.propertyPath.startsWith('transform.position.'))
    .reduce((total, track) => total + track.keyframes.length, 0)
}

async function ensureLoaded(projectId: string): Promise<void> {
  if (useCameraStageStore.getState().currentProjectId === projectId) return
  if (!await loadProjectIntoScene(projectId)) throw new Error('NOT_FOUND')
}

function applyProfessionalMotion(
  input: CameraStageMotionInput,
  camera: StageCameraObject,
  target: StageVec3,
): Omit<CameraStageMotionResult, 'projectId' | 'cameraId' | 'targetObjectId' | 'moveKind' | 'undoToken'> {
  const state = useCameraStageStore.getState()
  const startTime = input.startTime ?? state.playback.currentTime
  const endTime = startTime + input.duration
  const samples = compileCameraMoveSamples(
    input.move,
    camera.transform.position,
    target,
    startTime,
    endTime,
    speedToEasing(input.speed),
  )
  let animation = state.animation
  for (const sample of samples) {
    for (const axis of ['x', 'y', 'z'] as const) {
      animation = upsertTrackKeyframe(
        animation,
        camera.id,
        `transform.position.${axis}`,
        sample.time,
        sample.position[axis],
        sample.easing,
      )
    }
  }
  animation = { ...animation, duration: Math.max(animation.duration, endTime) }
  useCameraStageStore.setState({ animation })
  return {
    startTime,
    endTime,
    affectedShotIds: [],
    affectedKeyframeCount: samples.length * 3,
    path: {
      source: input.move.kind,
      sampleCount: samples.length,
      start: { ...samples[0].position },
      end: { ...samples[samples.length - 1].position },
    },
  }
}

function applySimpleMotion(
  input: CameraStageMotionInput,
  camera: StageCameraObject,
  target: { point: StageVec3; objectId: string | null },
): Omit<CameraStageMotionResult, 'projectId' | 'cameraId' | 'targetObjectId' | 'moveKind' | 'undoToken'> {
  let state = useCameraStageStore.getState()
  const startShot = input.startShotId
    ? state.shots.find((shot) => shot.id === input.startShotId)
    : state.shots.find((shot) => shot.id === state.selectedShotId) ?? state.shots[0]
  if (!startShot) throw new Error('NOT_AVAILABLE')
  state.selectShot(startShot.id)
  state = useCameraStageStore.getState()
  state.updateObject(camera.id, {
    lookAt: target.objectId
      ? { mode: 'object', objectId: target.objectId, fallbackTarget: target.point }
      : { mode: 'manual', target: target.point },
  })
  state = useCameraStageStore.getState()
  state.captureIntoSelectedShot([camera.id])

  const startIndex = state.shots.findIndex((shot) => shot.id === startShot.id)
  let endShot = input.endShotId
    ? state.shots.find((shot) => shot.id === input.endShotId)
    : state.shots[startIndex + 1]
  if (input.endShotId && (!endShot || state.shots[startIndex + 1]?.id !== input.endShotId)) {
    throw new Error('SHOT_RANGE_NOT_ADJACENT')
  }
  if (!endShot) {
    state.seek(startShot.time + input.duration)
    useCameraStageStore.getState().addShot()
    state = useCameraStageStore.getState()
    endShot = state.shots.find((shot) => shot.id === state.selectedShotId)
  }
  if (!endShot) throw new Error('CAPABILITY_REJECTED')

  state.updateShotCamera(startShot.id, camera.id)
  state.updateShotCamera(endShot.id, camera.id)
  state.updateShotTiming(startShot.id, { transitionDuration: input.duration })
  state.updateShotTransition(startShot.id, {
    perObject: { [camera.id]: { speedPreset: input.speed } },
  })
  state.applyCameraPathPreset(startShot.id, camera.id, input.move)
  const updated = useCameraStageStore.getState()
  const updatedStart = updated.shots.find((shot) => shot.id === startShot.id)
  const updatedEnd = updated.shots.find((shot) => shot.id === endShot?.id)
  const path = updatedStart?.transition.perObject[camera.id]?.spatialPath
  const startPosition = updatedStart?.objectStates[camera.id]?.transform.position ?? camera.transform.position
  const endPosition = updatedEnd?.objectStates[camera.id]?.transform.position ?? camera.transform.position
  return {
    startTime: startShot.time,
    endTime: updatedEnd?.time ?? startShot.time + input.duration,
    affectedShotIds: [startShot.id, endShot.id],
    affectedKeyframeCount: countCameraPositionKeyframes(updated.animation, camera.id),
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
    let state = useCameraStageStore.getState()
    const camera = state.objects.find((object): object is StageCameraObject => object.id === input.cameraId && object.type === 'camera')
    if (!camera) throw new Error('NOT_FOUND')
    const target = resolveTarget(input)
    const undoToken = captureCameraStageUndo(input.projectId)
    let updatedCamera = camera
    if (state.editorMode !== 'simple') {
      state.updateObject(camera.id, {
        lookAt: target.objectId
          ? { mode: 'object', objectId: target.objectId, fallbackTarget: target.point }
          : { mode: 'manual', target: target.point },
      })
      state = useCameraStageStore.getState()
      const nextCamera = state.objects.find((object): object is StageCameraObject => object.id === camera.id && object.type === 'camera')
      if (!nextCamera) throw new Error('NOT_FOUND')
      updatedCamera = nextCamera
    }
    const applied = state.editorMode === 'simple'
      ? applySimpleMotion(input, updatedCamera, target)
      : applyProfessionalMotion(input, updatedCamera, target.point)
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
      affectedKeyframeCount: result.affectedKeyframeCount,
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
