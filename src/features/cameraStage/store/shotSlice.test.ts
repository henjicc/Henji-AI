import { beforeEach, describe, expect, it } from 'vitest'
import { createDefaultAnimation, createDefaultPlayback } from '../domain/animationTypes'
import { compileShotsToAnimation } from '../domain/shotCompiler'
import { createPrimitiveObject, pickDefaultColor } from '../domain/sceneDefaults'
import { createShot } from '../domain/shotTypes'
import { clearCameraStageHistory, useCameraStageStore } from './cameraStageStore'

function resetSimpleStore(): void {
  const object = createPrimitiveObject('box', '方块01', pickDefaultColor(0))
  const shot = createShot([object], '片段 1')
  useCameraStageStore.setState({
    objects: [object],
    editorMode: 'simple',
    shots: [shot],
    selectedShotId: shot.id,
    animation: compileShotsToAnimation([shot], [object]),
    playback: createDefaultPlayback(),
    simpleAutoKeyframe: false,
  })
  clearCameraStageHistory()
}

function addShotAt(time: number): void {
  useCameraStageStore.getState().seek(time)
  useCameraStageStore.getState().addShot()
}

describe('简易模式 store 分片', () => {
  beforeEach(resetSimpleStore)

  it('同为简易模式但尚无关键帧时会初始化关键帧 1', () => {
    useCameraStageStore.setState({ shots: [], selectedShotId: null })
    useCameraStageStore.getState().setEditorMode('simple')
    const state = useCameraStageStore.getState()
    expect(state.shots).toHaveLength(1)
    expect(state.shots[0].name).toBe('关键帧 1')
    expect(state.selectedShotId).toBe(state.shots[0].id)
  })

  it('编辑对象时原子写回选中卡并保留完整编译产物', () => {
    const initial = useCameraStageStore.getState()
    const objectId = initial.objects[0].id
    addShotAt(2)
    useCameraStageStore.getState().updateTransform(objectId, { position: { x: 4, y: 0, z: 0 } })

    const state = useCameraStageStore.getState()
    expect(state.shots[1].objectStates[objectId].transform.position.x).toBe(4)
    expect(state.animation.tracks.some((track) => track.propertyPath === 'transform.position.x')).toBe(true)
    expect(state.animation.motionSchedule).toEqual([])

    useCameraStageStore.temporal.getState().undo()
    const undone = useCameraStageStore.getState()
    expect(undone.objects[0].transform.position.x).toBe(0)
    expect(undone.shots[1].objectStates[objectId].transform.position.x).toBe(0)
    expect(undone.animation.tracks).toHaveLength(0)
  })

  it('播放头不在选中卡静止段内时不捕获编辑（过渡段/别的卡静止段均不写回，物体本身仍更新）', () => {
    const initial = useCameraStageStore.getState()
    const objectId = initial.objects[0].id
    addShotAt(2)
    const secondId = useCameraStageStore.getState().selectedShotId
    if (!secondId) throw new Error('新增镜头卡后应存在选中项')

    // 播放头手动挪到第一张卡的过渡段（选中卡仍是第二张）
    useCameraStageStore.getState().seek(1)
    useCameraStageStore.getState().updateTransform(objectId, { position: { x: 9, y: 0, z: 0 } })
    const afterTransitionEdit = useCameraStageStore.getState()
    expect(afterTransitionEdit.objects[0].transform.position.x).toBe(9)
    expect(
      afterTransitionEdit.shots.find((shot) => shot.id === secondId)?.objectStates[objectId].transform.position.x,
    ).toBe(0)

    // 播放头回到选中卡自己的静止段，编辑应正常捕获
    useCameraStageStore.getState().selectShot(secondId)
    useCameraStageStore.getState().updateTransform(objectId, { position: { x: 7, y: 0, z: 0 } })
    const afterStaticEdit = useCameraStageStore.getState()
    expect(
      afterStaticEdit.shots.find((shot) => shot.id === secondId)?.objectStates[objectId].transform.position.x,
    ).toBe(7)
  })

  it('播放态编辑不自动记录镜头卡', () => {
    const before = useCameraStageStore.getState()
    const objectId = before.objects[0].id
    useCameraStageStore.setState({ playback: { ...before.playback, playing: true } })
    before.updateTransform(objectId, { position: { x: 2, y: 0, z: 0 } })
    expect(useCameraStageStore.getState().shots[0].objectStates[objectId].transform.position.x).toBe(0)
  })

  it('拖动关键帧按帧吸附并自动重算相邻过渡时长', () => {
    addShotAt(2)
    const before = useCameraStageStore.getState()
    const second = before.shots[1]
    before.moveShotTime(second.id, 1.019)

    const state = useCameraStageStore.getState()
    expect(state.shots[1].time).toBeCloseTo(31 / 30, 10)
    expect(state.shots[0].transitionDuration).toBeCloseTo(31 / 30, 10)
    expect(state.animation.duration).toBeCloseTo(31 / 30, 10)
  })

  it('自动关键帧开启后，在过渡区编辑会于播放头所在帧插入状态点', () => {
    const objectId = useCameraStageStore.getState().objects[0].id
    addShotAt(2)
    useCameraStageStore.getState().seek(1)
    useCameraStageStore.getState().setSimpleAutoKeyframe(true)
    useCameraStageStore.getState().updateTransform(objectId, { position: { x: 6, y: 0, z: 0 } })

    const state = useCameraStageStore.getState()
    expect(state.shots).toHaveLength(3)
    const inserted = state.shots.find((shot) => Math.abs(shot.time - 1) < 1e-6)
    expect(inserted?.objectStates[objectId].transform.position.x).toBe(6)
    expect(state.selectedShotId).toBe(inserted?.id)
  })

  it('简易模式零轨道但有镜头卡时长时仍可播放，专业模式保持禁用', () => {
    addShotAt(2)
    const compiled = useCameraStageStore.getState()
    expect(compiled.animation.tracks).toHaveLength(0)
    expect(compiled.animation.duration).toBeGreaterThan(0)
    compiled.play()
    expect(useCameraStageStore.getState().playback.playing).toBe(true)

    useCameraStageStore.setState({
      editorMode: 'pro',
      playback: createDefaultPlayback(),
      animation: createDefaultAnimation(),
    })
    useCameraStageStore.getState().play()
    expect(useCameraStageStore.getState().playback.playing).toBe(false)
  })

  it('新增与删除对象同步所有卡片且清理过渡详情', () => {
    const state = useCameraStageStore.getState()
    addShotAt(2)
    state.addCamera()
    const added = useCameraStageStore.getState()
    const cameraId = added.objects.find((object) => object.type === 'camera')?.id
    expect(cameraId).toBeDefined()
    expect(added.shots.every((shot) => cameraId !== undefined && shot.objectStates[cameraId] !== undefined)).toBe(true)
    if (!cameraId) return
    added.removeObject(cameraId)
    const removed = useCameraStageStore.getState()
    expect(removed.shots.every((shot) => shot.objectStates[cameraId] === undefined)).toBe(true)
    expect(removed.animation.tracks.every((track) => track.objectId !== cameraId)).toBe(true)
  })

  it('选择镜头卡会应用快照并定位到卡片起点', () => {
    const first = useCameraStageStore.getState()
    const objectId = first.objects[0].id
    addShotAt(2)
    const secondId = useCameraStageStore.getState().selectedShotId
    if (!secondId) throw new Error('新增镜头卡后应存在选中项')
    useCameraStageStore.getState().updateTransform(objectId, { position: { x: 3, y: 0, z: 0 } })
    useCameraStageStore.getState().selectShot(first.shots[0].id)
    expect(useCameraStageStore.getState().objects[0].transform.position.x).toBe(0)
    useCameraStageStore.getState().selectShot(secondId)
    const selected = useCameraStageStore.getState()
    expect(selected.objects[0].transform.position.x).toBe(3)
    expect(selected.playback.currentTime).toBe(first.shots[0].hold + first.shots[0].transitionDuration)
  })

  it('单向烘焙保留完整动画与效果器配置并清空镜头卡', () => {
    const initial = useCameraStageStore.getState()
    initial.addCamera()
    const camera = useCameraStageStore.getState().objects.find((object) => object.type === 'camera')
    if (!camera) throw new Error('测试需要摄像机')
    const effectors = [{ id: 'handheld', kind: 'handheld' as const, enabled: true, intensity: 0.5, frequency: 1.2 }]
    useCameraStageStore.getState().updateObject(camera.id, { effectors })
    addShotAt(2)
    const before = useCameraStageStore.getState()
    const expectedAnimation = structuredClone(before.animation)

    before.bakeToProMode()
    const baked = useCameraStageStore.getState()
    expect(baked.editorMode).toBe('pro')
    expect(baked.shots).toEqual([])
    expect(baked.selectedShotId).toBeNull()
    expect(baked.animation).toEqual(expectedAnimation)
    expect(baked.animation.motionSchedule).toEqual(expectedAnimation.motionSchedule)
    const bakedCamera = baked.objects.find((object) => object.id === camera.id)
    expect(bakedCamera?.type).toBe('camera')
    expect(bakedCamera?.type === 'camera' ? bakedCamera.effectors : null).toEqual(effectors)

    baked.setEditorMode('simple')
    expect(useCameraStageStore.getState().editorMode).toBe('pro')
  })

  it('建卡默认沿用当前 activeCameraId 作为拍摄机位', () => {
    useCameraStageStore.getState().addCamera()
    const cameraId = useCameraStageStore.getState().activeCameraId
    expect(cameraId).toBeTruthy()
    addShotAt(2)
    const shots = useCameraStageStore.getState().shots
    expect(shots[shots.length - 1].cameraId).toBe(cameraId)
  })

  it('updateShotCamera 更新机位并触发重编译（机位不同的相邻卡强制硬切）', () => {
    useCameraStageStore.getState().addCamera()
    const cameraA = useCameraStageStore.getState().activeCameraId
    if (!cameraA) throw new Error('测试需要摄像机 A')
    useCameraStageStore.getState().updateShotCamera(useCameraStageStore.getState().shots[0].id, cameraA)
    useCameraStageStore.getState().addCamera()
    const cameraB = useCameraStageStore.getState().activeCameraId
    if (!cameraB) throw new Error('测试需要摄像机 B')
    addShotAt(2)
    const shots1 = useCameraStageStore.getState().shots
    useCameraStageStore.getState().updateShotCamera(shots1[1].id, cameraB)

    const state = useCameraStageStore.getState()
    expect(state.shots[1].cameraId).toBe(cameraB)
    // 机位不同 → 区间保留，画面在后关键帧时刻执行阶跃硬切。
    expect(state.animation.duration).toBeCloseTo(2, 5)
  })

  it('新建摄像机在已有摄像机时继承首摄像机画幅，且非首摄像机画幅补丁被钳制忽略', () => {
    useCameraStageStore.getState().addCamera()
    const cameraA = useCameraStageStore.getState().objects.find((item) => item.type === 'camera')
    if (!cameraA) throw new Error('测试需要摄像机 A')
    useCameraStageStore.getState().updateObject(cameraA.id, { aspectRatio: { preset: 'custom', ratio: 2.5 } })

    useCameraStageStore.getState().addCamera()
    const cameraB = useCameraStageStore.getState().objects.find(
      (item) => item.type === 'camera' && item.id !== cameraA.id,
    )
    if (!cameraB) throw new Error('测试需要摄像机 B')
    expect(cameraB.type === 'camera' ? cameraB.aspectRatio : null).toEqual({ preset: 'custom', ratio: 2.5 })

    // 非首摄像机改画幅被钳制忽略
    useCameraStageStore.getState().updateObject(cameraB.id, { aspectRatio: { preset: '1:1', ratio: 1 } })
    const afterIgnored = useCameraStageStore.getState().objects.find((item) => item.id === cameraB.id)
    expect(afterIgnored?.type === 'camera' ? afterIgnored.aspectRatio : null).toEqual({ preset: 'custom', ratio: 2.5 })

    // 首摄像机再次改画幅，联动同步非首摄像机
    useCameraStageStore.getState().updateObject(cameraA.id, { aspectRatio: { preset: '16:9', ratio: 16 / 9 } })
    const after = useCameraStageStore.getState().objects
    for (const item of after) {
      if (item.type === 'camera') expect(item.aspectRatio).toEqual({ preset: '16:9', ratio: 16 / 9 })
    }
  })
})
