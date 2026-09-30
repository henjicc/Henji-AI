// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { getPlatform } from '@/platform/runtime'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { createVideoEditProject, appendVideoEditMedia, listVideoEditInstances, closeVideoEditProject, openVideoEditProject, setVideoEditView, videoEditDomainRevision } from './videoEditService'
import { readVideoEditSource, updateVideoEditSource, registerVideoEditSourcePresenter, observeVideoEditSource, closeVideoEditSource, type VideoEditSourceObservation } from './videoEditSource'
import { VideoEditSourceExecutor } from './videoEditSourceExecutor'
import type { ApplicationExecutionContext, ApplicationPlannedStep } from '@/core/application-control'
const files = new Map<string, string>()
beforeEach(() => {
  installHarnessNativeStorage()
  files.clear()
  vi.spyOn(getPlatform().system.dialog, 'save').mockResolvedValue('D:/source.henji-video')
  vi.spyOn(getPlatform().system.fs, 'writeTextFile').mockImplementation(async (path, value) => { files.set(path, value) })
  vi.spyOn(getPlatform().system.fs, 'readTextFile').mockImplementation(async path => files.get(path)!)
  vi.spyOn(getPlatform().system.paths, 'dirname').mockResolvedValue('D:/media')
  vi.spyOn(getPlatform().media, 'allowRoot').mockResolvedValue(undefined)
})
it('外部取消传播到真实宿主，迟到确认不成功；旧宿主注销不能关闭重开的会话', async () => {
  const instance = await fixture(); const id = instance.document.id
  let finish!: (value: VideoEditSourceObservation) => void; let signal!: AbortSignal
  const offOld = registerVideoEditSourcePresenter(id, (_request, incoming) => { signal = incoming; return new Promise(resolve => { finish = resolve }) })
  const cancel = new AbortController()
  const pending = updateVideoEditSource(id, { itemId: instance.document.items[0].id }, cancel.signal).catch(error => error as Error)
  cancel.abort(new Error('Agent已取消'))
  expect(await pending).toBeInstanceOf(Error); expect(signal.aborted).toBe(true)
  finish({ timeUs: 0, presentedTimeUs: 0, playing: false, volume: 1 }); await Promise.resolve()
  expect(readVideoEditSource(id).status).toBe('error')
  await closeVideoEditProject(id); const reopened = (await openVideoEditProject(instance.path))!
  const offNew = registerVideoEditSourcePresenter(id, async request => ({ timeUs: request.timeUs, presentedTimeUs: request.timeUs, playing: request.playing, volume: request.volume }))
  await updateVideoEditSource(id, { itemId: reopened.document.items[0].id, timeUs: 2000000 })
  offOld(); expect(readVideoEditSource(id)).toMatchObject({ status: 'ready', timeUs: 2000000 }); offNew()
})
afterEach(async () => { for (const instance of listVideoEditInstances()) await closeVideoEditProject(instance.document.id); vi.restoreAllMocks(); uninstallHarnessNativeStorage() })
async function fixture() {
  const instance = (await createVideoEditProject())!
  appendVideoEditMedia(instance.document.id, { id: 'source-video', name: 'original', path: 'D:/media/original.mp4', kind: 'video', width: 3840, height: 2160, durationSeconds: 5 })
  return instance
}
it('源定位等待宿主真实确认，画面时刻与请求时刻分开，节目帧和剪辑历史保持', async () => {
  const instance = await fixture(); const id = instance.document.id
  setVideoEditView(id, { frame: 30 }); const history = instance.past.length
  let acknowledge!: (value: VideoEditSourceObservation) => void
  const off = registerVideoEditSourcePresenter(id, () => new Promise(resolve => { acknowledge = resolve }))
  let finished = false
  const command = updateVideoEditSource(id, { itemId: instance.document.items[0].id, timeUs: 510000 }).then(result => { finished = true; return result })
  await Promise.resolve(); expect(finished).toBe(false); expect(readVideoEditSource(id).status).toBe('loading')
  acknowledge({ timeUs: 510000, presentedTimeUs: 500000, playing: false, volume: 1 })
  expect(await command).toMatchObject({ timeUs: 510000, presentedTimeUs: 500000, status: 'ready' })
  const revision = videoEditDomainRevision()
  observeVideoEditSource(id, instance.document.items[0].id, { timeUs: 1000000, presentedTimeUs: 999999, playing: true, volume: 1 })
  expect(videoEditDomainRevision()).toBe(revision); expect(instance.frame).toBe(30); expect(instance.past).toHaveLength(history)
  off(); expect(readVideoEditSource(id).status).toBe('closed')
})
it('新请求取消旧请求且迟到宿主结果不能覆盖新定位，关闭取消进行中的预览', async () => {
  const instance = await fixture(); const id = instance.document.id
  const requests: Array<{ resolve: (value: VideoEditSourceObservation) => void; signal: AbortSignal }> = []
  const off = registerVideoEditSourcePresenter(id, (_request, signal) => new Promise(resolve => { requests.push({ resolve, signal }) }))
  const first = updateVideoEditSource(id, { itemId: instance.document.items[0].id, timeUs: 1000000 }).catch(error => error as Error)
  const next = updateVideoEditSource(id, { timeUs: 2000000 })
  requests[1].resolve({ timeUs: 2000000, presentedTimeUs: 2000000, playing: false, volume: 1 }); await next
  expect(await first).toBeInstanceOf(Error); expect(requests[0].signal.aborted).toBe(true)
  requests[0].resolve({ timeUs: 1000000, presentedTimeUs: 1000000, playing: false, volume: 1 }); await Promise.resolve()
  expect(readVideoEditSource(id).timeUs).toBe(2000000)
  const closing = updateVideoEditSource(id, { playing: true }).catch(error => error as Error)
  closeVideoEditSource(id); expect(await closing).toBeInstanceOf(Error); expect(requests[2].signal.aborted).toBe(true)
  off()
})
it('源通用属性写入读回真实确认，不触发磁盘写入或项目撤销；越界提前拒绝', async () => {
  const instance = await fixture(); const id = instance.document.id; const app = createApplicationHarness()
  const off = registerVideoEditSourcePresenter(id, async request => ({ timeUs: request.timeUs, presentedTimeUs: request.timeUs, playing: request.playing, volume: request.volume }))
  try {
    // Let the pending import autosave settle before testing the ephemeral operation.
    await vi.waitFor(() => expect(instance.dirty).toBe(false)); const write = vi.spyOn(getPlatform().system.fs, 'writeTextFile'); write.mockClear()
    const history = instance.past.length; const ref = { kind: 'video_edit.source', id: `${id}:source` }
    const result = await app.change(ref, { 'video_edit.source.item_id': instance.document.items[0].id, 'video_edit.source.time_us': 700000, 'video_edit.source.volume': 0.25 })
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true })
    expect((await app.read(ref, ['video_edit.source.time_us', 'video_edit.source.presented_time_us', 'video_edit.source.status'])).properties).toMatchObject({ 'video_edit.source.time_us': 700000, 'video_edit.source.presented_time_us': 700000, 'video_edit.source.status': 'ready' })
    expect(instance.past).toHaveLength(history); expect(write).not.toHaveBeenCalled()
    expect(readVideoEditSource(id).volume).toBe(0.25)
    expect((await app.change(ref, { 'video_edit.source.time_us': 6000000 })).ok).toBe(false)
    expect(readVideoEditSource(id).timeUs).toBe(700000)
  } finally { off(); app.dispose() }
})
it('新短源加载失败后保留新源起点，重试播放不会继承旧源时间', async () => {
  const instance = await fixture(); const id = instance.document.id
  appendVideoEditMedia(id, { id: 'short', name: 'short', path: 'D:/media/short.mp4', kind: 'video', width: 1920, height: 1080, durationSeconds: 1 })
  let fail = false
  const off = registerVideoEditSourcePresenter(id, async request => { if (fail) throw new Error('无法加载'); return { timeUs: request.timeUs, presentedTimeUs: request.timeUs, playing: request.playing, volume: request.volume } })
  try {
    await updateVideoEditSource(id, { itemId: instance.document.items[0].id, timeUs: 4000000 })
    fail = true; await expect(updateVideoEditSource(id, { itemId: instance.document.items[1].id })).rejects.toThrow('无法加载')
    expect(readVideoEditSource(id)).toMatchObject({ timeUs: 0, presentedTimeUs: 0, status: 'error' })
    fail = false; expect(await updateVideoEditSource(id, { playing: true })).toMatchObject({ timeUs: 0, playing: true, status: 'ready' })
  } finally { off() }
})
it('尚未打开源宿主也能设置独立音量，之后打开沿用该音量', async () => {
  const instance = await fixture(); const id = instance.document.id
  expect(await updateVideoEditSource(id, { volume: 0.4 })).toMatchObject({ status: 'closed', volume: 0.4 })
  const off = registerVideoEditSourcePresenter(id, async request => ({ timeUs: request.timeUs, presentedTimeUs: request.timeUs, playing: request.playing, volume: request.volume }))
  expect(await updateVideoEditSource(id, { itemId: instance.document.items[0].id })).toMatchObject({ status: 'ready', volume: 0.4 }); off()
})
it('源补偿保留逆序命令链与真实播放观察，拒绝后续手动操作和重开工程', async () => {
  const instance = await fixture(); const id = instance.document.id
  const presenter = async (request: Parameters<Parameters<typeof registerVideoEditSourcePresenter>[1]>[0]) => ({ timeUs: request.timeUs, presentedTimeUs: request.timeUs, playing: request.playing, volume: request.volume })
  const off = registerVideoEditSourcePresenter(id, presenter)
  const executor = new VideoEditSourceExecutor()
  const context: ApplicationExecutionContext = { requestId: crypto.randomUUID(), exposure: 'assistant', permissions: new Set(['video_edit:read', 'video_edit:write']), acceptedDataClasses: new Set(['C1']) }
  const step = (time: number): Extract<ApplicationPlannedStep, { kind: 'mutation' }> => ({ kind: 'mutation', entityType: 'video_edit.source', target: { kind: 'video_edit.source', id: `${id}:source` }, expectedRevisions: { video_edit: videoEditDomainRevision() }, mutations: [{ propertyId: 'video_edit.source.time_us', operation: 'set', value: time }] })
  await updateVideoEditSource(id, { itemId: instance.document.items[0].id })
  const first = await executor.apply(step(1000000), context); const second = await executor.apply(step(2000000), context)
  observeVideoEditSource(id, instance.document.items[0].id, { timeUs: 2200000, presentedTimeUs: 2200000, playing: false, volume: 1 })
  await executor.undo(second.undoToken!); expect(readVideoEditSource(id).timeUs).toBe(1000000)
  await executor.undo(first.undoToken!); expect(readVideoEditSource(id).timeUs).toBe(0)
  const stale = await executor.apply(step(1000000), context)
  await updateVideoEditSource(id, { timeUs: 3000000 }); await expect(executor.undo(stale.undoToken!)).rejects.toThrow('后续操作')
  const oldSession = await executor.apply(step(1000000), context)
  await closeVideoEditProject(id); await openVideoEditProject(instance.path)
  const offNew = registerVideoEditSourcePresenter(id, presenter)
  await updateVideoEditSource(id, { itemId: instance.document.items[0].id, timeUs: 2000000 })
  await expect(executor.undo(oldSession.undoToken!)).rejects.toThrow('工程已重开')
  expect(readVideoEditSource(id).timeUs).toBe(2000000); off(); offNew()
})
