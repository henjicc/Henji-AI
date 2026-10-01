// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { getPlatform } from '@/platform/runtime'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { createVideoEditProject, appendVideoEditMedia, editVideoProject, listVideoEditInstances, closeVideoEditProject, openVideoEditProject, setVideoEditView, setVideoEditProjectView, videoEditProgramCommandIdentity, videoEditDomainRevision } from './videoEditService'
import { readVideoEditSource, updateVideoEditSource, registerVideoEditSourcePresenter, pauseVideoEditSourceForProgram, observeVideoEditSource, closeVideoEditSource, subscribeVideoEditSource, videoEditSourceCommandIdentity, matchesVideoEditSourceCommand, type VideoEditSourceObservation, type VideoEditSourceRequest } from './videoEditSource'
import { VideoEditSourceExecutor } from './videoEditSourceExecutor'
import { VideoEditMutationExecutor } from './videoEditExecutors'
import type { ApplicationExecutionContext, ApplicationPlannedStep } from '@/core/application-control'
const files = new Map<string, string>()
it('失败发布中的立即重试先退役旧请求，不被旧catch释放新宿主', async () => {
  const owner = await fixture(); const id = owner.document.id; const events: string[] = []; let attempt = 0
  const retire = vi.fn(async () => { events.push('retire') })
  const off = registerVideoEditSourcePresenter(id, async request => { if (++attempt === 1) throw new Error('首次失败'); return { ...request, presentedTimeUs: request.timeUs } }, retire)
  let retry: ReturnType<typeof updateVideoEditSource> | undefined
  const unsubscribe = subscribeVideoEditSource(() => { if (readVideoEditSource(id).status === 'error' && !retry) { events.push('retry'); retry = updateVideoEditSource(id, { playing: true }) } })
  try {
    await expect(updateVideoEditSource(id, { itemId: owner.document.items[0].id, playing: true })).rejects.toThrow('首次失败')
    await retry; expect(events).toEqual(['retire', 'retry']); expect(retire).toHaveBeenCalledOnce(); expect(readVideoEditSource(id)).toMatchObject({ status: 'ready', playing: true })
  } finally { unsubscribe(); off() }
})
it('显式关闭已注册源同步登记退役，节目不越过未释放的反向资源', async () => {
  const owner = await fixture(); const id = owner.document.id; let released!: () => void
  const retire = vi.fn(() => new Promise<void>(resolve => { released = resolve }))
  const off = registerVideoEditSourcePresenter(id, async request => ({ ...request, presentedTimeUs: request.timeUs }), retire)
  try {
    await updateVideoEditSource(id, { itemId: owner.document.items[0].id })
    closeVideoEditSource(id); expect(retire).toHaveBeenCalledOnce(); expect(readVideoEditSource(id).status).toBe('closed')
    let ready = false; const waiting = pauseVideoEditSourceForProgram(id).then(() => { ready = true })
    await Promise.resolve(); expect(ready).toBe(false); released(); await waiting; expect(ready).toBe(true)
  } finally { off(); released() }
})
it('失败确认先实际释放源，再恢复节目；隐藏源后节目等待退役预算', async () => {
  const owner = await fixture(); const id = owner.document.id; let released!: () => void
  const retire = vi.fn(() => new Promise<void>(resolve => { released = resolve }))
  const off = registerVideoEditSourcePresenter(id, async request => ({ timeUs: request.timeUs, presentedTimeUs: request.timeUs, playing: request.playing, volume: .25 }), retire)
  try {
    setVideoEditView(id, { frame: 30, playing: true })
    const rejected = expect(updateVideoEditSource(id, { itemId: owner.document.items[0].id, playing: true })).rejects.toThrow('音量')
    await vi.waitFor(() => expect(retire).toHaveBeenCalledOnce()); expect(owner.playing).toBe(false)
    released(); await rejected; expect(owner.playing).toBe(true)
    off(); let ready = false
    const waiting = pauseVideoEditSourceForProgram(id).then(() => { ready = true })
    await Promise.resolve(); expect(ready).toBe(false); released(); await waiting; expect(ready).toBe(true)
  } finally { off() }
})
it('源开播失败恢复原节目命令；新节目定位和被替换的源请求不被旧失败覆盖', async () => {
  const owner = await fixture(); const id = owner.document.id
  const requests: Array<{ request: VideoEditSourceRequest; reject: (error: Error) => void }> = []
  const off = registerVideoEditSourcePresenter(id, request => new Promise((_resolve, reject) => requests.push({ request, reject })))
  try {
    setVideoEditView(id, { frame: 30, playing: true }); const original = videoEditProgramCommandIdentity(id)
    const failed = updateVideoEditSource(id, { itemId: owner.document.items[0].id, playing: true }).catch(error => error)
    expect(owner.playing).toBe(false); requests[0].reject(new Error('无法播放')); await failed
    expect(owner).toMatchObject({ frame: 30, playing: true }); expect(videoEditProgramCommandIdentity(id)).toBe(original)
    const older = updateVideoEditSource(id, { playing: true }).catch(error => error)
    const newer = updateVideoEditSource(id, { timeUs: 1_000_000, playing: true }).catch(error => error)
    await older; expect(owner.playing).toBe(false)
    requests[2].reject(new Error('新请求也失败')); await newer
    expect(owner.playing).toBe(true); expect(videoEditProgramCommandIdentity(id)).toBe(original)
    const stale = updateVideoEditSource(id, { playing: true }).catch(error => error)
    setVideoEditView(id, { frame: 60, playing: false }); const manual = videoEditProgramCommandIdentity(id)
    requests[3].reject(new Error('迟到失败')); await stale
    expect(owner).toMatchObject({ frame: 60, playing: false }); expect(videoEditProgramCommandIdentity(id)).toBe(manual)
  } finally { off() }
})
it('节目开播等源真实暂停后声明级联；撤销恢复源播放与命令，后续源操作拒绝旧撤销', async () => {
  const owner = await fixture(); const id = owner.document.id
  let pause!: () => void; let defer = false
  const off = registerVideoEditSourcePresenter(id, request => {
    const result = { timeUs: request.timeUs, presentedTimeUs: request.timeUs, playing: request.playing, volume: request.volume }
    return defer && !request.playing ? new Promise(resolve => { pause = () => resolve(result) }) : Promise.resolve(result)
  })
  try {
    await updateVideoEditSource(id, { itemId: owner.document.items[0].id, playing: true }); const original = videoEditSourceCommandIdentity(id)
    const executor = new VideoEditMutationExecutor('video_edit.project')
    const step: Extract<ApplicationPlannedStep, { kind: 'mutation' }> = { kind: 'mutation', entityType: executor.entityType, target: { kind: executor.entityType, id }, expectedRevisions: {}, mutations: [{ propertyId: 'video_edit.project.program_playback', operation: 'set', value: { frame: 30, playing: true, playbackDirection: 1 } }] }
    defer = true; let completed = false
    const pending = executor.apply(step, sourceContext()).then(result => { completed = true; return result })
    await vi.waitFor(() => expect(pause).toBeTypeOf('function')); expect(completed).toBe(false); expect(owner.playing).toBe(false)
    pause(); const result = await pending; defer = false
    expect(owner).toMatchObject({ frame: 30, playing: true }); expect(readVideoEditSource(id).playing).toBe(false)
    expect(result.cascadeEffects).toMatchObject([{ entityType: 'video_edit.source', propertyIds: ['video_edit.source.playing'] }])
    await executor.undo(result.undoToken!)
    expect(owner).toMatchObject({ frame: 0, playing: false }); expect(readVideoEditSource(id).playing).toBe(true); expect(matchesVideoEditSourceCommand(id, original)).toBe(true)
    const second = await executor.apply(step, sourceContext()); await updateVideoEditSource(id, { timeUs: 2_000_000, playing: false })
    await expect(executor.undo(second.undoToken!)).rejects.toThrow('源预览已有后续'); expect(owner.frame).toBe(30)
  } finally { off() }
})
it('在途源暂停拒绝并行节目开播，原请求因工程修改失败时恢复已归属源播放', async () => {
  const owner = await fixture(); const id = owner.document.id; let pause!: () => void
  const off = registerVideoEditSourcePresenter(id, request => {
    const result = { timeUs: request.timeUs, presentedTimeUs: request.timeUs, playing: request.playing, volume: request.volume }
    return request.playing ? Promise.resolve(result) : new Promise(resolve => { pause = () => resolve(result) })
  })
  try {
    await updateVideoEditSource(id, { itemId: owner.document.items[0].id, playing: true }); const original = videoEditSourceCommandIdentity(id)
    const executor = new VideoEditMutationExecutor('video_edit.project')
    const step: Extract<ApplicationPlannedStep, { kind: 'mutation' }> = { kind: 'mutation', entityType: executor.entityType, target: { kind: executor.entityType, id }, expectedRevisions: {}, mutations: [{ propertyId: 'video_edit.project.program_playback', operation: 'set', value: { frame: 30, playing: true, playbackDirection: 1 } }] }
    const rejected = expect(executor.apply(step, sourceContext())).rejects.toThrow('已有后续修改')
    await vi.waitFor(() => expect(pause).toBeTypeOf('function'))
    await expect(executor.apply(step, sourceContext())).rejects.toThrow('仍在确认')
    expect(owner.playing).toBe(false)
    editVideoProject(id, document => ({ ...document, name: '新名称' })); pause(); await rejected
    expect(owner.document.name).toBe('新名称'); expect(readVideoEditSource(id).playing).toBe(true); expect(matchesVideoEditSourceCommand(id, original)).toBe(true)
  } finally { off() }
})
it('节目撤销恢复源期间改选区会取消旧恢复并保持单路播放', async () => {
  const owner = await fixture(); const id = owner.document.id
  let defer = false; let resume!: () => void; let signal!: AbortSignal
  const off = registerVideoEditSourcePresenter(id, (request, incoming) => {
    const result = { timeUs: request.timeUs, presentedTimeUs: request.timeUs, playing: request.playing, volume: request.volume }
    return defer && request.playing ? new Promise(resolve => { resume = () => resolve(result); signal = incoming }) : Promise.resolve(result)
  })
  try {
    await updateVideoEditSource(id, { itemId: owner.document.items[0].id, playing: true })
    const executor = new VideoEditMutationExecutor('video_edit.project')
    const step: Extract<ApplicationPlannedStep, { kind: 'mutation' }> = { kind: 'mutation', entityType: executor.entityType, target: { kind: executor.entityType, id }, expectedRevisions: {}, mutations: [{ propertyId: 'video_edit.project.program_playback', operation: 'set', value: { frame: 30, playing: true, playbackDirection: 1 } }] }
    const result = await executor.apply(step, sourceContext()); defer = true
    const rejected = expect(executor.undo(result.undoToken!)).rejects.toThrow('已有后续操作')
    await vi.waitFor(() => expect(resume).toBeTypeOf('function'))
    setVideoEditProjectView(id, { selectedItemIds: [owner.document.items[0].id] })
    expect(signal.aborted).toBe(true); await rejected; resume(); await Promise.resolve()
    expect(owner).toMatchObject({ frame: 30, playing: true }); expect(readVideoEditSource(id).playing).toBe(false)
    expect(owner.selectedItemIds).toEqual([owner.document.items[0].id])
  } finally { off() }
})
it('公共源范围与播放方向由实际宿主确认，撤销保留空范围且越界不改状态', async () => {
  const instance = await fixture(); const id = instance.document.id; const app = createApplicationHarness()
  const off = registerVideoEditSourcePresenter(id, async request => ({ timeUs: request.timeUs, presentedTimeUs: request.timeUs, playing: request.playing, volume: request.volume, playbackDirection: request.playbackDirection ?? 1 }))
  try {
    await updateVideoEditSource(id, { itemId: instance.document.items[0].id })
    const ref = { kind: 'video_edit.source', id: `${id}:source` }
    const history = instance.past.length
    expect((await app.change(ref, { 'video_edit.source.in_us': 1_000_000, 'video_edit.source.out_us': 2_000_000, 'video_edit.source.playback_direction': -1, 'video_edit.source.playing': true })).ok).toBe(true)
    expect((await app.read(ref, ['video_edit.source.in_us', 'video_edit.source.out_us', 'video_edit.source.playback_direction'])).properties).toEqual({ 'video_edit.source.in_us': 1_000_000, 'video_edit.source.out_us': 2_000_000, 'video_edit.source.playback_direction': -1 })
    expect((await app.change(ref, { 'video_edit.source.out_us': 900_000 })).ok).toBe(false)
    expect(readVideoEditSource(id).outUs).toBe(2_000_000)
    expect((await app.change(ref, { 'video_edit.source.in_us': null, 'video_edit.source.out_us': null, 'video_edit.source.playing': false })).ok).toBe(true)
    expect(readVideoEditSource(id)).toMatchObject({ inUs: null, outUs: null, playing: false }); expect(instance.past.length).toBe(history)
  } finally { off(); app.dispose() }
})
it('源前台播放声明节目暂停级联，逆操作恢复原命令且不覆盖后续节目定位', async () => {
  const owner = await fixture(); const id = owner.document.id
  const off = registerVideoEditSourcePresenter(id, async request => ({ timeUs: request.timeUs, presentedTimeUs: request.timeUs, playing: request.playing, volume: request.volume }))
  try {
    await updateVideoEditSource(id, { itemId: owner.document.items[0].id })
    setVideoEditView(id, { frame: 30, playing: true })
    const executor = new VideoEditSourceExecutor()
    const step: Extract<ApplicationPlannedStep, { kind: 'mutation' }> = { kind: 'mutation', entityType: 'video_edit.source', target: { kind: 'video_edit.source', id: `${id}:source` }, expectedRevisions: {}, mutations: [{ propertyId: 'video_edit.source.playing', operation: 'set', value: true }] }
    const completed = await executor.apply(step, sourceContext()); expect(owner.playing).toBe(false)
    expect(completed.cascadeEffects).toMatchObject([{ entityType: 'video_edit.project', propertyIds: ['video_edit.project.program_playback'] }])
    await executor.undo(completed.undoToken!); expect(owner).toMatchObject({ frame: 30, playing: true }); expect(readVideoEditSource(id).playing).toBe(false)
    const second = await executor.apply(step, sourceContext()); setVideoEditView(id, { frame: 60 })
    await expect(executor.undo(second.undoToken!)).rejects.toThrow('节目播放已有后续'); expect(owner.frame).toBe(60)
  } finally { off() }
})
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
it('同路径媒体刷新关闭旧源并取消在途确认，迟到画面不能恢复旧缓存会话', async () => {
  const instance = await fixture(); const id = instance.document.id
  let finish!: (value: VideoEditSourceObservation) => void; let incoming!: AbortSignal; let defer = false
  const off = registerVideoEditSourcePresenter(id, (request, signal) => defer ? new Promise(resolve => { finish = resolve; incoming = signal }) : Promise.resolve({ timeUs: request.timeUs, presentedTimeUs: request.timeUs, playing: request.playing, volume: request.volume }))
  await updateVideoEditSource(id, { itemId: instance.document.items[0].id, timeUs: 1_000_000 })
  editVideoProject(id, document => ({ ...document, media: document.media.map(media => ({ ...media, sourceRevision: 'refresh-1' })) }))
  expect(readVideoEditSource(id).status).toBe('closed')
  await updateVideoEditSource(id, { itemId: instance.document.items[0].id, timeUs: 2_000_000 })
  defer = true
  const pending = updateVideoEditSource(id, { playing: true }).catch(error => error as Error)
  editVideoProject(id, document => ({ ...document, media: document.media.map(media => ({ ...media, sourceRevision: 'refresh-2' })) }))
  expect(incoming.aborted).toBe(true); expect(await pending).toBeInstanceOf(Error)
  finish({ timeUs: 2_000_000, presentedTimeUs: 2_000_000, playing: true, volume: 1 }); await Promise.resolve()
  expect(readVideoEditSource(id).status).toBe('closed'); off()
})
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

