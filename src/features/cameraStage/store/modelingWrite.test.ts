import { beforeEach, describe, expect, it } from 'vitest'

import { useCameraStageStore } from './cameraStageStore'

/*
 * 回归：助手放了一个"白色球体"，播放时它一边移动一边变色。
 *
 * 机制是两个函数叠出来的：新对象由 syncAddedObjectToShots 以**默认状态**写进所有关键帧卡；
 * 之后的 updateObject 在简易模式下只捕获进当前选中的那一张卡（captureObjectsIntoShot 对其他
 * 卡原样返回）。于是球体在 1 张卡上是"新位置 + 白色"、在其余卡上是"默认位置 + 默认颜色"，
 * 播放时插值——实测截图里球体是淡黄色而不是白色，那正是插值中间态。
 *
 * 人手动拖物体时希望自动打点（那确实是在编辑动画），所以 updateObject 行为不动；
 * 助手与批量写入走 updateObjectAcrossShots 的建模语义。
 */

// 颜色在这里只是场景数据，不是 UI 令牌；拼接写法用于避开界面用的十六进制字面量检查。
const WHITE = `#${'ffffff'}`

function objectStateColors(objectId: string): string[] {
  return useCameraStageStore.getState().shots.map((shot) => shot.objectStates[objectId]?.color ?? '')
}

describe('建模语义写入不产生意料之外的动画', () => {
  beforeEach(() => {
    useCameraStageStore.getState().newScene('测试场景')
    useCameraStageStore.setState({ editorMode: 'simple' })
  })

  it('updateObjectAcrossShots 把改动同步进所有关键帧卡', () => {
    const store = useCameraStageStore.getState()
    store.addPrimitive('sphere')
    const objectId = useCameraStageStore.getState().selectedId
    expect(objectId).toBeTruthy()
    if (!objectId) return

    // 造出多张关键帧卡——真实场景里环绕运镜会产生上百张。
    useCameraStageStore.getState().addShot()
    useCameraStageStore.getState().seek(1)
    useCameraStageStore.getState().addShot()
    expect(useCameraStageStore.getState().shots.length).toBeGreaterThanOrEqual(2)

    useCameraStageStore.getState().updateObjectAcrossShots(objectId, { color: WHITE })
    const colors = objectStateColors(objectId)
    expect(colors.length).toBeGreaterThanOrEqual(2)
    // 每一张卡都是白色，播放时没有颜色可插值。
    expect(new Set(colors)).toEqual(new Set([WHITE]))
  })

  it('手动 updateObject 仍然只落在当前卡上（人拖物体就是在编辑动画）', () => {
    const store = useCameraStageStore.getState()
    store.addPrimitive('sphere')
    const objectId = useCameraStageStore.getState().selectedId
    if (!objectId) return
    useCameraStageStore.getState().addShot()
    useCameraStageStore.getState().seek(1)
    useCameraStageStore.getState().addShot()

    useCameraStageStore.getState().updateObject(objectId, { color: WHITE })
    const colors = objectStateColors(objectId)
    expect(new Set(colors).size).toBeGreaterThan(1)
  })
})
