import { expect, it } from 'vitest'

import { cameraStageApplicationService } from '@/features/cameraStage/application/cameraStageApplicationService'
import { createDefaultAnimation } from '@/features/cameraStage/domain/animationTypes'
import { rotationFromPositionAndTarget } from '@/features/cameraStage/domain/cameraUtils'
import { createCameraObject, createDefaultSceneSettings, createPrimitiveObject, pickDefaultColor } from '@/features/cameraStage/domain/sceneDefaults'
import { createStateKeyframe } from '@/features/cameraStage/domain/stateKeyframeTypes'
import { createApplicationHarness } from './applicationHarness'
import { loadCameraStageTestProject } from './cameraStageProjectFixture'

/** 经正式公共入口（与 MCP 同一条执行链）：连续运镜的平滑度证据，以及写注视点后读回的旋转角。 */
it('连续运镜结果带平滑度证据；改注视点后读回的朝向对准新目标', async () => {
  const camera = createCameraObject('机位', pickDefaultColor(0))
  camera.transform.position = { x: 0, y: 1.6, z: 8 }
  camera.lookAt = { mode: 'manual', target: { x: 0, y: 1, z: 0 } }
  const subject = createPrimitiveObject('sphere', '主体', pickDefaultColor(1))
  const documentId = 'smooth-move-scene'
  await loadCameraStageTestProject({ objects: [camera, subject], activeCameraId: camera.id, animation: createDefaultAnimation(),
    sceneSettings: createDefaultSceneSettings(), stateKeyframes: [createStateKeyframe([camera, subject], '起点', 0)] }, { id: documentId, name: '连续运镜' })
  const app = createApplicationHarness()
  try {
    const base = { documentId, cameraId: camera.id, targetObjectId: subject.id }
    await app.requireResult('apply_camera_stage_camera_move', { ...base, move: { kind: 'dollyIn', distanceRatio: 0.6 }, duration: 6, rig: 'dolly' })
    const second = await app.requireResult('apply_camera_stage_camera_move', { ...base, move: { kind: 'crane', height: 3 }, duration: 7, continuity: 'smooth' }) as {
      evidence: Array<{ data?: { smoothness?: { joints: Array<{ time: number; velocityJump: number }>; stops: number[]; peakSpeed: number; timing?: { rig: string } } } }>
    }
    const smoothness = second.evidence.map((item) => item.data?.smoothness).find(Boolean)
    expect(smoothness?.timing?.rig).toBe('dolly')
    expect(smoothness?.stops).toEqual([])
    expect(smoothness?.joints.map((joint) => joint.time)).toEqual([6])
    expect(smoothness!.joints[0].velocityJump).toBeLessThan(0.01 * smoothness!.peakSpeed)

    const ref = { kind: 'camera_stage.camera', id: `${documentId}:${camera.id}` }
    const target = { x: 3, y: 1, z: -2 }
    const changed = await app.change(ref, { 'camera_stage.camera.look_at_target': target })
    expect(changed.ok).toBe(true)
    const read = await app.read(ref, ['camera_stage.camera.transform.position', 'camera_stage.camera.transform.rotation', 'camera_stage.camera.rig'])
    const values = (read as { properties: Record<string, unknown> }).properties
    const position = values['camera_stage.camera.transform.position'] as { x: number; y: number; z: number }
    const rotation = values['camera_stage.camera.transform.rotation'] as { x: number; y: number; z: number }
    const expected = rotationFromPositionAndTarget(position, target)
    // 轨道车自带注视跟随滞后，停稳时只剩极小的余量。
    expect(rotation.x).toBeCloseTo(expected.x, 2)
    expect(rotation.y).toBeCloseTo(expected.y, 2)
    expect(values['camera_stage.camera.rig']).toBe('dolly')
  } finally { app.dispose() }
})

/** 新放置的对象在每一张状态关键帧都在放置位置，播放时不会从默认位置滑过来。 */
it('放置新对象同步进全部状态关键帧', async () => {
  const camera = createCameraObject('机位', pickDefaultColor(0))
  const documentId = 'place-sync-scene'
  await loadCameraStageTestProject({ objects: [camera], activeCameraId: camera.id, animation: createDefaultAnimation(),
    sceneSettings: createDefaultSceneSettings(),
    stateKeyframes: [createStateKeyframe([camera], '起点', 0), createStateKeyframe([camera], '终点', 2)] }, { id: documentId, name: '放置同步' })
  const app = createApplicationHarness()
  try {
    const placed = await app.requireResult('place_camera_stage_object', {
      documentId, objectType: 'primitive', primitiveKind: 'sphere', reusePolicy: 'require_new',
      placement: { position: { x: 3, y: 0, z: 0 }, allowOverlap: true },
    })
    const objectId = (placed.resultRefs as Array<{ kind: string; id: string }>).find((ref) => ref.kind === 'camera_stage.object')!.id.slice(documentId.length + 1)
    const snapshot = await cameraStageApplicationService.readSnapshot(documentId)
    expect(snapshot.stateKeyframes.map((stateKeyframe) => stateKeyframe.objectStates[objectId]?.transform.position))
      .toEqual([{ x: 3, y: 0, z: 0 }, { x: 3, y: 0, z: 0 }])
  } finally { app.dispose() }
})
