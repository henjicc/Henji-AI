import { Euler, Quaternion } from 'three'
import { createCameraCandidates, cameraPose3DSchema, assertCameraCandidateCurrent, type CameraCandidateFamily, type CameraPose3D } from '@/core/creativeIntent/cameraAdapter'
import type { CandidateIdentity } from '@/core/creativeIntent/contracts'
import { CreativeIntentError, checkCancelled, type ComputationControl } from '@/core/creativeIntent/sampling'
import { resolveCameraLookAtTarget, resolveCameraRotation, cameraTargetFromPositionRotation } from '../domain/cameraUtils'
import { compileStateKeyframesToAnimation } from '../domain/stateKeyframeCompiler'
import { createCameraPresetPath, defaultSpatialPath } from '../domain/spatialPath'
import type { StageCameraObject, StageObject } from '../domain/sceneTypes'
import type { StageStateKeyframe } from '../domain/stateKeyframeTypes'
import { applyAnimationAtTime } from '../store/playbackSampling'
import type { CameraStageState } from '../store/cameraStageStore'
import { sha256HexString } from '@/utils/save/hash'

export interface CameraMotionCandidateRequest {
  cameraId: string
  stateKeyframeIds: string[]
  pinnedStateKeyframeIds: string[]
  /** Explicit world-space scale used only for geometric error measures. */
  sceneScale: number
  orbitDegrees: number
  orbitDirection: 'cw' | 'ccw'
  dollyDistanceRatio: number
  pauseRatio: number
}
export interface CameraMotionNativeCandidate { stateKeyframes: StageStateKeyframe[]; animation: CameraStageState['animation'] }

export function cameraStagePose3D(camera: StageCameraObject, objects: StageObject[]): CameraPose3D {
  const rotation = resolveCameraRotation(camera, objects)
  const orientation = new Quaternion().setFromEuler(new Euler(rotation.x * Math.PI / 180, rotation.y * Math.PI / 180, rotation.z * Math.PI / 180, 'YXZ'))
  const parsed = cameraPose3DSchema.safeParse({ position: camera.transform.position, target: resolveCameraLookAtTarget(camera, objects), orientation: orientation.toArray(), fovDegrees: camera.fov })
  if (!parsed.success) throw new CreativeIntentError('camera-unrepresentable', [camera.id], '路径经过无效机位、退化视线或无效焦距，请调整机位')
  return parsed.data
}

function cameraAtState(state: CameraStageState, keyframe: StageStateKeyframe, cameraId: string): { camera: StageCameraObject; objects: StageObject[] } {
  const objects = state.objects.map(object => {
    const snapshot = keyframe.objectStates[object.id]
    if (!snapshot) return object
    return object.type === 'camera' ? { ...object, transform: snapshot.transform, fov: snapshot.fov ?? object.fov, lookAt: snapshot.lookAt ?? object.lookAt } : { ...object, transform: snapshot.transform }
  })
  const camera = objects.find((object): object is StageCameraObject => object.id === cameraId && object.type === 'camera')
  if (!camera || !keyframe.objectStates[cameraId]) throw new CreativeIntentError('camera-missing', [cameraId], '机位不在当前场景中')
  return { camera, objects }
}

function validateRequest(state: CameraStageState, request: CameraMotionCandidateRequest): StageStateKeyframe[] {
  if (!Number.isFinite(request.orbitDegrees) || request.orbitDegrees <= 0 || !Number.isFinite(request.dollyDistanceRatio) || request.dollyDistanceRatio <= 0 || request.dollyDistanceRatio >= 1 || !Number.isFinite(request.pauseRatio) || request.pauseRatio <= 0 || request.pauseRatio >= 1 || !['cw', 'ccw'].includes(request.orbitDirection)) throw new CreativeIntentError('camera-options', [], '请设置有效的环绕角度、推近比例和停顿比例')
  const selected = request.stateKeyframeIds.map(id => {
    const frame = state.stateKeyframes.find(item => item.id === id)
    if (!frame) throw new CreativeIntentError('camera-state-missing', [id], '状态关键帧已不存在')
    return frame
  })
  const firstIndex = state.stateKeyframes.indexOf(selected[0])
  if (selected.some((frame, index) => state.stateKeyframes[firstIndex + index] !== frame)) throw new CreativeIntentError('camera-range', request.stateKeyframeIds, '请选择按时间排列的连续状态关键帧')
  if (selected.some(frame => frame.cameraId !== null && frame.cameraId !== request.cameraId)) throw new CreativeIntentError('camera-cut', request.stateKeyframeIds, '请先将选段设为同一拍摄机位且使用绝对时间')
  const camera = state.objects.find((object): object is StageCameraObject => object.id === request.cameraId && object.type === 'camera')
  if (!camera) throw new CreativeIntentError('camera-missing', [request.cameraId], '机位不在当前场景中')
  if (selected.some(frame => {
    const target = frame.objectStates[request.cameraId]?.lookAt
    return camera.lookAt.mode === 'object' || target?.mode === 'object' ? JSON.stringify(target) !== JSON.stringify(camera.lookAt) : !target
  })) throw new CreativeIntentError('camera-look-at', [request.cameraId], '请先统一选段的注视对象')
  return selected
}

