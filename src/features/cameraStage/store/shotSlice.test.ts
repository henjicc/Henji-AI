import { beforeEach, describe, expect, it } from 'vitest'
import { createDefaultAnimation, createDefaultPlayback } from '../domain/animationTypes'
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
    animation: createDefaultAnimation(),
    playback: createDefaultPlayback(),
  })
  clearCameraStageHistory()
}

describe('简易模式 store 分片', () => {
  beforeEach(resetSimpleStore)

  it('编辑对象时原子写回选中卡并保留完整编译产物', () => {
    const initial = useCameraStageStore.getState()
    const objectId = initial.objects[0].id
    initial.addShot()
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

  it('播放态编辑不自动记录镜头卡', () => {
    const before = useCameraStageStore.getState()
    const objectId = before.objects[0].id
    useCameraStageStore.setState({ playback: { ...before.playback, playing: true } })
    before.updateTransform(objectId, { position: { x: 2, y: 0, z: 0 } })
    expect(useCameraStageStore.getState().shots[0].objectStates[objectId].transform.position.x).toBe(0)
  })

  it('简易模式零轨道但有镜头卡时长时仍可播放，专业模式保持禁用', () => {
    const simple = useCameraStageStore.getState()
    simple.addShot()
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
    state.addShot()
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
    first.addShot()
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
})