it.each([false, true])('空源拒绝非空入出点，不改变命令或工程（已注册宿主：%s）', async registered => {
  const instance = await fixture(); const id = instance.document.id
  const presenter = vi.fn(async (request: VideoEditSourceRequest): Promise<VideoEditSourceObservation> => ({ timeUs: request.timeUs, presentedTimeUs: request.timeUs, playing: request.playing, volume: request.volume }))
  const off = registered ? registerVideoEditSourcePresenter(id, presenter) : undefined
  const before = readVideoEditSource(id); const command = videoEditSourceCommandIdentity(id)
  const document = instance.document; const history = instance.past.length
  try {
    for (const range of [{ inUs: 0 }, { outUs: 1 }, { inUs: 0, outUs: 1 }]) {
      await expect(updateVideoEditSource(id, range)).rejects.toThrow('先打开')
      expect(readVideoEditSource(id)).toEqual(before)
      expect(matchesVideoEditSourceCommand(id, command)).toBe(true)
    }
    expect(presenter).not.toHaveBeenCalled(); expect(instance.document).toBe(document); expect(instance.past).toHaveLength(history)
  } finally { off?.() }
})

function deferredPresenter() {
  const requests: Array<{ request: VideoEditSourceRequest; acknowledge: () => void }> = []
  const present = (request: VideoEditSourceRequest): Promise<VideoEditSourceObservation> => new Promise(resolve => {
    requests.push({ request, acknowledge: () => resolve({ timeUs: request.timeUs, presentedTimeUs: request.timeUs, playing: request.playing, volume: request.volume, playbackDirection: request.playbackDirection ?? 1 }) })
  })
  return { requests, present }
}
function sourceMutation(projectId: string, timeUs: number): Extract<ApplicationPlannedStep, { kind: 'mutation' }> {
  return { kind: 'mutation', entityType: 'video_edit.source', target: { kind: 'video_edit.source', id: `${projectId}:source` }, expectedRevisions: { video_edit: videoEditDomainRevision() }, mutations: [{ propertyId: 'video_edit.source.time_us', operation: 'set', value: timeUs }] }
}
function sourceContext(): ApplicationExecutionContext {
  return { requestId: crypto.randomUUID(), exposure: 'assistant', permissions: new Set(['video_edit:read', 'video_edit:write']), acceptedDataClasses: new Set(['C1']) }
}

