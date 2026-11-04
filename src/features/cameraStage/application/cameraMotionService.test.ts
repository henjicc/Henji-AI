import { cameraStageTestDocuments, loadCameraStageTestProject } from '@/tests/cameraStageProjectFixture'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createDefaultAnimation } from '../domain/animationTypes'
import { createCameraObject, createDefaultSceneSettings, createPrimitiveObject, pickDefaultColor } from '../domain/sceneDefaults'
import { createStateKeyframe } from '../domain/stateKeyframeTypes'
import { useCameraStageStore } from '../store/cameraStageStore'
import { applyCameraStageMotion } from './cameraMotionService'

describe('三维摄像机语义运镜', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    const camera = createCameraObject('主摄像机', pickDefaultColor(0))
    const subject = createPrimitiveObject('sphere', '主体', pickDefaultColor(1))
    const objects = [camera, subject]
    await loadCameraStageTestProject({
      objects,
      activeCameraId: camera.id,
      animation: createDefaultAnimation(),
      sceneSettings: createDefaultSceneSettings(),
      stateKeyframes: [createStateKeyframe(objects, '关键帧 1', camera.id, 0)],
    }, { id: 'project-1', name: '运镜测试' })
  })

  it('把环绕语义写入相邻状态关键帧并编译为可撤销动画', async () => {
    const state = useCameraStageStore.getState()
    const camera = state.objects.find((object) => object.type === 'camera')!
    const subject = state.objects.find((object) => object.type === 'primitive')!

    const result = await applyCameraStageMotion({
      projectId: 'project-1',
      cameraId: camera.id,
      targetObjectId: subject.id,
      move: { kind: 'orbit', degrees: 90, direction: 'cw' },
      duration: 2,
      speed: 'easeInOut',
    })

    const updated = useCameraStageStore.getState()
    const updatedCamera = updated.objects.find((object) => object.id === camera.id && object.type === 'camera')
    expect(result.moveKind).toBe('orbit')
    expect(result.affectedStateKeyframeCount).toBeGreaterThan(0)
    expect(result.path.sampleCount).toBeGreaterThan(1)
    expect(result.undoToken).toMatch(/^camera-stage-undo:/)
    // 绕主体外面走，不碰主体
    expect(result.clearance).toEqual({ obstructions: [], obstructionCount: 0, belowGroundAt: null })
    expect(updated.stateKeyframes).toHaveLength(2)
    expect(updated.animation.tracks.filter((track) => track.objectId === camera.id).length).toBeGreaterThan(0)
    expect(updatedCamera?.type).toBe('camera')
    if (updatedCamera?.type !== 'camera') throw new Error('测试摄像机不存在')
    expect(updatedCamera.lookAt).toMatchObject({ mode: 'object', objectId: subject.id })
    expect(cameraStageTestDocuments()!.writes).toBe(1)
  })

  it('轨迹穿过对象或钻到地面以下时在结果里指出是谁、第几秒', async () => {
    const state = useCameraStageStore.getState()
    const camera = state.objects.find((object) => object.type === 'camera')!
    const subject = state.objects.find((object) => object.type === 'primitive')!
    // 顺时针环绕 90° 的终点在主体左侧 4 米处，在那里立一堵墙
    state.addPrimitive('box')
    const wallId = useCameraStageStore.getState().selectedId!
    useCameraStageStore.getState().updateObjectAcrossStateKeyframes(wallId, {
      name: '墙',
      transform: { position: { x: -4, y: 1.5, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 3, z: 1 } },
    })

    const orbit = await applyCameraStageMotion({
      projectId: 'project-1', cameraId: camera.id, targetObjectId: subject.id,
      move: { kind: 'orbit', degrees: 90, direction: 'cw' }, duration: 2, speed: 'uniform',
    })
    expect(orbit.clearance.obstructions).toEqual([expect.objectContaining({ objectId: wallId, name: '墙' })])
    expect(orbit.clearance.obstructions[0].time).toBeGreaterThan(1)

    // 推得太近会穿进注视的主体本身
    const dolly = await applyCameraStageMotion({
      projectId: 'project-1', cameraId: camera.id, targetObjectId: subject.id,
      move: { kind: 'dollyIn', distanceRatio: 0.02 }, duration: 2, speed: 'uniform',
    })
    expect(dolly.clearance.obstructions.map((item) => item.objectId)).toContain(subject.id)

    const crane = await applyCameraStageMotion({
      projectId: 'project-1', cameraId: camera.id, move: { kind: 'crane', height: -6 }, duration: 2, speed: 'uniform',
    })
    expect(crane.clearance.belowGroundAt).not.toBeNull()
  })

  it('拒绝没有目标的非升降运镜', async () => {
    const camera = useCameraStageStore.getState().objects.find((object) => object.type === 'camera')!

    await expect(applyCameraStageMotion({
      projectId: 'project-1',
      cameraId: camera.id,
      move: { kind: 'dollyIn', distanceRatio: 0.5 },
      duration: 1,
      speed: 'uniform',
    })).rejects.toThrow('TARGET_REQUIRED')
  })
})
