import { beforeEach, describe, expect, it } from 'vitest'
import { cameraStageTestDocuments, loadCameraStageTestProject } from '@/tests/cameraStageProjectFixture'
import { createDefaultAnimation } from '../domain/animationTypes'
import { createCameraObject, createDefaultSceneSettings, createPrimitiveObject, pickDefaultColor } from '../domain/sceneDefaults'
import { createStateKeyframe } from '../domain/stateKeyframeTypes'
import { useCameraStageStore } from '../store/cameraStageStore'
import { applyCameraStageMotionCandidate, prepareCameraStageMotion } from './cameraMotionService'
import { cameraStagePose3D, cameraMotionIdentity, compileCameraMotionCandidates, evaluateCameraMotionCandidate, type CameraMotionCandidateRequest } from './cameraMotionCandidates'
import { cameraPoseError } from '@/core/creativeIntent/cameraAdapter'
import { restoreCameraStageUndo } from './cameraStageUndo'
import { sceneFromDocumentContent } from '../domain/sceneSerialization'
import { cameraStageProjectStore } from './cameraStageProjectRuntime'
import { createCameraPresetPath } from '../domain/spatialPath'

let request: CameraMotionCandidateRequest
beforeEach(async () => {
  const camera = createCameraObject('相机', pickDefaultColor(0))
  camera.transform.position = { x: 0, y: 2, z: 10 }
  camera.lookAt = { mode: 'manual', target: { x: 0, y: 2, z: 0 } }
  const subject = createPrimitiveObject('sphere', '主体', pickDefaultColor(1))
  const objects = [camera, subject]
  const start = createStateKeyframe(objects, '开始', camera.id, 0)
  const end = createStateKeyframe(objects, '结束', camera.id, 2)
  end.objectStates[camera.id].transform.position.z = 6
  end.objectStates[camera.id].fov = 35
  await loadCameraStageTestProject({ objects, activeCameraId: camera.id, animation: createDefaultAnimation(), sceneSettings: createDefaultSceneSettings(), stateKeyframes: [start, end] }, { id: 'candidate-project', name: '候选测试' })
  request = { cameraId: camera.id, stateKeyframeIds: [start.id, end.id], pinnedStateKeyframeIds: [start.id], sceneScale: 10, orbitDegrees: 90, orbitDirection: 'cw', dollyDistanceRatio: .5, pauseRatio: .25 }
  useCameraStageStore.temporal.getState().clear()
})

