import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

import { cameraStageDocumentKind } from '@/core/documents/kinds/cameraStage'

import { createCameraObject, createDefaultSceneSettings, pickDefaultColor } from './sceneDefaults'
import { sceneFromDocumentContent, sceneToDocumentContent } from './sceneSerialization'
import { createStateKeyframe } from './stateKeyframeTypes'

describe('镜头参考文档内容', () => {
  it('保存状态关键帧和全景环境，不写派生动画与已退役字段', () => {
    const camera = createCameraObject('摄像机', pickDefaultColor(0))
    const stateKeyframe = createStateKeyframe([camera], '关键帧 1', camera.id, 0)
    const content = sceneToDocumentContent({
      objects: [camera],
      activeCameraId: camera.id,
      sceneSettings: {
        ...createDefaultSceneSettings(),
        sky: { ...createDefaultSceneSettings().sky, environmentImageUrl: '/media/panorama.png' },
      },
      stateKeyframes: [stateKeyframe],
    })
    expect(content.stateKeyframes).toHaveLength(1)
    expect(content).not.toHaveProperty('schemaVersion')
    expect(content).not.toHaveProperty('editorMode')
    expect(content).not.toHaveProperty('shots')
    expect(content).not.toHaveProperty('animation')
    expect(sceneFromDocumentContent(JSON.parse(JSON.stringify(content))).sceneSettings.sky.environmentImageUrl)
      .toBe('/media/panorama.png')
  })

  it('运镜设备与注视跟随滞后随摄像机保存；不认识的设备与非法滞后读入时去掉', () => {
    const camera = { ...createCameraObject('摄像机', pickDefaultColor(0)), rig: 'crane' as const, aimLag: 0.25 }
    const broken = { ...createCameraObject('摄像机2', pickDefaultColor(1)), rig: 'segway', aimLag: -1 }
    const content = JSON.parse(JSON.stringify(sceneToDocumentContent({
      objects: [camera, broken as unknown as typeof camera],
      activeCameraId: camera.id,
      sceneSettings: createDefaultSceneSettings(),
      stateKeyframes: [createStateKeyframe([camera], '关键帧 1', camera.id, 0)],
    })))
    const [restored, cleaned] = sceneFromDocumentContent(content).objects
    expect(restored).toMatchObject({ rig: 'crane', aimLag: 0.25 })
    expect(cleaned).not.toHaveProperty('rig')
    expect(cleaned).not.toHaveProperty('aimLag')
  })

  it('v5 文件升到 v6 内容不变（摄像机按不模拟设备播放）；v6 黄金样本的摄像机带运镜设备', () => {
    const sample = (version: number) => JSON.parse(fs.readFileSync(`tests/fixtures/persistence/document.camera_stage/v${version}.json`, 'utf8')).content
    const v5 = sample(5)
    const migrated = cameraStageDocumentKind.migrations[5]!(v5) as { objects: Array<Record<string, unknown>> }
    expect(migrated).toEqual(v5)
    expect(migrated.objects.find((object) => object.type === 'camera')).not.toHaveProperty('rig')
    const v6 = sample(6) as { objects: Array<Record<string, unknown>> }
    expect(v6.objects.find((object) => object.type === 'camera')).toMatchObject({ rig: 'crane', aimLag: 0.2 })
  })

  it('v6 文件升到 v7 内容不变；v7 黄金样本读回角色的 cruise 走位、到达后挥手与摄像机跟拍', () => {
    const sample = (version: number) => JSON.parse(fs.readFileSync(`tests/fixtures/persistence/document.camera_stage/v${version}.json`, 'utf8')).content
    expect(cameraStageDocumentKind.migrations[6]!(sample(6))).toEqual(sample(6))
    const scene = sceneFromDocumentContent(sample(7))
    expect(scene.stateKeyframes[0].transition.perObject.actor).toMatchObject({ speedPreset: 'cruise', motionOverride: { clipName: 'Walk_Loop' } })
    expect(scene.stateKeyframes[0].transition.perObject.camera.follow).toMatchObject({ subjectId: 'actor', frame: 'travel', lag: 0.5 })
    expect(scene.animation.cameraFollows).toEqual([expect.objectContaining({ cameraId: 'camera', startTime: 0, endTime: 4 })])
    const spans = scene.animation.characterMotions.find((timeline) => timeline.objectId === 'actor')!.spans
    expect(spans.map((span) => span.motion.mode === 'clip' && span.motion.clipName)).toEqual(['Walk_Loop', 'Wave', 'Idle_Loop'])
  })
})