it('源请求已确认但回执尚未返回时的新手动定位不能被纳入旧请求回执', async () => {
  const instance = await fixture(); const id = instance.document.id; const history = instance.past.length
  const { requests, present } = deferredPresenter(); const off = registerVideoEditSourcePresenter(id, present)
  const opening = updateVideoEditSource(id, { itemId: instance.document.items[0].id }); requests[0].acknowledge(); await opening
  let manual: ReturnType<typeof updateVideoEditSource> | undefined
  let manualCommand: ReturnType<typeof videoEditSourceCommandIdentity> | undefined
  const unsubscribe = subscribeVideoEditSource(() => {
    const state = readVideoEditSource(id)
    if (state.status === 'ready' && state.timeUs === 1_000_000 && !manual) {
      manual = updateVideoEditSource(id, { timeUs: 3_000_000 })
      manualCommand = videoEditSourceCommandIdentity(id)
    }
  })
  try {
    const executor = new VideoEditSourceExecutor()
    const rejected = expect(executor.apply(sourceMutation(id, 1_000_000), sourceContext())).rejects.toThrow('后续操作')
    await vi.waitFor(() => expect(requests).toHaveLength(2))
    requests[1].acknowledge(); await rejected
    expect(requests).toHaveLength(3); expect(requests[2].request.timeUs).toBe(3_000_000); expect(manual).toBeDefined()
    requests[2].acknowledge(); await manual
    expect(readVideoEditSource(id)).toMatchObject({ timeUs: 3_000_000, presentedTimeUs: 3_000_000, status: 'ready' })
    expect(matchesVideoEditSourceCommand(id, manualCommand!)).toBe(true); expect(instance.past).toHaveLength(history)
  } finally { unsubscribe(); off() }
})

