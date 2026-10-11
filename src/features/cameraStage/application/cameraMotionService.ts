import { createLogger } from '@/core/logging'

import type { StageCameraObject, StageVec3 } from '../domain/sceneTypes'
import type { StageCameraMovePreset, StageSpeedPreset } from '../domain/stateKeyframeTypes'
import { cameraStageProjectStore, ensureCameraStageProjectRuntime, saveCameraStageProjectRuntime, bindCameraStageProjectOperation } from './cameraStageProjectRuntime'
import { captureCameraStageUndo } from './cameraStageUndo'
import { cameraMotionIdentity, cameraMotionSourceKey, compileCameraMotionCandidates, assertCameraCandidateCurrent, type CameraMotionCandidateRequest } from './cameraMotionCandidates'
import { checkCancelled, CreativeIntentError, type ComputationControl } from '@/core/creativeIntent/sampling'
import { applyAnimationAtTime } from '../store/playbackSampling'
import type { CameraMotionNativeCandidate } from './cameraMotionCandidates'

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
  const state = cameraStageProjectStore(input.projectId).getState()
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
  await ensureCameraStageProjectRuntime(projectId)
}

function applyStateKeyframeMotion(
  input: CameraStageMotionInput,
  camera: StageCameraObject,
  target: { point: StageVec3; objectId: string | null },
): Omit<CameraStageMotionResult, 'projectId' | 'cameraId' | 'targetObjectId' | 'moveKind' | 'undoToken'> {
  let state = cameraStageProjectStore(input.projectId).getState()
  const startStateKeyframe = input.startStateKeyframeId
    ? state.stateKeyframes.find((stateKeyframe) => stateKeyframe.id === input.startStateKeyframeId)
    : state.stateKeyframes.find((stateKeyframe) => stateKeyframe.id === state.selectedStateKeyframeId) ?? state.stateKeyframes[0]
  if (!startStateKeyframe) throw new Error('NOT_AVAILABLE')
  state.selectStateKeyframe(startStateKeyframe.id)
  state = cameraStageProjectStore(input.projectId).getState()
  state.updateObject(camera.id, {
    lookAt: target.objectId
      ? { mode: 'object', objectId: target.objectId, fallbackTarget: target.point }
      : { mode: 'manual', target: target.point },
  })
  state = cameraStageProjectStore(input.projectId).getState()
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
    cameraStageProjectStore(input.projectId).getState().addStateKeyframe()
    state = cameraStageProjectStore(input.projectId).getState()
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
  const updated = cameraStageProjectStore(input.projectId).getState()
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

async function applyCameraStageMotionInternal(input: CameraStageMotionInput): Promise<CameraStageMotionResult> {
  logger.info('三维运镜应用开始', {
    event: 'camera_stage.motion.apply.start',
    projectId: input.projectId,
    cameraId: input.cameraId,
    moveKind: input.move.kind,
  })
  try {
    if (!Number.isFinite(input.duration) || input.duration <= 0 || input.duration > 3_600) throw new Error('INVALID_TIME_RANGE')
    await ensureLoaded(input.projectId)
    const state = cameraStageProjectStore(input.projectId).getState()
    const camera = state.objects.find((object): object is StageCameraObject => object.id === input.cameraId && object.type === 'camera')
    if (!camera) throw new Error('NOT_FOUND')
    const target = resolveTarget(input)
    const undoToken = captureCameraStageUndo(input.projectId)
    const applied = applyStateKeyframeMotion(input, camera, target)
    await saveCameraStageProjectRuntime(input.projectId)
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

export const applyCameraStageMotion = bindCameraStageProjectOperation(applyCameraStageMotionInternal, (input) => input.projectId)

export type CameraMotionReview = Awaited<ReturnType<typeof prepareCameraStageMotionInternal>>
const reviews = new WeakMap<CameraMotionReview, { projectId: string; sourceKey: string; request: CameraMotionCandidateRequest; result: ReturnType<typeof compileCameraMotionCandidates>; applied?: { candidateId: string; undoToken: string; sourceKey: string } }>()

async function prepareCameraStageMotionInternal(projectId: string, request: CameraMotionCandidateRequest, control: ComputationControl = {}, demonstration?: CameraMotionNativeCandidate) {
  logger.info('三维机位候选整理开始', { event: 'camera_stage.motion.prepare.start', projectId, cameraId: request.cameraId })
  try {
    checkCancelled(control)
    const state = cameraStageProjectStore(projectId).getState()
    const sourceKey = cameraMotionSourceKey(state)
    const frozenRequest = structuredClone(request)
    const identity = await cameraMotionIdentity(state, frozenRequest)
    checkCancelled(control)
    if (sourceKey !== cameraMotionSourceKey(cameraStageProjectStore(projectId).getState())) throw new CreativeIntentError('stale-candidate', [], '场景已变化，请重新整理')
    const result = compileCameraMotionCandidates(demonstration ? { ...state, ...structuredClone(demonstration) } : state, frozenRequest, identity, control)
    const review = { candidates: result.candidates.map(({ id, label }) => ({ id, label })), unavailable: structuredClone(result.unavailable) }
    reviews.set(review, { projectId, sourceKey, request: frozenRequest, result })
    logger.info('三维机位候选整理完成', { event: 'camera_stage.motion.prepare.completed', projectId, candidateCount: result.candidates.length })
    return review
  } catch (error) {
    logger.error('三维机位候选整理失败', error, { event: 'camera_stage.motion.prepare.failed', projectId })
    throw error
  }
}

export const prepareCameraStageMotion = bindCameraStageProjectOperation(prepareCameraStageMotionInternal, projectId => projectId)

/** Read-only native preview: never installs candidate objects, animation or history into the document store. */
export function readCameraStageMotionPreview(projectId: string, review: CameraMotionReview, candidateId: string): CameraMotionNativeCandidate {
  const record = reviews.get(review)
  const candidate = record?.result.candidates.find(value => value.id === candidateId)
  if (!record || record.projectId !== projectId || !candidate || record.applied || record.sourceKey !== cameraMotionSourceKey(cameraStageProjectStore(projectId).getState())) throw new CreativeIntentError('stale-candidate', [], '候选已失效，请重新整理')
  return structuredClone(candidate.native)
}


/** Commit one native state-keyframe change; a failed save retains the change and retries only the original save. */
export const applyCameraStageMotionCandidate = bindCameraStageProjectOperation(async (projectId: string, review: CameraMotionReview, candidateId: string): Promise<{ undoToken: string; saved: boolean }> => {
  logger.info('三维机位候选应用开始', { event: 'camera_stage.motion.candidate.apply.start', projectId, candidateId })
  const record = reviews.get(review)
  try {
    if (!record || record.projectId !== projectId) throw new CreativeIntentError('stale-candidate', [], '候选已失效，请重新整理')
    const store = cameraStageProjectStore(projectId)
    if (record.applied) {
      if (record.applied.candidateId !== candidateId || record.applied.sourceKey !== cameraMotionSourceKey(store.getState())) throw new CreativeIntentError('stale-candidate', [], '应用后场景已变化，请重新整理')
    } else {
      const candidate = record.result.candidates.find(item => item.id === candidateId)
      if (!candidate) throw new CreativeIntentError('camera-candidate', [], '请选择可用的候选')
      const sourceKey = cameraMotionSourceKey(store.getState())
      assertCameraCandidateCurrent(candidate, await cameraMotionIdentity(store.getState(), record.request))
      if (sourceKey !== cameraMotionSourceKey(store.getState()) || record.applied) throw new CreativeIntentError('stale-candidate', [], '场景已变化，请重新整理')
      const state = store.getState()
      const undoToken = captureCameraStageUndo(projectId)
      const native = structuredClone(candidate.native)
      // A single domain commit enters the existing document/history pipeline. No derived track is persisted separately.
      store.setState({ stateKeyframes: native.stateKeyframes, animation: native.animation, objects: applyAnimationAtTime(state.objects, native.animation, state.playback.currentTime) })
      record.applied = { candidateId, undoToken, sourceKey: cameraMotionSourceKey(store.getState()) }
    }
    try {
      await saveCameraStageProjectRuntime(projectId)
    } catch (error) {
      logger.error('三维机位候选已应用但保存失败', error, { event: 'camera_stage.motion.candidate.save.failed', projectId, candidateId })
      return { undoToken: record.applied.undoToken, saved: false }
    }
    logger.info('三维机位候选应用完成', { event: 'camera_stage.motion.candidate.apply.completed', projectId, candidateId })
    return { undoToken: record.applied.undoToken, saved: true }
  } catch (error) {
    logger.error('三维机位候选应用失败', error, { event: 'camera_stage.motion.candidate.apply.failed', projectId, candidateId })
    throw error
  }
}, projectId => projectId)
