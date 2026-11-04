import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

import { cameraStageDocumentKind } from '@/core/documents/kinds/cameraStage'
import { WHITE_HEX } from '@/core/theme/colorTokens'

import { createCameraObject, createDefaultSceneSettings, pickDefaultColor } from './sceneDefaults'
import { sceneFromDocumentContent, sceneToDocumentContent } from './sceneSerialization'
import { createStateKeyframe } from './stateKeyframeTypes'
import { buildRenderCameraSchedule } from './renderCameraSchedule'
import { applyAnimationAtTime } from '../store/playbackSampling'

describe('镜头参考 v7 → v8：机位搬到切换点轨', () => {
  const box = (x: number) => ({ transform: { position: { x, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }, color: WHITE_HEX })
  const v7 = {
    objects: [
      { id: 'box', type: 'primitive', name: '箱子', kind: 'box', ...box(0), visible: true },
      { ...createCameraObject('甲机', pickDefaultColor(0)), id: 'cam-a' },
      { ...createCameraObject('乙机', pickDefaultColor(1)), id: 'cam-b' },
    ],
    activeCameraId: 'cam-a',
    sceneSettings: {},
    // 首卡不在 0 秒、硬切前一卡是平滑通过：旧画面里 0.5 秒前用首卡机位拍，1.5–3 秒整段冻结。
    stateKeyframes: [
      { id: 'z', name: '起', time: 0.5, cameraId: 'cam-a', continuity: 'stop', transitionDuration: 1, objectStates: { box: box(0) }, transition: { perObject: {} } },
      { id: 'a', name: '甲', time: 1.5, cameraId: 'cam-a', continuity: 'smooth', transitionDuration: 1.5, objectStates: { box: box(2) }, transition: { perObject: { box: { speedPreset: 'uniform' } } } },
      { id: 'b', name: '乙', time: 3, cameraId: 'cam-b', continuity: 'smooth', transitionDuration: 3, objectStates: { box: box(5) }, transition: { perObject: {} } },
      { id: 'c', name: '丙', time: 6, cameraId: 'cam-b', continuity: 'stop', transitionDuration: 0, objectStates: { box: box(8) }, transition: { perObject: {} } },
    ],
    sets: [],
  }

  it('机位变化的卡变成切换点；旧规则下硬切那段画面冻结，迁移后前一帧补卡保持原样', () => {
    const migrated = cameraStageDocumentKind.migrations[7]!(v7) as { cameraCuts: unknown; coverages: unknown; stateKeyframes: Array<Record<string, unknown>> }
    expect(migrated.cameraCuts).toEqual([{ id: 'cut-z', time: 0, cameraId: 'cam-a' }, { id: 'cut-b', time: 3, cameraId: 'cam-b' }])
    expect(migrated.coverages).toEqual([])
    expect(migrated.stateKeyframes.map((frame) => [frame.id, frame.time, frame.continuity])).toEqual([
      ['z', 0.5, 'stop'], ['a', 1.5, 'stop'], ['a-hold', 2.966667, 'stop'], ['b', 3, 'stop'], ['c', 6, 'stop'],
    ])
    expect(migrated.stateKeyframes.some((frame) => 'cameraId' in frame)).toBe(false)
    const scene = sceneFromDocumentContent(cameraStageDocumentKind.contentSchema.parse(migrated))
    const boxAt = (time: number) => (applyAnimationAtTime(scene.objects, scene.animation, time).find((object) => object.id === 'box')!.transform.position.x)
    expect(boxAt(1.5)).toBeCloseTo(2, 6)
    // 冻结段不因平滑通过的切线漂出去再回来
    for (const time of [1.8, 2.2, 2.6, 2.96]) expect(boxAt(time)).toBeCloseTo(2, 6)
    expect(boxAt(3)).toBeCloseTo(5, 6)
    // 同一台机位的后一段照常插值
    expect(boxAt(4.5)).toBeGreaterThan(5.5)
    expect(buildRenderCameraSchedule(scene.cameraCuts ?? [], scene.activeCameraId).map((entry) => entry.cameraId)).toEqual(['cam-a', 'cam-b'])
  })

  it('首卡没指定机位时开头仍用活动摄像机，后面指定机位的卡在它自己的时刻切', () => {
    const frames = v7.stateKeyframes.map((frame, index) => (index === 0 ? { ...frame, cameraId: null } : frame))
    const migrated = cameraStageDocumentKind.migrations[7]!({ ...v7, stateKeyframes: frames }) as { cameraCuts: unknown }
    expect(migrated.cameraCuts).toEqual([{ id: 'cut-a', time: 1.5, cameraId: 'cam-a' }, { id: 'cut-b', time: 3, cameraId: 'cam-b' }])
  })

  it('v7 黄金样本升级后没有切换点，v8 样本读回切换点与覆盖', () => {
    const sample = (version: number) => JSON.parse(fs.readFileSync(`tests/fixtures/persistence/document.camera_stage/v${version}.json`, 'utf8')).content
    const upgraded = cameraStageDocumentKind.migrations[7]!(sample(7)) as { cameraCuts: unknown[]; stateKeyframes: unknown[] }
    expect(upgraded.cameraCuts).toEqual([])
    expect(upgraded.stateKeyframes).toHaveLength(sample(7).stateKeyframes.length)
    const scene = sceneFromDocumentContent(sample(8))
    expect(scene.cameraCuts).toEqual([{ id: 'cut-wide', time: 0, cameraId: 'camera' }, { id: 'cut-close', time: 2, cameraId: 'close' }])
    expect(scene.coverages?.[0]).toMatchObject({ id: 'coverage', subjectIds: ['actor'], lines: [{ speakerId: 'actor', startTime: 4.5 }] })
    expect(scene.coverages?.[0].setups.map((setup) => setup.role)).toEqual(['master', 'single'])
  })
})

describe('镜头参考文档内容', () => {
  it('保存状态关键帧和全景环境，不写派生动画与已退役字段', () => {
    const camera = createCameraObject('摄像机', pickDefaultColor(0))
    const stateKeyframe = createStateKeyframe([camera], '关键帧 1', 0)
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
      stateKeyframes: [createStateKeyframe([camera], '关键帧 1', 0)],
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
