import { cameraStageProjectStore, findCameraStageProjectInstance } from './cameraStageProjectRuntime'
import { cameraMotionSourceKey, type CameraMotionNativeCandidate, type CameraMotionCandidateRequest } from './cameraMotionCandidates'
import { prepareCameraStageMotion, applyCameraStageMotionCandidate, readCameraStageMotionPreview, type CameraMotionReview } from './cameraMotionService'
import { applyAnimationAtTime } from '../store/playbackSampling'
import { createStateKeyframe, type StageStateKeyframe } from '../domain/stateKeyframeTypes'
import { compileStateKeyframesToAnimation } from '../domain/stateKeyframeCompiler'
import type { StageCameraObject, StageVec3, StageObject } from '../domain/sceneTypes'
import { cameraTargetFromPositionRotation, resolveCameraLookAtTarget, rotationFromPositionAndTarget } from '../domain/cameraUtils'
import type { CameraStageState } from '../store/cameraStageStore'
import { readCameraStagePlaybackRuntime } from '../scene/playbackRuntime'
import { createLogger } from '@/core/logging'

const logger = createLogger('cameraStage.motionDraft')

export type CameraMotionProperty = 'position' | 'gaze' | 'focalLength'
export interface CameraMotionDraft {
  cameraId: string; sourceKey: string; property: CameraMotionProperty
  status: 'idle' | 'recording' | 'paused' | 'reviewing' | 'optimizing'
  frames: StageStateKeyframe[]; pinnedIds: string[]; selected: string; review?: CameraMotionReview
  original?: CameraMotionNativeCandidate; preview?: CameraMotionNativeCandidate; pose?: StageCameraObject; poseTime?: number
  needsSave?: boolean; message?: string; controller?: AbortController; reviewId?: string
}
const drafts = new WeakMap<object, CameraMotionDraft>()
const listeners = new Set<() => void>(); let revision = 0
export function subscribeCameraMotion(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener) } }
export function cameraMotionRevision(): number { return revision }
function publish(): void { revision++; listeners.forEach(listener => listener()) }
export function cameraMotionDraft(projectId: string): CameraMotionDraft | undefined { const instance = findCameraStageProjectInstance(projectId); return instance ? drafts.get(instance.store) : undefined }
function requireDraft(projectId: string): CameraMotionDraft {
  const draft = cameraMotionDraft(projectId)
  if (!draft || draft.sourceKey !== cameraMotionSourceKey(cameraStageProjectStore(projectId).getState())) throw new Error('场景已变化，请重新开始示范。')
  return draft
}
export function startCameraMotion(projectId: string, cameraId: string, property: CameraMotionProperty = 'position'): void {
  const store = cameraStageProjectStore(projectId), state = store.getState()
  const old = drafts.get(store)
  if (old?.needsSave) throw new Error('请先重试保存。')
  old?.controller?.abort()
  if (!state.objects.some(object => object.id === cameraId && object.type === 'camera')) throw new Error('请选择一个机位。')
  drafts.set(store, { cameraId, property, sourceKey: cameraMotionSourceKey(state), status: 'recording', frames: [], pinnedIds: [], selected: 'original' })
  publish()
}
export function setCameraMotionProperty(projectId: string, property: CameraMotionProperty): void {
  const draft = requireDraft(projectId); if (draft.needsSave) throw new Error('请先重试保存。'); draft.property = property; publish()
}
export function setCameraMotionStatus(projectId: string, status: 'recording' | 'paused' | 'reviewing'): void {
  const draft = requireDraft(projectId); draft.status = status; draft.pose = undefined; publish()
}
/** Only viewport camera manipulation calls this. Scrubbing and native playback never append samples. */
type CameraGesture = { position?: StageVec3; rotation?: StageVec3; lookAtTarget?: StageVec3; fov?: number }
export function demonstrateCameraMotion(projectId: string, cameraId: string, patch: CameraGesture): boolean {
  try { return captureCameraMotion(projectId, cameraId, patch) }
  catch (error) {
    const draft = cameraMotionDraft(projectId)
    const message = error instanceof Error ? error.message : '请重新开始示范。'
    if (draft && draft.message !== message) {
      draft.message = message
      logger.error('机位示范采集失败', error, { event: 'camera_stage.motion.capture.failed', context: { projectId, cameraId } })
      publish()
    }
    return true
  }
}
function captureCameraMotion(projectId: string, cameraId: string, patch: CameraGesture): boolean {
  const draft = cameraMotionDraft(projectId)
  if (!draft || draft.cameraId !== cameraId || draft.status !== 'recording') return false
  const state = cameraStageProjectStore(projectId).getState(); requireDraft(projectId)
  const presentedTime = state.playback.playing ? readCameraStagePlaybackRuntime().time : state.playback.currentTime
  const time = Math.round(presentedTime * state.animation.fps) / state.animation.fps
  const objects = applyAnimationAtTime(state.objects, state.animation, time)
  const base = objects.find((object): object is StageCameraObject => object.id === cameraId && object.type === 'camera')!
  const camera = structuredClone(draft.poseTime === time ? draft.pose ?? base : base)
  if (draft.property === 'position' && patch.position) {
    camera.transform.position = { ...patch.position }
    camera.transform.rotation = rotationFromPositionAndTarget(camera.transform.position, resolveCameraLookAtTarget(camera, objects), camera.transform.rotation.z)
  }
  if (draft.property === 'gaze' && patch.rotation) {
    camera.transform.rotation = { ...patch.rotation }
    const target = resolveCameraLookAtTarget(base, objects), position = base.transform.position
    const distance = Math.hypot(target.x - position.x, target.y - position.y, target.z - position.z)
    camera.lookAt = { mode: 'manual', target: cameraTargetFromPositionRotation(camera.transform.position, patch.rotation, distance) }
  }
  if (draft.property === 'focalLength') {
    // Wheel/dolly movement expresses zoom; store optical FOV rather than translating the camera.
    const target = resolveCameraLookAtTarget(base, objects), origin = base.transform.position
    const distance = (position: StageVec3): number => Math.hypot(position.x - target.x, position.y - target.y, position.z - target.z)
    camera.fov = patch.fov ?? (patch.position ? 2 * Math.atan(Math.tan(base.fov * Math.PI / 360) * distance(patch.position) / distance(origin)) * 180 / Math.PI : camera.fov)
    if (!Number.isFinite(camera.fov) || camera.fov < 1 || camera.fov > 179) throw new Error('请减小变焦幅度。')
  }
  const existing = draft.frames.find(frame => frame.time === time)
  if (existing && draft.pinnedIds.includes(existing.id)) throw new Error('当前机位已钉住，请先解钉。')
  const frame = createStateKeyframe(objects.map(object => object.id === cameraId ? camera : object), '机位示范', cameraId, time)
  frame.id = existing?.id ?? frame.id
  draft.frames = [...draft.frames.filter(value => value.time !== time), frame].sort((a, b) => a.time - b.time)
  draft.pose = camera; draft.poseTime = time; draft.review = undefined; draft.preview = undefined; draft.selected = 'original'; draft.message = undefined; publish()
  return true
}
export function pinCameraMotion(projectId: string, unpinId?: string): void {
  const draft = requireDraft(projectId), state = cameraStageProjectStore(projectId).getState()
  if (draft.needsSave) throw new Error('请先重试保存。')
  const frame = draft.frames.find(value => Math.abs(value.time - state.playback.currentTime) < .5 / state.animation.fps)
  if (unpinId) draft.pinnedIds = draft.pinnedIds.filter(id => id !== unpinId)
  else if (frame && !draft.pinnedIds.includes(frame.id)) draft.pinnedIds.push(frame.id)
  else if (!frame) throw new Error('请先在当前位置摆放机位。')
  draft.review = undefined; draft.preview = undefined; draft.selected = 'original'; publish()
}
export function cameraMotionRequest(state: CameraStageState, cameraId: string, stateKeyframeIds: string[], pinnedIds: string[] = []): CameraMotionCandidateRequest {
  const camera = state.objects.find((object): object is StageCameraObject => object.id === cameraId && object.type === 'camera')
  if (!camera) throw new Error('请选择一个机位。')
  const target = resolveCameraLookAtTarget(camera, state.objects), position = camera.transform.position
  return { cameraId, stateKeyframeIds, pinnedStateKeyframeIds: pinnedIds, sceneScale: Math.max(.001, Math.hypot(position.x - target.x, position.y - target.y, position.z - target.z)), orbitDegrees: 90, orbitDirection: 'cw', dollyDistanceRatio: .5, pauseRatio: .25 }
}
export async function organizeCameraMotion(projectId: string, cameraId?: string, stateKeyframeIds?: string[]): Promise<CameraMotionReview> {
  const state = cameraStageProjectStore(projectId).getState()
  let draft = cameraMotionDraft(projectId)
  if (cameraId) {
    if (draft?.needsSave) throw new Error('请先重试保存。')
    if (draft && ['recording', 'paused', 'optimizing'].includes(draft.status)) throw new Error('请先结束当前示范或整理。')
    draft = { cameraId, sourceKey: cameraMotionSourceKey(state), property: 'position', frames: [], pinnedIds: [], status: 'reviewing', selected: 'original' }
    drafts.set(cameraStageProjectStore(projectId), draft)
  }
  draft = requireDraft(projectId)
  if (draft.needsSave) throw new Error('请先重试保存。')
  draft.controller?.abort(); const controller = new AbortController(); draft.controller = controller
  const original = draft.frames.length ? { stateKeyframes: [...state.stateKeyframes.filter(value => !draft.frames.some(frame => frame.time === value.time)), ...structuredClone(draft.frames)].sort((a, b) => a.time - b.time), animation: state.animation } : { stateKeyframes: state.stateKeyframes, animation: state.animation }
  original.animation = compileStateKeyframesToAnimation(original.stateKeyframes, state.objects)
  const ids = stateKeyframeIds ?? (draft.frames.length ? original.stateKeyframes.filter(value => value.time >= draft.frames[0].time && value.time <= draft.frames.at(-1)!.time).map(value => value.id) : state.stateKeyframes.map(value => value.id))
  const request = cameraMotionRequest(state, draft.cameraId, ids, draft.pinnedIds)
  draft.status = 'optimizing'; draft.message = undefined; publish()
  try {
    const review = await prepareCameraStageMotion(projectId, request, { cancelled: () => controller.signal.aborted }, original)
    controller.signal.throwIfAborted(); requireDraft(projectId)
    draft.review = review; draft.reviewId = crypto.randomUUID(); draft.original = original; draft.status = 'reviewing'
    draft.selected = review.candidates[0]?.id ?? 'original'
    draft.preview = draft.selected === 'original' ? original : readCameraStageMotionPreview(projectId, review, draft.selected)
    draft.message = review.candidates.length ? undefined : review.unavailable[0]?.message
    publish(); return review
  } catch (error) { draft.status = 'reviewing'; publish(); throw error }
}
export function previewCameraMotion(projectId: string, candidateId: string): void {
  const draft = requireDraft(projectId)
  if (!draft.review || draft.needsSave) throw new Error('请先整理机位。')
  draft.preview = candidateId === 'original' ? draft.original : readCameraStageMotionPreview(projectId, draft.review, candidateId)
  draft.selected = candidateId; publish()
}
export async function applyCameraMotion(projectId: string, candidateId?: string): Promise<Awaited<ReturnType<typeof applyCameraStageMotionCandidate>>> {
  const draft = requireDraft(projectId)
  if (!draft.review) throw new Error('请先整理机位。')
  const selected = candidateId ?? draft.selected
  draft.preview = undefined; draft.pose = undefined; publish()
  const result = await applyCameraStageMotionCandidate(projectId, draft.review, selected)
  draft.sourceKey = cameraMotionSourceKey(cameraStageProjectStore(projectId).getState())
  draft.needsSave = !result.saved; draft.selected = selected; draft.status = 'reviewing'
  if (result.saved) { draft.review = undefined; draft.original = undefined; draft.frames = []; draft.pinnedIds = [] }
  publish(); return result
}
export function clearCameraMotionPreview(projectId: string): void {
  const draft = cameraMotionDraft(projectId)
  if (draft) { draft.controller?.abort(); draft.preview = undefined; draft.pose = undefined; if (draft.status === 'optimizing') draft.status = 'reviewing'; publish() }
}
export function cameraMotionPreview(state: CameraStageState): { objects: StageObject[]; animation: CameraStageState['animation'] } | undefined {
  if (!state.currentProjectId) return undefined
  const draft = cameraMotionDraft(state.currentProjectId)
  if (!draft || draft.sourceKey !== cameraMotionSourceKey(state)) return undefined
  const presentedTime = state.playback.playing ? readCameraStagePlaybackRuntime().time : state.playback.currentTime
  const frameTime = Math.round(presentedTime * state.animation.fps) / state.animation.fps
  if (draft.pose && draft.status === 'recording' && draft.poseTime === frameTime) return { objects: state.objects.map(object => object.id === draft.cameraId ? draft.pose! : object), animation: state.animation }
  if (draft.preview) return { objects: applyAnimationAtTime(state.objects, draft.preview.animation, state.playback.currentTime), animation: draft.preview.animation }
  return undefined
}