function compileFamily(state: CameraStageState, request: CameraMotionCandidateRequest, family: CameraCandidateFamily, control: ComputationControl): CameraMotionNativeCandidate {
  const stateKeyframes = structuredClone(state.stateKeyframes)
  const selected = request.stateKeyframeIds.map(id => stateKeyframes.find(frame => frame.id === id)!)
  for (let index = 0; index < selected.length - 1; index++) {
    checkCancelled(control)
    const from = selected[index]; const to = selected[index + 1]
    const start = from.objectStates[request.cameraId]; const end = to.objectStates[request.cameraId]
    const { camera, objects } = cameraAtState({ ...state, stateKeyframes }, from, request.cameraId)
    const target = resolveCameraLookAtTarget(camera, objects)
    const generated = family === 'smooth' ? { path: from.transition.perObject[request.cameraId]?.spatialPath ?? defaultSpatialPath(start.transform.position, end.transform.position), endPosition: end.transform.position }
      : createCameraPresetPath(family === 'orbit' ? { kind: 'orbit', degrees: request.orbitDegrees, direction: request.orbitDirection } : { kind: 'dollyIn', distanceRatio: request.dollyDistanceRatio }, start.transform.position, target)
    end.transform.position = { ...generated.endPosition }
    from.transition.perObject[request.cameraId] = {
      ...from.transition.perObject[request.cameraId], spatialPath: generated.path,
      speedPreset: 'easeInOut', delay: family === 'dolly-hold' ? (to.time - from.time) * request.pauseRatio : from.transition.perObject[request.cameraId]?.delay ?? 0,
    }
  }
  return { stateKeyframes, animation: compileStateKeyframesToAnimation(stateKeyframes, state.objects) }
}

/** Native renderer sampling is also the validation path; no independent camera player. */
export function evaluateCameraMotionCandidate(state: CameraStageState, cameraId: string, native: CameraMotionNativeCandidate, frame: number): CameraPose3D {
  const objects = applyAnimationAtTime(state.objects, native.animation, frame / state.animation.fps)
  const camera = objects.find((object): object is StageCameraObject => object.id === cameraId && object.type === 'camera')
  if (!camera) throw new CreativeIntentError('camera-missing', [cameraId], '机位已不存在')
  const cameraStates = native.stateKeyframes.map(keyframe => keyframe.objectStates[cameraId]).filter(Boolean)
  if (camera.lookAt.mode === 'manual' && cameraStates.some(snapshot => JSON.stringify(snapshot.lookAt) !== JSON.stringify(cameraStates[0]?.lookAt))) {
    const reference = cameraStates[0], position = camera.transform.position
    const target = reference.lookAt?.mode === 'manual' ? reference.lookAt.target : camera.lookAt.target
    const origin = reference.transform.position
    const distance = Math.hypot(target.x - origin.x, target.y - origin.y, target.z - origin.z)
    return cameraStagePose3D({ ...camera, lookAt: { mode: 'manual', target: cameraTargetFromPositionRotation(position, camera.transform.rotation, distance) } }, objects)
  }
  return cameraStagePose3D(camera, objects)
}

export function compileCameraMotionCandidates(state: CameraStageState, request: CameraMotionCandidateRequest, identity: CandidateIdentity, control: ComputationControl = {}) {
  const selected = validateRequest(state, request)
  const anchors = selected.map(keyframe => {
    const { camera, objects } = cameraAtState(state, keyframe, request.cameraId)
    const frame = keyframe.time * state.animation.fps
    if (Math.abs(frame - Math.round(frame)) > 1e-7) throw new CreativeIntentError('camera-frame-grid', [keyframe.id], '机位时间必须落在正式帧上')
    return { id: keyframe.id, frame: Math.round(frame), pose: cameraStagePose3D(camera, objects) }
  })
  const last = selected[selected.length - 1]
  const boundaryPins = last && state.stateKeyframes.indexOf(last) < state.stateKeyframes.length - 1 ? [last.id] : []
  return createCameraCandidates({ identity, anchors, pinnedIds: [...request.pinnedStateKeyframeIds, ...boundaryPins], sceneScale: request.sceneScale }, {
    compile: family => compileFamily(state, request, family, control),
    evaluate: (native, frame) => evaluateCameraMotionCandidate(state, request.cameraId, native, frame),
  }, control)
}

export function cameraMotionSourceKey(state: CameraStageState): string {
  return JSON.stringify([state.currentProjectId, applyAnimationAtTime(state.objects, state.animation, 0), state.stateKeyframes, state.activeCameraId, state.animation.fps])
}

export async function cameraMotionIdentity(state: CameraStageState, request: CameraMotionCandidateRequest): Promise<CandidateIdentity> {
  const digest = `sha256:${await sha256HexString(cameraMotionSourceKey(state))}`
  return { ownerRef: { kind: 'camera_stage.scene', id: state.currentProjectId! }, sourceDraftDigest: digest, algorithmVersion: 'camera-stage/1', requestKey: JSON.stringify(request), targetBases: [{ targetRef: { kind: 'camera_stage.camera', id: `${state.currentProjectId}:${request.cameraId}` }, baseDigest: digest, geometryDigest: digest }] }
}

export { assertCameraCandidateCurrent }
