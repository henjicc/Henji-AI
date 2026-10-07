import { createVideoEditTestProject as createVideoEditProject } from './application/videoEditDocumentTestKit'
import { createVideoEditTestDocument as createVideoEditDocument } from '../../core/videoEdit/testFixtures'
// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { videoEditNativeMediaProbe } from './application/videoEditMediaProbe'
import { getPlatform } from '@/platform/runtime'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { videoEditComposition, type VideoEditMedia } from '@/core/videoEdit/document'
import { makeVideoEditItemClip } from '@/core/videoEdit/projectItems'
import { appendVideoEditMedia, closeVideoEditProject, listVideoEditInstances, saveVideoEdit } from './application/videoEditService'
import { closeVideoEditSource, registerVideoEditSourcePresenter, updateVideoEditSource, type VideoEditSourceRequest } from './application/videoEditSource'
import { VideoEditRenderSession } from './engine/videoEditRenderSession'
import type { RenderRequest, RenderResponse } from './engine/videoEditWorker'
import { VideoEditMediaContentVerifier } from './videoEditMediaContent'
import { reopenVideoEdit } from './application/videoEditDocumentTestKit'

const original: VideoEditMedia = { id: 'original', path: 'D:/original.png', name: '原图', kind: 'image', width: 3840, height: 2160, durationSeconds: 0, assetId: 'deleted-asset', sourceRevision: 'fixed-source', assetContent: { sizeBytes: 4096, fileModifiedAt: 1000, contentIdentity: 'a'.repeat(64) } }
const files = new Map<string, string>()
const workers: WorkerBoundary[] = []
async function expectSettledError(operation: Promise<unknown>): Promise<void> {
  let settled = false; let value: unknown
  void operation.then(result => { value = result; settled = true })
  await vi.waitFor(() => expect(settled).toBe(true)); expect(value).toBeInstanceOf(Error)
}
class WorkerBoundary {
  messages: RenderRequest[] = []
  onmessage?: (event: MessageEvent<RenderResponse>) => void
  terminate = vi.fn()
  constructor() { workers.push(this) }
  postMessage(request: RenderRequest) {
    this.messages.push(request)
    queueMicrotask(() => this.onmessage?.({ data: { id: request.id, presented: true } } as MessageEvent<RenderResponse>))
  }
}
function composition() {
  const document = createVideoEditDocument('原路径')
  document.media = [structuredClone(original)]
  document.items = [{ id: 'item', name: original.name, kind: 'image', mediaId: original.id }]
  document.sequences[0].clips = [makeVideoEditItemClip(document, 'item', document.sequences[0].id, { frame: 0 })]
  return videoEditComposition(document, document.sequences[0].id)
}
beforeEach(() => {
  installHarnessNativeStorage(); files.clear(); workers.length = 0
  // 测试环境没有原生解码服务：按“不可用”走后备探测，而不是让替身抛错再记一条探测异常。
  vi.spyOn(videoEditNativeMediaProbe, 'forcedBackend').mockResolvedValue(undefined)
  vi.spyOn(videoEditNativeMediaProbe, 'probe').mockResolvedValue({ status: 'unavailable' })
  vi.spyOn(getPlatform().videoDecoder, 'status').mockResolvedValue({ available: false, forcedBackend: null })
  vi.stubGlobal('Worker', WorkerBoundary)
  vi.stubGlobal('OffscreenCanvas', class { constructor(public width: number, public height: number) {} })
  vi.spyOn(getPlatform().system.dialog, 'save').mockResolvedValue('D:/saved-content.henji-video')
  vi.spyOn(getPlatform().system.fs, 'writeTextFile').mockImplementation(async (path, content) => { files.set(path, content) })
  vi.spyOn(getPlatform().system.fs, 'readTextFile').mockImplementation(async path => files.get(path)!)
  vi.spyOn(getPlatform().system.paths, 'dirname').mockResolvedValue('D:/')
  vi.spyOn(getPlatform().media, 'allowRoot').mockResolvedValue(undefined)
})
afterEach(async () => {
  for (const owner of listVideoEditInstances()) await closeVideoEditProject(owner.document.id)
  vi.restoreAllMocks(); vi.unstubAllGlobals(); uninstallHarnessNativeStorage()
})
it('保存关闭后同大小同mtime替换：允许打开恢复剪辑，Source在消费前拒绝新文件', async () => {
  const owner = (await createVideoEditProject())!; appendVideoEditMedia(owner.document.id, structuredClone(original))
  await saveVideoEdit(owner.document.id); await closeVideoEditProject(owner.document.id)
  const reopened = await reopenVideoEdit(owner.document.id); const baseline = reopened.document
  const inspect = vi.spyOn(getPlatform().assetLibrary, 'inspectFileContent').mockResolvedValue({ ...original.assetContent!, contentIdentity: 'b'.repeat(64) })
  const presenter = vi.fn(async (request: VideoEditSourceRequest) => ({ ...request, presentedTimeUs: request.timeUs }))
  const off = registerVideoEditSourcePresenter(reopened.document.id, presenter)
  try {
    await expect(updateVideoEditSource(reopened.document.id, { itemId: reopened.document.items[0].id })).rejects.toThrow('重新定位')
    expect(presenter).not.toHaveBeenCalled(); expect(reopened.document).toBe(baseline)
    expect(inspect).toHaveBeenCalledWith(original.path, original.kind)
  } finally { off() }
})
it.each(['image', 'code_image'] as const)('%s在节目/导出Worker初始化前核验，失败不启动解码/GPU', async kind => {
  vi.spyOn(getPlatform().assetLibrary, 'inspectFileContent').mockResolvedValue({ ...original.assetContent!, contentIdentity: 'b'.repeat(64) })
  const document = composition()
  if (kind === 'code_image') {
    document.items = [{ id: 'code-item', name: '代码图片', kind: 'code', code: { definitionId: 'fixture', versionId: 'version', parameters: { logo: { kind: 'image', mediaId: original.id } } } }]
    document.clips = [{ ...document.clips[0], itemId: 'code-item', kind: 'code', code: document.items[0].code }]
  }
  const session = new VideoEditRenderSession(document)
  await expect(session.present(0)).rejects.toThrow('重新定位')
  expect(workers[0].messages).toEqual([])
  await session.dispose(); expect(workers[0].terminate).toHaveBeenCalledOnce()
})
it('删除素材库记录不破坏固定原路径，重复帧/参数更新复用会话检查，新会话重新核验', async () => {
  const inspect = vi.spyOn(getPlatform().assetLibrary, 'inspectFileContent').mockResolvedValue({ ...original.assetContent!, contentIdentity: 'a'.repeat(64) })
  const library = vi.spyOn(getPlatform().assetLibrary, 'inspectAsset').mockRejectedValue(new Error('资产已删除'))
  const document = composition(); const session = new VideoEditRenderSession(document)
  await session.present(0); await session.updateDocument({ ...document, revision: 1 }); await session.present(1)
  expect(inspect).toHaveBeenCalledOnce(); expect(library).not.toHaveBeenCalled()
  await session.dispose()
  inspect.mockResolvedValue({ ...original.assetContent!, contentIdentity: 'b'.repeat(64) })
  const reopened = new VideoEditRenderSession(document)
  await expect(reopened.present(0)).rejects.toThrow('重新定位'); expect(inspect).toHaveBeenCalledTimes(2)
  await reopened.dispose()
})
it('原路径检查尚未完成时关闭不再初始化Worker，未引用的资产不妨碍空序列', async () => {
  let finish!: (value: { sizeBytes: number; fileModifiedAt: number; contentIdentity: string }) => void
  const inspect = vi.spyOn(getPlatform().assetLibrary, 'inspectFileContent').mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const session = new VideoEditRenderSession(composition()); const presented = session.present(0).catch(error => error)
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
  await session.dispose()
  await expectSettledError(presented)
  finish({ ...original.assetContent!, contentIdentity: 'a'.repeat(64) }); await Promise.resolve()
  expect(workers[0].messages.map(message => message.kind)).toEqual(['dispose'])
  const empty = composition(); empty.clips = []
  const unused = new VideoEditRenderSession(empty); await unused.present(0)
  expect(inspect).toHaveBeenCalledOnce(); await unused.dispose()
})
it('首批检查在途时关闭立即拒绝，晚到完成不会再启动剩余媒体', async () => {
  const finish: Array<(value: { sizeBytes: number; fileModifiedAt: number; contentIdentity: string }) => void> = []
  const inspect = vi.spyOn(getPlatform().assetLibrary, 'inspectFileContent').mockImplementation(() => new Promise(resolve => finish.push(resolve)))
  const document = composition(); const template = document.clips[0]
  for (let index = 1; index < 5; index++) {
    const media = { ...original, id: `media-${index}`, path: `D:/original-${index}.png` }
    document.media.push(media); document.items.push({ id: `item-${index}`, name: media.name, kind: 'image', mediaId: media.id })
    document.clips.push({ ...template, id: `clip-${index}`, itemId: `item-${index}`, start: index * 90 })
  }
  const verifier = new VideoEditMediaContentVerifier(); const checked = verifier.check(document).catch(error => error)
  await vi.waitFor(() => expect(inspect).toHaveBeenCalledTimes(2)); verifier.dispose()
  await expectSettledError(checked)
  for (const resolve of finish) resolve({ ...original.assetContent!, contentIdentity: 'a'.repeat(64) })
  await Promise.resolve(); await Promise.resolve(); expect(inspect).toHaveBeenCalledTimes(2)
})
it.each(['raw', 'empty'] as const)('Source A→%s→A的新宿主不能沿用上次内容核验', async middle => {
  const owner = (await createVideoEditProject())!; const id = owner.document.id
  appendVideoEditMedia(id, structuredClone(original)); const first = owner.document.items[0].id
  appendVideoEditMedia(id, { ...original, id: 'raw', name: '原路径图', path: 'D:/raw.png', assetId: undefined, assetContent: undefined })
  const inspect = vi.spyOn(getPlatform().assetLibrary, 'inspectFileContent').mockResolvedValue({ ...original.assetContent!, contentIdentity: 'a'.repeat(64) })
  const presenter = vi.fn(async (request: VideoEditSourceRequest) => ({ ...request, presentedTimeUs: request.timeUs }))
  const off = registerVideoEditSourcePresenter(id, presenter)
  try {
    await updateVideoEditSource(id, { itemId: first })
    await updateVideoEditSource(id, { itemId: middle === 'raw' ? owner.document.items[1].id : '' })
    inspect.mockResolvedValue({ ...original.assetContent!, contentIdentity: 'b'.repeat(64) })
    await expect(updateVideoEditSource(id, { itemId: first })).rejects.toThrow('重新定位')
    expect(inspect).toHaveBeenCalledTimes(2); expect(presenter).toHaveBeenCalledTimes(2)
  } finally { off() }
})
it('Source核验在途时取消立即结束，晚到身份不能触发Presenter', async () => {
  const owner = (await createVideoEditProject())!; appendVideoEditMedia(owner.document.id, structuredClone(original))
  let finish!: (value: { sizeBytes: number; fileModifiedAt: number; contentIdentity: string }) => void
  vi.spyOn(getPlatform().assetLibrary, 'inspectFileContent').mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const presenter = vi.fn(async (request: VideoEditSourceRequest) => ({ ...request, presentedTimeUs: request.timeUs }))
  const off = registerVideoEditSourcePresenter(owner.document.id, presenter); const controller = new AbortController()
  try {
    const opened = updateVideoEditSource(owner.document.id, { itemId: owner.document.items[0].id }, controller.signal).catch(error => error)
    await vi.waitFor(() => expect(finish).toBeTypeOf('function')); controller.abort(new Error('取消原路径核验'))
    await expectSettledError(opened)
    finish({ ...original.assetContent!, contentIdentity: 'a'.repeat(64) }); await Promise.resolve()
    expect(presenter).not.toHaveBeenCalled()
  } finally { off() }
})
it('Source关闭后同一媒体重新打开会复核，连续命令只复用当前宿主的身份', async () => {
  const owner = (await createVideoEditProject())!; appendVideoEditMedia(owner.document.id, structuredClone(original))
  const inspect = vi.spyOn(getPlatform().assetLibrary, 'inspectFileContent').mockResolvedValue({ ...original.assetContent!, contentIdentity: 'a'.repeat(64) })
  const off = registerVideoEditSourcePresenter(owner.document.id, async request => ({ ...request, presentedTimeUs: request.timeUs }))
  try {
    await updateVideoEditSource(owner.document.id, { itemId: owner.document.items[0].id })
    await updateVideoEditSource(owner.document.id, { volume: .5 }); expect(inspect).toHaveBeenCalledOnce()
    closeVideoEditSource(owner.document.id)
    inspect.mockResolvedValue({ ...original.assetContent!, contentIdentity: 'b'.repeat(64) })
    await expect(updateVideoEditSource(owner.document.id, { itemId: owner.document.items[0].id })).rejects.toThrow('重新定位')
    expect(inspect).toHaveBeenCalledTimes(2)
  } finally { off() }
})
