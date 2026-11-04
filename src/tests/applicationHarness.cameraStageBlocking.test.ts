import { expect, it } from 'vitest'

import { cameraStageApplicationService } from '@/features/cameraStage/application/cameraStageApplicationService'
import { createDefaultAnimation } from '@/features/cameraStage/domain/animationTypes'
import { createCameraObject, createCharacterObject, createDefaultSceneSettings, createPrimitiveObject, pickDefaultColor } from '@/features/cameraStage/domain/sceneDefaults'
import { createStateKeyframe } from '@/features/cameraStage/domain/stateKeyframeTypes'
import { createApplicationHarness } from './applicationHarness'
import { loadCameraStageTestProject } from './cameraStageProjectFixture'

interface BlockingResult {
  beats: Array<{ kind: string; startTime: number; endTime: number; facing: number; position: { x: number; z: number }; route?: { crossings: unknown[]; detourPoints: number; gait: string } }>
}
interface FollowResult {
  samples: Array<{ time: number; shotSize: string | null; keyVisible: boolean }>
  occlusions: unknown[]
}
interface Observed {
  scene: {
    characters: Array<{ id: string; samples: Array<{ time: number; position: { x: number; z: number }; facing: number; action: { clip: string | null; kind: string; progress: number | null }; moving: boolean }> }>
    follows: Array<{ cameraId: string; subjectId: string }>
  }
}

/** 经正式公共入口（与 MCP 同一条执行链）：走到门口停下、转身挥手，摄像机跟拍，观察读回每一刻在哪、在做什么。 */
it('角色绕开挡路的箱子走到门口，转身朝摄像机挥手；跟拍全程看得到人；观察按时刻读回位置、朝向与动作', async () => {
  const camera = createCameraObject('跟拍机', pickDefaultColor(0))
  camera.transform.position = { x: 0, y: 1.6, z: 6 }
  const actor = createCharacterObject('甲', pickDefaultColor(1))
  actor.transform.rotation = { x: 0, y: 180, z: 0 }
  const door = createPrimitiveObject('box', '门', pickDefaultColor(2))
  door.transform.position = { x: 0, y: 1.1, z: -8 }
  door.transform.scale = { x: 1.2, y: 2.2, z: 0.2 }
  const crate = createPrimitiveObject('box', '箱子', pickDefaultColor(3))
  crate.transform.position = { x: 0, y: 0.5, z: -4 }
  crate.transform.scale = { x: 1.5, y: 1, z: 1.5 }
  const wide = createCameraObject('全景机', pickDefaultColor(4))
  const objects = [camera, actor, door, crate, wide]
  const documentId = 'blocking-scene'
  // 活动摄像机是另一台：新插的状态关键帧要沿用正在拍的机位，否则两卡机位不同成了硬切，人直接跳到门口。
  await loadCameraStageTestProject({ objects, activeCameraId: wide.id, animation: createDefaultAnimation(),
    sceneSettings: createDefaultSceneSettings(), stateKeyframes: [createStateKeyframe(objects, '起点', camera.id, 0)] }, { id: documentId, name: '走位' })
  const app = createApplicationHarness()
  try {
    const blocking = await app.requireResult('block_camera_stage_character', {
      documentId, characterId: actor.id,
      beats: [
        { kind: 'move', to: { objectId: door.id, side: 'front' } },
        { kind: 'turn', toward: { objectId: camera.id } },
        { kind: 'action', action: 'wave' },
        { kind: 'wait', duration: 1 },
        { kind: 'action', action: 'talk' },
      ],
    }) as unknown as BlockingResult
    const [move, turn, wave] = blocking.beats
    expect(move.route).toMatchObject({ crossings: [], gait: 'walk' })
    expect(move.route!.detourPoints).toBeGreaterThan(0)
    expect(move.position.z).toBeCloseTo(-8 + 0.1 + 0.85, 1)
    expect(Math.abs(turn.facing)).toBeLessThan(2)

    const follow = await app.requireResult('follow_camera_stage_character', {
      documentId, cameraId: camera.id, subjectId: actor.id, startTime: 0, endTime: move.endTime + 1, view: 'back', size: 'full',
    }) as unknown as FollowResult
    expect(follow.occlusions).toEqual([])
    expect(follow.samples.every((sample) => sample.keyVisible)).toBe(true)

    const middle = (move.startTime + move.endTime) / 2
    const observed = await app.requireResult('observe_camera_stage_scene', { documentId, times: [middle, wave.startTime + 0.6] }) as unknown as Observed
    const [walking, waving] = observed.scene.characters.find((item) => item.id === actor.id)!.samples
    expect(walking).toMatchObject({ moving: true, action: { kind: 'walk', clip: 'Walk_Loop' } })
    // 走在路线上而不是穿过箱子：经过箱子那一段时离箱子中心线至少半个箱宽加身宽。
    expect(Math.abs(walking.position.x) > 0.75 || Math.abs(walking.position.z + 4) > 0.75).toBe(true)
    expect(waving).toMatchObject({ moving: false, action: { clip: 'Wave' } })
    expect(observed.scene.follows).toEqual([expect.objectContaining({ cameraId: camera.id, subjectId: actor.id })])

    // 挥手中途插一张状态关键帧（另一台机位在这一刻定机位）：卡记下正在做的挥手，挥手接着做完，不被切回基础姿态。
    await app.requireResult('compose_camera_stage_shot', { documentId, cameraId: wide.id, subjects: [{ objectId: actor.id }], size: 'full', at: { time: wave.startTime + 1 } })
    const resumed = await app.requireResult('observe_camera_stage_scene', { documentId, times: [wave.startTime + 1.5] }) as unknown as Observed
    const later = resumed.scene.characters.find((item) => item.id === actor.id)!.samples[0]
    expect(later.action).toMatchObject({ clip: 'Wave' })
    expect(later.action.progress).toBeCloseTo(1.5 / 2.4, 1)

    const snapshot = await cameraStageApplicationService.readSnapshot(documentId)
    const arrival = snapshot.stateKeyframes.find((item) => Math.abs(item.time - move.endTime) < 1e-6)!
    expect(arrival.objectStates[actor.id].transform.position.z).toBeCloseTo(move.position.z, 2)
  } finally { app.dispose() }
})
