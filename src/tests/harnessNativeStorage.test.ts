// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { getPlatform, isDesktopRuntime } from '@/platform/runtime'

import {
  installHarnessNativeStorage,
  resetHarnessNativeStorage,
  uninstallHarnessNativeStorage,
} from './harnessNativeStorage'

/**
 * 替身自身的门禁。
 *
 * 它盯的不是"存得对不对"（那由读改验回环从模型的位置证明），而是**替身没有滑成一份假
 * platform**：没实现的东西必须当场抛错。返回 `undefined` 或假成功会让调用方把"没这个能力"
 * 当成"查到了但是空的"继续走下去，最后在离现场很远的地方失败——那正是这一层最该防的
 * 失真，也是当初没有随手写一个替身的原因。
 */
describe('harness 内存 native 替身', () => {
  beforeEach(() => { installHarnessNativeStorage() })
  afterEach(() => { uninstallHarnessNativeStorage() })

  it('装上之后 shell 认得出来，真实电子适配器照常组装', () => {
    expect(isDesktopRuntime()).toBe(true)
    // 拿到的是真 createElectronPlatform() 的产物，只是它代理到的 native 是内存的。
    expect(typeof getPlatform().assetLibrary.createLibrary).toBe('function')
  })

  it('没实现的命名空间抛错，不返回空值', () => {
    const native = (window as unknown as { henjiNative: Record<string, unknown> }).henjiNative
    expect(() => native.db).toThrowError(/henjiNative\.db 没有实现/)
    // 抛的错要能自纠：说清替身装了什么，以及该去哪里补。
    expect(() => native.canvasProjects).toThrowError(/assetLibrary、cameraStageProjects/)
    expect(() => native.canvasProjects).toThrowError(/harnessNativeStorage\.ts/)
  })

  it('已实现命名空间里没实现的方法同样抛错，并列出已实现的方法', () => {
    /*
     * 从真实电子适配器这一侧调：适配器本身把 20 个方法都定义成了闭包，取属性拿到的一定是
     * 函数，真相只在调用那一刻才揭晓。所以这里必须调用，不能只看属性存不存在。
     */
    const assetLibrary = getPlatform().assetLibrary
    expect(() => assetLibrary.queryAssets({}))
      .toThrowError(/henjiNative\.assetLibrary\.queryAssets 没有实现/)
    expect(() => assetLibrary.createAsset({ filePath: 'x', mediaType: 'image', source: 'imported' }))
      .toThrowError(/createLibrary/)
  })

  it('存储只存不判断：写进去什么读回来就是什么，reset 之后清空', async () => {
    const assetLibrary = getPlatform().assetLibrary
    const created = await assetLibrary.createLibrary('替身存储验证')
    expect((await assetLibrary.listLibraries()).map((item) => item.name)).toEqual(['替身存储验证'])

    await assetLibrary.renameLibrary(created.id, '替身存储验证-改名')
    expect((await assetLibrary.inspectLibrary(created.id)).name).toBe('替身存储验证-改名')

    resetHarnessNativeStorage()
    expect(await assetLibrary.listLibraries()).toEqual([])
  })

  it('3D 工程 upsert 保留首次创建时间，与主进程的 ON CONFLICT 语义一致', async () => {
    const projects = getPlatform().cameraStageProjects
    await projects.upsertProjectRecord({
      id: 'p1', name: '一', createdAt: 100, updatedAt: 100, objectCount: 0, sceneJson: '{}',
    })
    await projects.upsertProjectRecord({
      id: 'p1', name: '二', createdAt: 900, updatedAt: 900, objectCount: 2, sceneJson: '{"a":1}',
    })
    expect(await projects.getProjectRecord('p1')).toMatchObject({
      name: '二', createdAt: 100, updatedAt: 900, objectCount: 2,
    })
  })

  it('交出的是副本，不是内部引用——真 IPC 上这一跳会做结构化克隆', async () => {
    const projects = getPlatform().cameraStageProjects
    await projects.upsertProjectRecord({
      id: 'p2', name: '原名', createdAt: 1, updatedAt: 1, objectCount: 0, sceneJson: '{}',
    })
    const record = await projects.getProjectRecord('p2')
    record!.name = '被调用方改掉了'
    expect((await projects.getProjectRecord('p2'))!.name).toBe('原名')
  })
})