describe('cameraStage 3D 原生候选', () => {
  it('three candidates use native paths and FOV; the hold preserves the entire camera pose', async () => {
    const state = useCameraStageStore.getState()
    const result = compileCameraMotionCandidates(state, request, await cameraMotionIdentity(state, request))
    expect(result.candidates.map(c => c.id)).toEqual(['smooth', 'orbit', 'dolly-hold'])
    const initial = state.objects.find(o => o.id === request.cameraId)!
    if (initial.type !== 'camera') throw new Error('camera missing')
    const originalPose = cameraStagePose3D(initial, state.objects)
    const hold = result.candidates.find(c => c.id === 'dolly-hold')!
    for (const frame of [0, 3, 9, 14]) expect(cameraPoseError(originalPose, evaluateCameraMotionCandidate(state, request.cameraId, hold.native, frame), 10)).toEqual({ positionRatio: 0, targetRatio: 0, angleDegrees: 0, fovDegrees: 0 })
    const orbit = result.candidates.find(c => c.id === 'orbit')!
    for (let frame = 0; frame <= 60; frame++) {
      const pose = evaluateCameraMotionCandidate(state, request.cameraId, orbit.native, frame)
      expect(Math.abs(Math.hypot(pose.position.x, pose.position.z) - 10) / 10).toBeLessThan(.001)
      expect(pose.target).toEqual(originalPose.target)
    }
    expect(evaluateCameraMotionCandidate(state, request.cameraId, hold.native, 60).fovDegrees).toBe(35)
    expect(state.stateKeyframes[1].objectStates[request.cameraId].transform.position.z).toBe(6)
  })

  it('end pin rejects orbit and push-in but preserves smooth candidate', async () => {
    const review = await prepareCameraStageMotion('candidate-project', { ...request, pinnedStateKeyframeIds: request.stateKeyframeIds })
    expect(review.candidates.map(c => c.id)).toEqual(['smooth'])
    expect(review.unavailable).toHaveLength(2)
    expect(review.unavailable.every(c => c.code === 'camera-pin-conflict')).toBe(true)
  })

  it('one native commit saves/reopens and undo restores all scene states; unrelated objects stay unchanged', async () => {
    const original = structuredClone(useCameraStageStore.getState().stateKeyframes)
    const review = await prepareCameraStageMotion('candidate-project', request)
    expect(useCameraStageStore.temporal.getState().pastStates).toHaveLength(0)
    const result = await applyCameraStageMotionCandidate('candidate-project', review, 'orbit')
    expect(result.saved).toBe(true)
    expect(useCameraStageStore.temporal.getState().pastStates).toHaveLength(1)
    const current = useCameraStageStore.getState()
    const subject = current.objects.find(o => o.type === 'primitive')!
    expect(current.stateKeyframes.map(k => k.objectStates[subject.id])).toEqual(original.map(k => k.objectStates[subject.id]))
    expect(cameraStageTestDocuments()!.writes).toBe(1)
    const persisted = sceneFromDocumentContent((await cameraStageTestDocuments()!.readDocument({ id: 'candidate-project' })).content)
    expect(persisted.stateKeyframes).toEqual(current.stateKeyframes)
    await restoreCameraStageUndo(result.undoToken)
    expect(useCameraStageStore.getState().stateKeyframes).toEqual(original)
  })

  it('source edits and cross-project reviews reject without writing', async () => {
    const review = await prepareCameraStageMotion('candidate-project', request)
    useCameraStageStore.getState().updateStateKeyframeName(request.stateKeyframeIds[0], '改名')
    await expect(applyCameraStageMotionCandidate('candidate-project', review, 'orbit')).rejects.toThrow('变化')
    await expect(applyCameraStageMotionCandidate('candidate-project', { ...review }, 'orbit')).rejects.toThrow('失效')
    expect(cameraStageTestDocuments()!.writes).toBe(0)
  })

  it('save failure retains applied state and retries only save with the same undo receipt', async () => {
    const docs = cameraStageTestDocuments()!
    docs.failSaves = 1
    const review = await prepareCameraStageMotion('candidate-project', request)
    const first = await applyCameraStageMotionCandidate('candidate-project', review, 'orbit')
    expect(first.saved).toBe(false)
    const applied = useCameraStageStore.getState().stateKeyframes
    const second = await applyCameraStageMotionCandidate('candidate-project', review, 'orbit')
    expect(second).toMatchObject({ undoToken: first.undoToken, saved: true })
    expect(useCameraStageStore.getState().stateKeyframes).toBe(applied)
    expect(useCameraStageStore.temporal.getState().pastStates).toHaveLength(1)
  })

  it('a selected range cannot move the next unselected transition endpoint', async () => {
    const store = cameraStageProjectStore('candidate-project')
    const state = store.getState()
    const next = structuredClone(state.stateKeyframes[1])
    next.id = 'outside'; next.time = 4
    store.setState({ stateKeyframes: [...state.stateKeyframes, next] })
    const review = await prepareCameraStageMotion('candidate-project', request)
    expect(review.candidates.map(c => c.id)).toEqual(['smooth'])
    await applyCameraStageMotionCandidate('candidate-project', review, 'smooth')
    expect(store.getState().stateKeyframes[2]).toEqual(next)
  })

  it('stationary position with changing FOV survives native compilation and a temporal undo', async () => {
    const store = cameraStageProjectStore('candidate-project')
    const frames = structuredClone(store.getState().stateKeyframes)
    frames[1].objectStates[request.cameraId].transform.position = { ...frames[0].objectStates[request.cameraId].transform.position }
    store.setState({ stateKeyframes: frames })
    store.temporal.getState().clear()
    const review = await prepareCameraStageMotion('candidate-project', request)
    await applyCameraStageMotionCandidate('candidate-project', review, 'smooth')
    const state = store.getState()
    const fov = state.animation.tracks.find(track => track.objectId === request.cameraId && track.propertyPath === 'fov')!
    expect(fov.keyframes.map(key => key.value)).toEqual([50, 35])
    store.temporal.getState().undo()
    expect(store.getState().stateKeyframes).toEqual(frames)
  })

  it('smooth path crossing the target is rejected between valid endpoint poses', async () => {
    const store = cameraStageProjectStore('candidate-project')
    const frames = structuredClone(store.getState().stateKeyframes)
    frames[1].objectStates[request.cameraId].transform.position.z = -10
    store.setState({ stateKeyframes: frames })
    const review = await prepareCameraStageMotion('candidate-project', request)
    expect(review.unavailable).toContainEqual(expect.objectContaining({ family: 'smooth', code: 'camera-unrepresentable' }))
    expect(review.candidates.map(c => c.id)).toEqual(['orbit', 'dolly-hold'])
  })

  it('C01 existing 3D arc and its pause remain native when smoothing', async () => {
    const store = cameraStageProjectStore('candidate-project')
    const frames = structuredClone(store.getState().stateKeyframes)
    const generated = createCameraPresetPath({ kind: 'orbit', degrees: 90, direction: 'cw' }, frames[0].objectStates[request.cameraId].transform.position, { x: 0, y: 2, z: 0 })
    frames[1].objectStates[request.cameraId].transform.position = generated.endPosition
    frames[0].transition.perObject[request.cameraId] = { spatialPath: generated.path, delay: .5, speedPreset: 'uniform' }
    store.setState({ stateKeyframes: frames })
    const review = await prepareCameraStageMotion('candidate-project', request)
    await applyCameraStageMotionCandidate('candidate-project', review, 'smooth')
    expect(store.getState().stateKeyframes[0].transition.perObject[request.cameraId]).toEqual({ spatialPath: generated.path, delay: .5, speedPreset: 'easeInOut' })
  })
})
