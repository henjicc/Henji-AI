// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { getPlatform, isDesktopRuntime } from '@/platform/runtime'
import { createImageEditDocumentV3 } from '@/core/imageEdit/v3/documentFactory'

import {
  installHarnessNativeStorage,
  readHarnessImageEditDocument,
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
    expect(() => native.canvasProjects).toThrowError(/assetLibrary、audio/)
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

  it('镜头参考文档经真实电子适配器新建、保存并回读（3.2 起走通用文档）', async () => {
    const documents = getPlatform().documents
    const created = await documents.createDocument({ kind: 'camera_stage', container: { kind: 'user' }, name: '替身镜头' })
    expect(created.meta).toMatchObject({ kind: 'camera_stage', name: '替身镜头', draft: false })
    expect(created.content).toEqual({ objects: [], activeCameraId: null, sceneSettings: {}, stateKeyframes: [] })
    const content = { objects: [{ id: 'cam', type: 'camera', name: '摄像机01' }], activeCameraId: 'cam', sceneSettings: {}, stateKeyframes: [] }
    await documents.saveDocument({ target: { id: created.meta.id }, expectedRevision: created.meta.revision, content })
    expect((await documents.readDocument({ id: created.meta.id })).content).toEqual(content)
  })

  it('画布文档与会话状态经真实电子适配器写入并回读（3.4 起走通用文档）', async () => {
    const documents = getPlatform().documents
    const created = await documents.createDocument({ kind: 'canvas', container: { kind: 'user' }, name: '画布' })
    expect(created.content).toEqual({ nodes: [], edges: [] })
    await documents.renameDocument({ target: { id: created.meta.id }, name: '画布改名' })
    expect((await documents.readDocument({ id: created.meta.id })).meta.name).toBe('画布改名')
    await documents.writeSessionState({ docId: created.meta.id, key: 'canvas.viewport', value: { x: 1, y: 2, zoom: 1 } })
    expect(await documents.readSessionState({ docId: created.meta.id, key: 'canvas.viewport' })).toEqual({ x: 1, y: 2, zoom: 1 })
  })

  it('交出的是副本，不是内部引用——真 IPC 上这一跳会做结构化克隆', async () => {
    const documents = getPlatform().documents
    const created = await documents.createDocument({ kind: 'camera_stage', container: { kind: 'user' }, name: '原名' })
    const read = await documents.readDocument({ id: created.meta.id })
    read.meta.name = '被调用方改掉了'
    expect((await documents.readDocument({ id: created.meta.id })).meta.name).toBe('原名')
  })

  it('图片文档保存执行存储 CAS，失败不替换已存快照，重试可保存最新内容', async () => {
    const document = createImageEditDocumentV3({ width: 8, height: 8, documentId: 'image-cas' })
    const storage = getPlatform().imageEditorV3
    await storage.saveDocument({ requestId: 'save-first', document: { ...document, revision: 1 }, expectedRevision: 0, resourceRefs: [] })
    await expect(storage.saveDocument({ requestId: 'save-stale', document: { ...document, revision: 2 }, expectedRevision: 0, resourceRefs: [] }))
      .rejects.toThrow('REVISION_CONFLICT')
    expect(readHarnessImageEditDocument(document.id)?.document.revision).toBe(1)
    await storage.saveDocument({ requestId: 'save-retry', document: { ...document, revision: 3 }, expectedRevision: 1, resourceRefs: [] })
    expect(readHarnessImageEditDocument(document.id)?.document.revision).toBe(3)
  })

  it('图片文档存取均克隆，reset 清理且未实现的读取和物化仍拒绝', async () => {
    const document = createImageEditDocumentV3({ width: 8, height: 8, documentId: 'image-clone' })
    const request = { requestId: 'save-clone', document, expectedRevision: 0, resourceRefs: [] }
    await getPlatform().imageEditorV3.saveDocument(request)
    request.document.revision = 99
    const read = readHarnessImageEditDocument(document.id)!
    expect(read.document.revision).toBe(0)
    read.document.revision = 88
    expect(readHarnessImageEditDocument(document.id)?.document.revision).toBe(0)
    const native = (window as unknown as { henjiNative: { imageEditorV3: Record<string, unknown> } }).henjiNative
    expect(() => native.imageEditorV3.loadDocument).toThrow(/没有实现/)
    expect(() => native.imageEditorV3.materializeDocument).toThrow(/没有实现/)
    resetHarnessNativeStorage()
    expect(readHarnessImageEditDocument(document.id)).toBeNull()
  })
})
