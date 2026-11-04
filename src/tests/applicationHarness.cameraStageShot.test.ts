import { expect, it } from 'vitest'

import { cameraStageApplicationService } from '@/features/cameraStage/application/cameraStageApplicationService'
import { createDefaultAnimation } from '@/features/cameraStage/domain/animationTypes'
import { createCameraObject, createCharacterObject, createDefaultSceneSettings, pickDefaultColor } from '@/features/cameraStage/domain/sceneDefaults'
import { createStateKeyframe } from '@/features/cameraStage/domain/stateKeyframeTypes'
import { createApplicationHarness } from './applicationHarness'
import { loadCameraStageTestProject } from './cameraStageProjectFixture'

interface ShotResult {
  shots: Array<{
    cameraId: string
    position: { x: number; y: number; z: number }
    axis: { screenLeft: string; screenRight: string } | null
    composition: { subjects: Array<{ name: string; shotSize: string; keyVisible: boolean; horizontal: string }> }
  }>
  stateKeyframeId: string | null
  createdStateKeyframe: boolean
}

/** 经正式公共入口（与 MCP 同一条执行链）：正反打一对记进新时间点，读回与场景观察给出同一套构图。 */
it('正反打一对按意图记进时间点，两台机位守在轴线同一侧，观察场景读得到构图', async () => {
  const first = createCameraObject('正打', pickDefaultColor(0))
  const second = createCameraObject('反打', pickDefaultColor(1))
  first.transform.position = { x: 0, y: 1.6, z: 6 }
  const a = createCharacterObject('甲', pickDefaultColor(2))
  a.transform.position = { x: -0.6, y: 0, z: 0 }
  a.transform.rotation = { x: 0, y: 90, z: 0 }
  const b = createCharacterObject('乙', pickDefaultColor(3))
  b.transform.position = { x: 0.6, y: 0, z: 0 }
  b.transform.rotation = { x: 0, y: -90, z: 0 }
  const objects = [first, second, a, b]
  const documentId = 'shot-reverse-scene'
  await loadCameraStageTestProject({ objects, activeCameraId: first.id, animation: createDefaultAnimation(),
    sceneSettings: createDefaultSceneSettings(), stateKeyframes: [createStateKeyframe(objects, '起点', 0)] }, { id: documentId, name: '正反打' })
  const app = createApplicationHarness()
  try {
    const data = await app.requireResult('compose_camera_stage_shot', {
      documentId, cameraId: first.id, reverseCameraId: second.id, relation: 'reverse_pair',
      subjects: [{ objectId: a.id }, { objectId: b.id }], at: { time: 2 },
    }) as unknown as ShotResult
    expect(data.createdStateKeyframe).toBe(true)
    const [forward, reverse] = data.shots
    expect(forward.composition.subjects.find((subject) => subject.name === '乙')).toMatchObject({ shotSize: 'close', keyVisible: true })
    expect(reverse.composition.subjects.find((subject) => subject.name === '甲')).toMatchObject({ shotSize: 'close', keyVisible: true })
    // 同一侧轴线：两个镜头里甲都在画面同一边。
    expect(forward.axis?.screenLeft).toBe(reverse.axis?.screenLeft)

    const snapshot = await cameraStageApplicationService.readSnapshot(documentId)
    const stateKeyframe = snapshot.stateKeyframes.find((item) => item.id === data.stateKeyframeId)!
    expect(stateKeyframe.time).toBe(2)
    for (const shot of data.shots) {
      for (const axis of ['x', 'y', 'z'] as const) expect(stateKeyframe.objectStates[shot.cameraId].transform.position[axis]).toBeCloseTo(shot.position[axis], 3)
    }
    // 0 秒那张卡里的机位不动。
    expect(snapshot.stateKeyframes.find((item) => item.time === 0)!.objectStates[first.id].transform.position).toEqual({ x: 0, y: 1.6, z: 6 })

    const observed = await app.requireResult('observe_camera_stage_scene', { documentId }) as {
      scene: { objects: Array<{ id: string; composition?: { subjects: Array<{ name: string; shotSize: string }> } }> }
    }
    const reading = observed.scene.objects.find((object) => object.id === first.id)!.composition!
    expect(reading.subjects.find((subject) => subject.name === '乙')?.shotSize).toBe('close')
  } finally { app.dispose() }
})