it('补偿已确认但尚未完成时的新手动定位保持自己的身份，旧逆序链不能恢复', async () => {
  const instance = await fixture(); const id = instance.document.id; const history = instance.past.length
  const { requests, present } = deferredPresenter(); const off = registerVideoEditSourcePresenter(id, present)
  const opening = updateVideoEditSource(id, { itemId: instance.document.items[0].id }); requests[0].acknowledge(); await opening
  const executor = new VideoEditSourceExecutor(); const context = sourceContext()
  const firstPending = executor.apply(sourceMutation(id, 1_000_000), context)
  await vi.waitFor(() => expect(requests).toHaveLength(2)); requests[1].acknowledge(); const first = await firstPending
  const secondPending = executor.apply(sourceMutation(id, 2_000_000), context)
  await vi.waitFor(() => expect(requests).toHaveLength(3)); requests[2].acknowledge(); const second = await secondPending
  let manual: ReturnType<typeof updateVideoEditSource> | undefined
  let manualCommand: ReturnType<typeof videoEditSourceCommandIdentity> | undefined
  const unsubscribe = subscribeVideoEditSource(() => {
    const state = readVideoEditSource(id)
    if (state.status === 'ready' && state.timeUs === 1_000_000 && !manual) {
      manual = updateVideoEditSource(id, { timeUs: 3_000_000 })
      manualCommand = videoEditSourceCommandIdentity(id)
    }
  })
  try {
    const rejected = expect(executor.undo(second.undoToken!)).rejects.toThrow('后续操作')
    expect(requests).toHaveLength(4); requests[3].acknowledge(); await rejected
    expect(requests).toHaveLength(5); expect(manual).toBeDefined(); requests[4].acknowledge(); await manual
    expect(readVideoEditSource(id)).toMatchObject({ timeUs: 3_000_000, presentedTimeUs: 3_000_000, status: 'ready' })
    expect(matchesVideoEditSourceCommand(id, manualCommand!)).toBe(true)
    await expect(executor.undo(first.undoToken!)).rejects.toThrow('后续操作')
    await expect(executor.undo(second.undoToken!)).rejects.toThrow('后续操作')
    expect(requests).toHaveLength(5); expect(instance.past).toHaveLength(history)
  } finally { unsubscribe(); off() }
})
