import { beforeEach, expect, it } from 'vitest'
import { loadCameraStageTestProject, cameraStageTestDocuments } from '@/tests/cameraStageProjectFixture'
import { createDefaultAnimation } from '../domain/animationTypes'
import { createCameraObject, createDefaultSceneSettings, pickDefaultColor } from '../domain/sceneDefaults'
import { createStateKeyframe } from '../domain/stateKeyframeTypes'
import { useCameraStageStore } from '../store/cameraStageStore'
import { startCameraMotion, demonstrateCameraMotion, setCameraMotionStatus, organizeCameraMotion, previewCameraMotion, applyCameraMotion, cameraMotionDraft, cameraMotionPreview, pinCameraMotion } from './cameraMotionDraft'
import { restoreCameraStageUndo } from './cameraStageUndo'
import { createApplicationHarness } from '@/tests/applicationHarness'

const projectId = 'camera-intent'
let cameraId: string
beforeEach(async () => {
  const camera = createCameraObject('机位', pickDefaultColor(0)); cameraId = camera.id
  camera.transform.position = { x: 0, y: 2, z: 10 }; camera.lookAt = { mode: 'manual', target: { x: 0, y: 2, z: 0 } }
  const start = createStateKeyframe([camera], '开始', cameraId, 0), end = createStateKeyframe([camera], '结束', cameraId, 2)
  end.objectStates[cameraId].transform.position.z = 6
  await loadCameraStageTestProject({ objects: [camera], activeCameraId: cameraId, animation: createDefaultAnimation(), sceneSettings: createDefaultSceneSettings(), stateKeyframes: [start, end] }, { id: projectId, name: '超级关键帧' })
  useCameraStageStore.temporal.getState().clear()
})
it('拖时间指针无动作，视口移动只写临时示范，原稿/候选预览不入正式历史', async () => {
  const before = structuredClone(useCameraStageStore.getState().stateKeyframes)
  startCameraMotion(projectId, cameraId)
  useCameraStageStore.getState().seek(1)
  expect(cameraMotionDraft(projectId)!.frames).toHaveLength(0)
  demonstrateCameraMotion(projectId, cameraId, { position: { x: 0, y: 2, z: 8 } })
  useCameraStageStore.getState().seek(2)
  demonstrateCameraMotion(projectId, cameraId, { position: { x: 0, y: 2, z: 5 } })
  setCameraMotionStatus(projectId, 'reviewing')
  await organizeCameraMotion(projectId)
  for (const candidate of ['original', 'smooth', 'orbit', 'dolly-hold']) {
    previewCameraMotion(projectId, candidate); useCameraStageStore.getState().seek(1.5)
    expect(cameraMotionPreview(useCameraStageStore.getState())).toBeDefined()
    expect(useCameraStageStore.getState().stateKeyframes).toEqual(before)
    expect(useCameraStageStore.temporal.getState().pastStates).toHaveLength(0)
  }
  const result = await applyCameraMotion(projectId, 'smooth')
  expect(result.saved).toBe(true); expect(useCameraStageStore.temporal.getState().pastStates).toHaveLength(1)
  await restoreCameraStageUndo(result.undoToken)
  expect(useCameraStageStore.getState().stateKeyframes).toEqual(before)
})
it('焦距示范只改光学量，视线示范能编译，场景变化后旧候选拒绝', async () => {
  startCameraMotion(projectId, cameraId, 'focalLength')
  demonstrateCameraMotion(projectId, cameraId, { fov: 40 }); useCameraStageStore.getState().seek(2)
  demonstrateCameraMotion(projectId, cameraId, { fov: 30 })
  expect(cameraMotionDraft(projectId)!.frames[0].objectStates[cameraId].fov).toBe(40)
  setCameraMotionStatus(projectId, 'reviewing'); await organizeCameraMotion(projectId)
  startCameraMotion(projectId, cameraId, 'gaze'); useCameraStageStore.getState().seek(0)
  demonstrateCameraMotion(projectId, cameraId, { rotation: { x: 0, y: 0, z: 0 } }); useCameraStageStore.getState().seek(2)
  demonstrateCameraMotion(projectId, cameraId, { rotation: { x: 0, y: 20, z: 0 } })
  setCameraMotionStatus(projectId, 'reviewing'); const review = await organizeCameraMotion(projectId)
  expect(review.candidates.some(candidate => candidate.id === 'smooth')).toBe(true)
  useCameraStageStore.getState().updateObject(cameraId, { name: '变化' })
  expect(() => previewCameraMotion(projectId, 'smooth')).toThrow('已变化')
  await expect(applyCameraMotion(projectId, 'smooth')).rejects.toThrow('已变化')
})
it('正式助手发现/整理/应用同源候选并可一步撤销，不依赖打开界面', async () => {
  const app = createApplicationHarness(), documentRef = { kind: 'camera_stage.document', id: projectId }
  const original = structuredClone(useCameraStageStore.getState().stateKeyframes)
  try {
    const result = await app.requireResult('organize_camera_stage_motion', { documentRef, cameraRef: { kind: 'camera_stage.camera', id: `${projectId}:${cameraId}` }, stateKeyframeRefs: original.map(frame => ({ kind: 'camera_stage.state_keyframe', id: `${projectId}:${frame.id}` })) })
    expect(useCameraStageStore.temporal.getState().pastStates).toHaveLength(0)
    const baseline = await app.read(documentRef)
    const stale = await app.call('apply_camera_stage_motion_candidate', { documentRef, baseRevision: (result.baseRevision as number) + 1, reviewId: result.reviewId, candidateId: 'orbit' })
    expect(stale.ok).toBe(false)
    expect(useCameraStageStore.getState().stateKeyframes).toEqual(original)
    const applied = await app.requireResult('apply_camera_stage_motion_candidate', { documentRef, baseRevision: result.baseRevision, reviewId: result.reviewId, candidateId: 'orbit' }, baseline.revisions as Record<string, number>)
    expect(applied.saved).toBe(true)
    expect(applied.baseRevision).toBeGreaterThan(result.baseRevision as number)
    expect(useCameraStageStore.getState().stateKeyframes).not.toEqual(original)
    expect(useCameraStageStore.temporal.getState().pastStates).toHaveLength(1)
    await restoreCameraStageUndo(applied.undoToken as string)
    expect(useCameraStageStore.getState().stateKeyframes).toEqual(original)
  } finally { app.dispose() }
})
it('保存失败保留同一次应用，钉点不覆盖恢复句柄，重试只保存', async () => {
  await organizeCameraMotion(projectId, cameraId)
  cameraStageTestDocuments()!.failSaves = 1
  const first = await applyCameraMotion(projectId, 'orbit')
  expect(first.saved).toBe(false)
  const applied = useCameraStageStore.getState().stateKeyframes
  expect(() => pinCameraMotion(projectId)).toThrow('重试保存')
  const retry = await applyCameraMotion(projectId, 'orbit')
  expect(retry).toEqual({ undoToken: first.undoToken, saved: true })
  expect(useCameraStageStore.getState().stateKeyframes).toBe(applied)
  expect(useCameraStageStore.temporal.getState().pastStates).toHaveLength(1)
})
it('视口采集遇到钉住点保留原姿态，并通过共享面板报告失败', () => {
  startCameraMotion(projectId, cameraId)
  useCameraStageStore.getState().seek(.01)
  demonstrateCameraMotion(projectId, cameraId, { position: { x: 1, y: 2, z: 9 } })
  expect(cameraMotionPreview(useCameraStageStore.getState())?.objects.find(object => object.id === cameraId)?.transform.position.x).toBe(1)
  pinCameraMotion(projectId)
  const original = structuredClone(cameraMotionDraft(projectId)!.frames)
  expect(demonstrateCameraMotion(projectId, cameraId, { position: { x: 3, y: 2, z: 8 } })).toBe(true)
  expect(cameraMotionDraft(projectId)!.message).toContain('已钉住')
  expect(cameraMotionDraft(projectId)!.frames).toEqual(original)
  expect(useCameraStageStore.temporal.getState().pastStates).toHaveLength(0)
})
