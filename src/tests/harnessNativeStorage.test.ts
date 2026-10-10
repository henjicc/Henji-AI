// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { getPlatform, isDesktopRuntime } from '@/platform/runtime'
import { createImageEditDocumentV3 } from '@/core/imageEdit/v3/documentFactory'

import {
  installHarnessNativeStorage,
  readHarnessImageEditDocument,
  resetHarnessNativeStorage,
  uninstallHarnessNativeStorage,
  seedHarnessFonts,
} from './harnessNativeStorage'
import { GENERIC_FONT_FACES } from '@/core/fonts/catalog'
import type { GenerationHistoryInsertDto } from '@/platform/contracts/localRecords'

function historyRecord(id: string, patch: Partial<GenerationHistoryInsertDto> = {}): GenerationHistoryInsertDto {
  return { id, providerId: 'kie', modelId: 'image-model', type: 'image', prompt: '产品 Photo', params: { nested: { value: 1 } },
    resultPaths: [], taskId: null, status: 'pending', errorMessage: null, cost: null, duration: null,
    createdAt: '2026-10-01T00:00:00.000Z', ...patch }
}

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
  it('字体目录和字体偏好只存不解析，通过真实适配器回读副本；未实现文件选择仍拒绝', async () => {
    seedHarnessFonts({ faces: GENERIC_FONT_FACES, revision: 7 })
    const catalog = await getPlatform().fonts.list(); expect(catalog.revision).toBe(7)
    catalog.faces[0].family = 'changed'; expect((await getPlatform().fonts.list()).faces[0].family).toBe('sans-serif')
    await getPlatform().settings.set('fonts.preferences', '{"favorites":["serif"],"recent":[]}', 'json')
    expect(await getPlatform().settings.get('fonts.preferences')).toMatchObject({ type: 'json', value: '{"favorites":["serif"],"recent":[]}' })
    expect(() => getPlatform().fonts.importFiles()).toThrow(/没有实现/)
    resetHarnessNativeStorage(); expect((await getPlatform().fonts.list()).faces).toEqual([]); expect(await getPlatform().settings.get('fonts.preferences')).toBeNull()
  })

  it('没实现的命名空间抛错，不返回空值', () => {
    const native = (window as unknown as { henjiNative: Record<string, unknown> }).henjiNative
    expect(() => native.notInstalled).toThrowError(/henjiNative\.notInstalled 没有实现/)
    // 抛的错要能自纠：说清替身装了什么，以及该去哪里补。
    expect(() => native.notInstalled).toThrowError(/assetLibrary、audio/)
    expect(() => native.notInstalled).toThrowError(/harnessNativeStorage\.ts/)
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

  it('生成历史显式写回终态，输入与读回均克隆，更新保留创建时间且不推断业务结果', async () => {
    const storage = getPlatform().generationHistory
    const record = historyRecord('original')
    await storage.insert(record)
    record.params.nested = { value: 99 }; record.resultPaths.push('/changed.png')
    const read = (await storage.get(record.id))!
    expect(read).toMatchObject({ status: 'pending', params: { nested: { value: 1 } }, resultPaths: [], updatedAt: record.createdAt })
    read.params.nested = {}; read.resultPaths.push('/read.png')
    expect((await storage.get(record.id))?.resultPaths).toEqual([])
    const update = { status: 'success' as const, resultPaths: ['/generated.png'], prompt: null, cost: 0 }
    await storage.update(record.id, update); update.resultPaths.push('/mutated.png')
    expect(await storage.get(record.id)).toMatchObject({ createdAt: record.createdAt, status: 'success', resultPaths: ['/generated.png'], prompt: null, cost: 0 })
    const updatedAt = (await storage.get(record.id))!.updatedAt
    await storage.update(record.id, { prompt: undefined })
    expect((await storage.get(record.id))?.updatedAt).toBe(updatedAt)
    await storage.update('missing', { status: 'success' }); expect(await storage.get('missing')).toBeNull()
    resetHarnessNativeStorage(); expect(await storage.count()).toBe(0); expect(await storage.get(record.id)).toBeNull()
  })

  it('生成历史批量主键冲突整体回滚，按创建时间和插入顺序分页并按字段过滤', async () => {
    const storage = getPlatform().generationHistory
    await storage.insert(historyRecord('old', { createdAt: '2026-09-01T00:00:00.000Z' }))
    await expect(storage.insertMany([historyRecord('partial'), historyRecord('old')])).rejects.toThrow('UNIQUE constraint failed: history.id')
    await expect(storage.insertMany([historyRecord('same'), historyRecord('same')])).rejects.toThrow('UNIQUE constraint failed: history.id')
    expect(await storage.count()).toBe(1)
    await expect(storage.insert(historyRecord('old'))).rejects.toThrow('UNIQUE constraint failed: history.id')
    await storage.insertMany([historyRecord('new-first'), historyRecord('new-last'), historyRecord('video', { type: 'video', providerId: 'fal', modelId: 'video-model', status: 'error', prompt: null })])
    expect((await storage.list()).map(row => row.id)).toEqual(['video', 'new-last', 'new-first', 'old'])
    const query = { providerId: 'kie', modelId: 'image-model', type: 'image' as const, status: 'pending' as const, search: 'PHOTO', idPrefix: 'new-', offset: 1, limit: 1 }
    expect((await storage.list(query)).map(row => row.id)).toEqual(['new-first'])
    const listed = await storage.list({ offset: 2 }); listed[0].prompt = 'changed'
    expect((await storage.get('new-first'))?.prompt).toBe('产品 Photo')
    expect(await storage.list({ search: 'missing' })).toEqual([])
  })

  it('生成历史删除返回实际条数，按时间清理保持边界记录，未实现方法仍拒绝', async () => {
    const storage = getPlatform().generationHistory
    await storage.insertMany([historyRecord('old', { createdAt: '2026-09-01T00:00:00.000Z' }), historyRecord('keep'), historyRecord('delete'), historyRecord('batch')])
    await storage.delete('delete'); await storage.delete('missing')
    expect(await storage.deleteMany(['batch', 'batch', 'missing'])).toBe(1)
    expect(await storage.clear('2026-10-01T00:00:00.000Z')).toBe(1)
    expect((await storage.list()).map(row => row.id)).toEqual(['keep'])
    expect(await storage.clear()).toBe(1); expect(await storage.clear()).toBe(0)
    const native = (window as unknown as { henjiNative: { generationHistory: Record<string, unknown> } }).henjiNative
    expect(() => native.generationHistory.fakeSuccess).toThrow(/没有实现/)
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
