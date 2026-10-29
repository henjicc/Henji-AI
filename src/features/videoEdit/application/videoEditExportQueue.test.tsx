import { expectButtonDisabled, expectButtonEnabled } from '@/tests/buttonAssertions'
import { createVideoEditTestProject as createVideoEditProject, reopenVideoEdit } from './videoEditDocumentTestKit'
// @vitest-environment jsdom
import path from 'node:path'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { getPlatform } from '@/platform/runtime'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { createApplicationCallerGrant } from '@/core/application-control/callerContext'
import { createApplicationCapabilitySession } from '@/features/application-control/applicationCapabilityService'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { VIDEO_EDIT_EXPORT_PRESETS, patchVideoEditExportSettings, videoEditSequenceExportSettings } from '@/core/videoEdit/exportPresets'
import type { AssetRecord } from '@/platform/contracts/assetLibrary'
import type { VideoEditComposition } from '@/core/videoEdit/document'
import { makeVideoEditItemClip } from '@/core/videoEdit/projectItems'
import { runApplicationCloseGuards } from '@/core/applicationLifecycle/applicationCloseGuards'
import { appendVideoEditClip, appendVideoEditMedia, closeVideoEditProject, editVideoProject, editVideoSequence, getActiveVideoEditSequence, listVideoEditInstances, deleteVideoEditSequence, videoEditExportRange, undoVideoEdit, setVideoEditTimelineView } from './videoEditService'
import { VideoEditExportQueue, cancelWaitingVideoEditExport, enqueueVideoEditExports, listWaitingVideoEditExports, restoreVideoEditExports, videoEditExportQueue, retryVideoEditExportJob, videoEditQueuedExportTask, type VideoEditExportJob } from './videoEditExportQueue'
import { VideoEditExportPresetLibrary, videoEditExportPresetLibrary } from './videoEditExportPresets'
import { videoEditNativeMediaProbe } from './videoEditMediaProbe'
import { VideoEditExportProgress } from '../panels/VideoEditExportProgress'
import { VideoEditExportQueueList } from '../panels/VideoEditExportQueueList'
import { VideoEditExportDialog } from '../panels/VideoEditExportDialog'
import { exportVideoEdit, videoEditExportTask } from './videoEditExport'
import { applyVideoEditBuiltinEffect } from './videoEditCompositing'
import { resetVideoEditSmartRegionsForTests, startVideoEditSmartRegions } from './videoEditSmartRegions'
import type { SmartRegionProgressEvent, SmartRegionRequest } from '@/platform/contracts/smartRegions'
import type { VideoEditSmartRegionSegments } from '../engine/videoEditSmartRegionMasks'

const encoding = vi.hoisted(() => ({ rendered: [] as Array<[string, number]>, videoTimes: [] as number[], audio: [] as number[], finalize: vi.fn(), draw: vi.fn(), formats: [] as string[], videoOptions: [] as unknown[], audioOptions: [] as unknown[], pictures: [] as VideoEditComposition[], rendererOptions: [] as unknown[][], smartRegions: [] as VideoEditSmartRegionSegments[] }))
vi.mock('mediabunny', () => ({
  ALL_FORMATS: [], Input: class { dispose() {} async getPrimaryVideoTrack() { return { codec: 'avc', displayWidth: 1920, displayHeight: 1080, canDecode: async () => true, computeFrameRateMetrics: async () => ({ probedPacketCount: 4, bestGuessFrameRate: 30, frameRateIsConstant: true }) } } async getPrimaryAudioTrack() { return { codec: 'aac', numberOfChannels: 2, sampleRate: 48000, canDecode: async () => true } } async getAudioTracks() { return [await this.getPrimaryAudioTrack()] } async computeDuration() { return .2 } }, UrlSource: class {},
  Mp4OutputFormat: class { constructor() { encoding.formats.push('mp4') } }, AdtsOutputFormat: class { constructor() { encoding.formats.push('aac') } }, WavOutputFormat: class { constructor() { encoding.formats.push('wav') } }, StreamTarget: class {},
  Output: class { addVideoTrack() {} addAudioTrack() {} async start() {} finalize = encoding.finalize; async cancel() {} },
  CanvasSource: class { constructor(_canvas: unknown, options: unknown) { encoding.videoOptions.push(options) } async add(time: number) { encoding.videoTimes.push(time) } },
  AudioBufferSource: class { constructor(options: unknown) { encoding.audioOptions.push(options) } async add(buffer: AudioBuffer) { encoding.audio.push(buffer.length) } },
}))
vi.mock('../engine/videoEditRenderSession', () => ({ VideoEditRenderSession: class {
  canvas = {}; constructor(private composition: VideoEditComposition, ...options: unknown[]) { encoding.pictures.push(composition); encoding.rendererOptions.push(options) }
  updateDocument(document: VideoEditComposition) { this.composition = document }
  async renderBitmap() { return { bitmap: { width: 640, height: 360, close() {} } } }
  setSmartRegions(segments: VideoEditSmartRegionSegments) { encoding.smartRegions.push(segments) } setTracks() {} async dispose() {}
  async render(frame: number) { encoding.rendered.push([this.composition.name, frame]); return { singleFrameReads: 0 } }
  async mixAudio(_time: number, duration: number) { return new AudioBuffer({ numberOfChannels: this.composition.channels, sampleRate: this.composition.sampleRate, length: Math.round(duration * this.composition.sampleRate) }) }
} }))
const file = (name: string): string => path.resolve(path.sep, 'fixture', name)
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail }); return { promise, resolve, reject } }
const canEncodeVideo = vi.fn(async (_config: VideoEncoderConfig): Promise<boolean> => true)
const canEncodeAudio = vi.fn(async (_config: AudioEncoderConfig): Promise<boolean> => true)
beforeEach(() => {
  vi.stubGlobal('VideoEncoder', { isConfigSupported: async (config: VideoEncoderConfig) => ({ config, supported: await canEncodeVideo(config) }) })
  vi.stubGlobal('AudioEncoder', { isConfigSupported: async (config: AudioEncoderConfig) => ({ config, supported: await canEncodeAudio(config) }) })
  vi.mocked(canEncodeVideo).mockReset().mockResolvedValue(true)
  vi.mocked(canEncodeAudio).mockReset().mockResolvedValue(true)
  installHarnessNativeStorage(); encoding.rendered = []; encoding.videoTimes = []; encoding.audio = []; encoding.formats = []; encoding.videoOptions = []; encoding.audioOptions = []; encoding.pictures = []; encoding.rendererOptions = []; encoding.draw.mockClear(); encoding.finalize.mockReset().mockResolvedValue(undefined)
  videoEditExportQueue.clearFinished(); videoEditExportPresetLibrary.replace([])
  const platform = getPlatform()
  vi.spyOn(platform.videoEditExport, 'register').mockImplementation(async request => request.jobs.map(job => ({ id: job.id, retained: job.restorable })))
  vi.spyOn(platform.system.fs, 'writeTextFile').mockResolvedValue(undefined)
  vi.spyOn(platform.system.fs, 'writeFile').mockResolvedValue(undefined)
  vi.spyOn(platform.system.fs, 'exists').mockResolvedValue(false)
  vi.spyOn(platform.system.fs, 'remove').mockResolvedValue(undefined)
  vi.spyOn(platform.system.fs, 'mkdir').mockResolvedValue(undefined)
  vi.spyOn(platform.system.dialog, 'save').mockResolvedValue(file('output.mp4'))
  vi.spyOn(platform.system.paths, 'dirname').mockResolvedValue(file(''))
  const assets = new Map<string, AssetRecord>()
  vi.spyOn(platform.assetLibrary, 'createAsset').mockImplementation(async input => { const asset: AssetRecord = { id: crypto.randomUUID(), filePath: input.filePath, mediaType: input.mediaType, displayName: input.displayName ?? '成片', displayUrl: 'henji-media://local/output', source: 'video-edit', mimeType: 'video/mp4', sizeBytes: 5, fileModifiedAt: 1, contentIdentity: 'a'.repeat(64), width: 1920, height: 1080, durationSeconds: 1, thumbnailPath: null, thumbnailUrl: null, inspectionStatus: 'ready', inspectionError: null, createdAt: 1, updatedAt: 1, lastUsedAt: null, tags: [], libraryIds: [] }; assets.set(asset.id, asset); return asset })
  vi.spyOn(platform.assetLibrary, 'inspectAsset').mockImplementation(async id => assets.get(id)!)
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({ fillRect() {}, drawImage() {}, fillStyle: '', measureText: (text: string) => ({ width: text.length * 7 }) }) as unknown as CanvasRenderingContext2D)
  vi.spyOn(platform.assetLibrary, 'inspectFileContent').mockResolvedValue({ sizeBytes: 5, fileModifiedAt: 1, contentIdentity: 'a'.repeat(64) })
  vi.stubGlobal('OffscreenCanvas', class { constructor(readonly width: number, readonly height: number) {} getContext() { return { fillStyle: '', fillRect() {}, drawImage: encoding.draw } } })
  vi.stubGlobal('AudioBuffer', class { readonly length: number; readonly numberOfChannels: number; private planes: Float32Array[]; constructor({ numberOfChannels, length }: { numberOfChannels: number; length: number }) { this.length = length; this.numberOfChannels = numberOfChannels; this.planes = Array.from({ length: numberOfChannels }, () => new Float32Array(length)) } getChannelData(channel: number) { return this.planes[channel] } })
  const api = platform.audioEdit.loudness
  vi.spyOn(api, 'start').mockResolvedValue(undefined); vi.spyOn(api, 'append').mockResolvedValue(undefined); vi.spyOn(api, 'close').mockResolvedValue(undefined)
  vi.spyOn(api, 'measure').mockResolvedValue({ integratedLufs: -20, shortTermLufs: -20, samplePeakDbfs: -2, truePeakDbtp: -1, durationSeconds: 1 })
  vi.spyOn(api, 'normalize').mockResolvedValue({ integratedLufs: -14, shortTermLufs: -14, samplePeakDbfs: -2, truePeakDbtp: -1, durationSeconds: 1 })
  vi.spyOn(api, 'read').mockImplementation(async (_id, _start, frames) => [new Float32Array(frames), new Float32Array(frames)])
})
afterEach(async () => {
  cleanup()
  for (const job of videoEditExportQueue.list()) videoEditExportQueue.cancel(job.id)
  for (const job of videoEditExportQueue.list()) await videoEditExportQueue.wait(job.id)
  videoEditExportQueue.clearFinished()
  for (const owner of listVideoEditInstances()) await closeVideoEditProject(owner.document.id)
  vi.restoreAllMocks(); vi.unstubAllGlobals(); uninstallHarnessNativeStorage()
})
async function project() {
  const owner = (await createVideoEditProject())!; const id = owner.document.id
  appendVideoEditClip(id)
  editVideoSequence(id, owner.activeSequenceId, sequence => ({ ...sequence, width: 1920, height: 1080, clips: sequence.clips.map(clip => ({ ...clip, duration: 4 })) }))
  return owner
}
function localJob(owner: Awaited<ReturnType<typeof project>>, name: string): VideoEditExportJob {
  return { id: name, name, owner, presetName: name, snapshot: structuredClone(getActiveVideoEditSequence(owner)), range: videoEditExportRange(owner), rangeSource: 'content', settings: { ...VIDEO_EDIT_EXPORT_PRESETS[0].settings, loudness: null }, path: file(`${name}.mp4`), state: 'queued', controller: new AbortController(), release: vi.fn() }
}
it('登记完成前不编码；登记期间取消的状态在接收确认后同步，失败不启动任务', async () => {
  const owner = await project(); const gate = deferred<void>(); const run = vi.fn(async () => undefined)
  const mirror = { register: vi.fn(() => gate.promise), update: vi.fn(), remove: vi.fn() }
  const queue = new VideoEditExportQueue(run, mirror); const job = localJob(owner, 'registering')
  const submitted = queue.append([job])
  expect(run).not.toHaveBeenCalled(); queue.cancel(job.id)
  gate.resolve(); await submitted
  expect(run).not.toHaveBeenCalled()
  expect(mirror.update).toHaveBeenCalledWith(expect.objectContaining({ id: job.id, state: 'cancelled' }))
  mirror.register.mockRejectedValueOnce(new Error('登记失败'))
  const failed = localJob(owner, 'registration-failed')
  await expect(queue.append([failed])).rejects.toThrow('登记失败')
  expect(failed.state).toBe('failed'); expect(failed.release).toHaveBeenCalledOnce()
  expect(run).not.toHaveBeenCalled()
  mirror.register.mockResolvedValueOnce(undefined)
  await queue.retry(failed.id, vi.fn()); await queue.wait(failed.id)
  expect(mirror.register).toHaveBeenCalledTimes(3)
  expect(run).toHaveBeenCalledWith(failed)
})
it('快照导出等待中撤销智能效果，完成后仍把快照蒙版交给渲染器', async () => {
  const owner = await project(); const id = owner.document.id
  let progress!: (event: SmartRegionProgressEvent) => void
  const ensure = vi.spyOn(getPlatform().smartRegions, 'ensure').mockResolvedValue({ state: 'analyzing', progress: 0 })
  const cancel = vi.spyOn(getPlatform().smartRegions, 'cancel').mockResolvedValue(undefined)
  vi.spyOn(getPlatform().smartRegions, 'onProgress').mockImplementation(handler => { progress = handler; return () => {} })
  resetVideoEditSmartRegionsForTests(); startVideoEditSmartRegions(); encoding.smartRegions.length = 0
  try {
    appendVideoEditMedia(id, { id: 'video', path: file('source.mp4'), name: '视频', kind: 'video', durationSeconds: 1, width: 1920, height: 1080 })
    appendVideoEditClip(id, 'video')
    const clip = getActiveVideoEditSequence(owner).clips.find(clip => clip.kind === 'video')!
    applyVideoEditBuiltinEffect(id, owner.activeSequenceId, [clip.id], 'smart:face_mosaic')
    const exporting = exportVideoEdit(id, file('snapshot.mp4'))
    await vi.waitFor(() => expect(videoEditExportTask(id)?.state).toBe('running'))
    const issued = ensure.mock.calls.at(-1)![0] as SmartRegionRequest
    undoVideoEdit(id)
    progress({ request: issued, status: { state: 'ready', segment: { path: file('face.hsrg'), startUs: issued.startUs, endUs: issued.endUs, still: false, model: 'yunet', summary: { value: 1, peak: 1 } } } })
    await exporting
    expect(cancel).not.toHaveBeenCalled()
    expect(Object.values(encoding.smartRegions.at(-1)!)[0]?.face).toHaveLength(1)
  } finally { resetVideoEditSmartRegionsForTests() }
})
it('队列严格顺序；等待项可取消；失败不阻断后续；重试排到末尾且只释放各自租用', async () => {
  const owner = await project(); const gate = deferred<void>(); const order: string[] = []; let fail = true
  const queue = new VideoEditExportQueue(async job => { order.push(job.id); if (job.id === 'a') await gate.promise; if (job.id === 'b' && fail) throw new Error('codec failure') })
  const a = localJob(owner, 'a'); const b = localJob(owner, 'b'); const c = localJob(owner, 'c')
  queue.append([a, b, c]); expect(order).toEqual(['a']); queue.cancel('c'); expect(c.state).toBe('cancelled')
  gate.resolve(); await queue.wait('b'); expect(b.state).toBe('failed'); expect(order).toEqual(['a', 'b']); expect(a.release).toHaveBeenCalledOnce(); expect(c.release).toHaveBeenCalledOnce()
  fail = false; const release = vi.fn(); queue.retry('b', release); await queue.wait('b'); expect(b.state).toBe('completed'); expect(order).toEqual(['a', 'b', 'b']); expect(release).toHaveBeenCalledOnce()
  expect(() => queue.retry('a', vi.fn())).toThrow('只可重试')
})
it('取消运行项等待编码收尾后才执行下一项；取消等待不取消任务', async () => {
  const owner = await project(); const gate = deferred<void>(); const order: string[] = []
  const queue = new VideoEditExportQueue(async job => { order.push(job.id); if (job.id === 'a') await gate.promise })
  const a = localJob(owner, 'a'); const b = localJob(owner, 'b'); queue.append([a, b])
  const waiter = new AbortController(); const pending = queue.wait('a', waiter.signal); waiter.abort(new Error('停止等待')); await expect(pending).rejects.toThrow('停止等待'); expect(a.controller.signal.aborted).toBe(false)
  queue.cancel('a'); expect(a.state).toBe('running'); expect(order).toEqual(['a']); gate.resolve(); await queue.wait('b'); expect(a.state).toBe('cancelled'); expect(order).toEqual(['a', 'b'])
})
it('预设本机保存先写后发布；重开可读；写入失败与损坏输入不覆盖已有数据', () => {
  const values = new Map<string, string>(); const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: vi.fn((key: string, value: string) => { values.set(key, value) }) }
  const library = new VideoEditExportPresetLibrary(storage); const saved = library.save('我的竖版', VIDEO_EDIT_EXPORT_PRESETS[0].settings)
  expect(new VideoEditExportPresetLibrary(storage).list()).toContainEqual(saved)
  storage.setItem.mockImplementationOnce(() => { throw new Error('full') }); expect(() => library.save('失败', saved.settings)).toThrow('full'); expect(library.custom()).toEqual([saved])
  values.set('video-edit-export-presets', 'broken'); const broken = new VideoEditExportPresetLibrary(storage); expect(() => broken.save('新预设', saved.settings)).toThrow('损坏'); expect(values.get('video-edit-export-presets')).toBe('broken')
})
it('全部路径与范围确认后才批量提交；取消第二次选择不产生部分导出；范围错误不写文件', async () => {
  const owner = await project(); const projectId = owner.document.id
  vi.mocked(getPlatform().system.dialog.save).mockResolvedValueOnce(file('a.mp4')).mockResolvedValueOnce(null)
  expect(await enqueueVideoEditExports([{ projectId, presetId: 'builtin:douyin' }, { projectId, presetId: 'builtin:bilibili' }])).toEqual([])
  expect(videoEditExportQueue.list()).toHaveLength(0); expect(getPlatform().system.fs.writeFile).not.toHaveBeenCalled()
  await expect(enqueueVideoEditExports([{ projectId, range: { startFrame: 0, endFrame: 5 } }])).rejects.toThrow('范围')
  await expect(closeVideoEditProject(projectId)).resolves.toBeUndefined()
})
it('无设置面板的导出也显示进度，确认取消并完成清理后才可关闭；失败重试重新显示', async () => {
  const owner = await project()
  const gate = deferred<void>()
  encoding.finalize.mockImplementationOnce(() => gate.promise)
  const view = render(<VideoEditExportProgress />)
  let job!: VideoEditExportJob
  await act(async () => { [job] = await enqueueVideoEditExports([{ projectId: owner.document.id, path: file('progress.mp4') }]) })
  try {
  await waitFor(() => expect(encoding.finalize).toHaveBeenCalledOnce())
  expect(view.getByRole('dialog', { name: '正在导出' })).toBeTruthy()
  expect(view.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('100')
  expect(view.getByText(`保存位置：${file('progress.mp4')}`)).toBeTruthy()
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(view.getByRole('dialog')).toBeTruthy()
  fireEvent.click(view.getByRole('button', { name: '取消导出' }))
  expect(job.controller.signal.aborted).toBe(false)
  fireEvent.click(view.getByRole('button', { name: '确认取消导出' }))
  expect(job.controller.signal.aborted).toBe(true)
  await expect(runApplicationCloseGuards()).rejects.toThrow('导出')
  } finally { gate.resolve() }
  await act(async () => { gate.resolve(); await videoEditExportQueue.wait(job.id) })
  expect(view.getByRole('dialog', { name: '导出已取消' })).toBeTruthy()
  expect(job.finishedAt).toBeGreaterThanOrEqual(job.startedAt!)
  expect(getPlatform().system.fs.remove).toHaveBeenCalledWith(file('progress.mp4'))
  fireEvent.click(view.getByRole('button', { name: '完成' }))
  expect(view.queryByRole('dialog')).toBeNull()
  encoding.finalize.mockRejectedValueOnce(new Error('编码器中断'))
  await act(async () => {
    [job] = await enqueueVideoEditExports([{ projectId: owner.document.id, path: file('retry-progress.mp4') }])
    await videoEditExportQueue.wait(job.id)
  })
  expect(view.getByRole('dialog', { name: '导出失败' })).toBeTruthy()
  fireEvent.click(view.getByRole('button', { name: '完成' }))
  const retryGate = deferred<void>()
  encoding.finalize.mockImplementationOnce(() => retryGate.promise)
  await act(async () => { await retryVideoEditExportJob(job.id, 'accepted-retry') })
  expect(() => retryVideoEditExportJob(job.id, 'rejected-retry')).toThrow('只可重试')
  expect(job.invocationId).toBe('accepted-retry')
  expect(view.getByRole('dialog', { name: '正在导出' })).toBeTruthy()
  await act(async () => { retryGate.resolve(); await videoEditExportQueue.wait(job.id) })
  expect(view.getByRole('dialog', { name: '导出完成' })).toBeTruthy()
})
it('正式编码固定序列快照；输出帧率只影响画面；历史队列回执仍可收录，待处理阻止关闭', async () => {
  const owner = await project(); const projectId = owner.document.id; const gate = deferred<void>(); encoding.finalize.mockImplementationOnce(() => gate.promise)
  const settings = { ...VIDEO_EDIT_EXPORT_PRESETS.find(value => value.id === 'builtin:douyin')!.settings, fps: 60, loudness: null, addToLibrary: false, captionMode: 'none' as const }
  const jobs = await enqueueVideoEditExports([{ projectId, settings, path: file('a.mp4'), range: { startFrame: 1, endFrame: 3 } }, { projectId, settings: patchVideoEditExportSettings(settings, { format: 'wav' }), path: file('b.wav') }])
  editVideoSequence(projectId, owner.activeSequenceId, sequence => ({ ...sequence, name: '后续修改' }))
  await vi.waitFor(() => expect(encoding.finalize).toHaveBeenCalledOnce())
  await expect(runApplicationCloseGuards()).rejects.toThrow('导出'); gate.resolve(); await videoEditExportQueue.wait(jobs[1].id)
  expect(encoding.rendered.map(([, frame]) => frame)).toEqual([1, 1, 2, 2]); expect(encoding.rendered.every(([name]) => name !== '后续修改')).toBe(true)
  expect(encoding.videoTimes).toEqual([0, 1 / 60, 2 / 60, 3 / 60]); expect(encoding.audio.reduce((sum, value) => sum + value, 0)).toBe(.2 * getActiveVideoEditSequence(owner).sampleRate)
  expect(encoding.formats).toEqual(['mp4', 'wav']); expect(jobs[1].task?.output?.kind).toBe('audio'); expect(videoEditQueuedExportTask(projectId, jobs[0].id)).toBe(jobs[0].task)
  expect(encoding.draw).toHaveBeenCalledWith({}, 0, 0, 1920, 1080, 0, 656.25, 1080, 607.5)
})
it('正式队列单项失败可重试；已发布文件的回执失败不重新编码或删除', async () => {
  const owner = await project(); const projectId = owner.document.id
  encoding.finalize.mockRejectedValueOnce(new Error('encode failed'))
  const [job] = await enqueueVideoEditExports([{ projectId, path: file('failure.mp4') }]); await videoEditExportQueue.wait(job.id); expect(job.state).toBe('failed')
  retryVideoEditExportJob(job.id); await videoEditExportQueue.wait(job.id); expect(job.state).toBe('completed')
  vi.mocked(getPlatform().assetLibrary.inspectFileContent).mockRejectedValueOnce(new Error('inspect failed'))
  const [published] = await enqueueVideoEditExports([{ projectId, path: file('published.mp4') }]); await videoEditExportQueue.wait(published.id)
  expect(published.state).toBe('failed'); expect(published.task?.state).toBe('completed'); expect(() => retryVideoEditExportJob(published.id)).toThrow('已保存')
  expect(vi.mocked(getPlatform().system.fs.remove).mock.calls.map(([value]) => value)).not.toContain(file('published.mp4'))
})
it('并发提交同一个输出位置只有一项被接受；提交前取消不遗留活动租用', async () => {
  const owner = await project(); const projectId = owner.document.id; const gate = deferred<void>(); encoding.finalize.mockImplementationOnce(() => gate.promise)
  try {
    const results = await Promise.allSettled([enqueueVideoEditExports([{ projectId, path: file('same.mp4') }]), enqueueVideoEditExports([{ projectId, path: file('same.mp4') }])])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1); expect(videoEditExportQueue.list()).toHaveLength(1)
  } finally { gate.resolve(); for (const job of videoEditExportQueue.list()) await videoEditExportQueue.wait(job.id) }
  const choice = deferred<string | null>(); vi.mocked(getPlatform().system.dialog.save).mockImplementationOnce(() => choice.promise)
  const cancel = new AbortController(); const submission = enqueueVideoEditExports([{ projectId }], cancel.signal)
  const rejected = expect(submission).rejects.toThrow('取消选择'); cancel.abort(new Error('取消选择')); choice.resolve(file('cancelled.mp4')); await rejected
  expect(videoEditExportQueue.list()).toHaveLength(1); await expect(closeVideoEditProject(projectId)).resolves.toBeUndefined()
})
async function select(view: ReturnType<typeof render>, label: string, option: string): Promise<void> {
  fireEvent.click(view.getByRole('button', { name: label }))
  fireEvent.click(await view.findByRole('option', { name: option }))
}
it('面板完整默认设置不表示主动要求响度；用户关闭再启用后标为主动要求', async () => {
  const owner = await project()
  const ui = render(<VideoEditExportDialog projectId={owner.document.id} onClose={vi.fn()} />)
  await waitFor(() => expectButtonEnabled(ui.getByRole('button', { name: '加入队列' })))
  await act(async () => fireEvent.click(ui.getByRole('button', { name: '加入队列' })))
  await act(async () => { await videoEditExportQueue.wait(videoEditExportQueue.list()[0].id) })
  expect(videoEditExportQueue.list()[0].loudnessRequested).toBe(false)
  fireEvent.click(ui.getByRole('button', { name: '音频' }))
  fireEvent.click(ui.getByRole('switch', { name: '启用响度' }))
  fireEvent.click(ui.getByRole('switch', { name: '启用响度' }))
  vi.mocked(getPlatform().system.dialog.save).mockResolvedValueOnce(file('explicit.mp4'))
  await act(async () => fireEvent.click(ui.getByRole('button', { name: '加入队列' })))
  await act(async () => { await videoEditExportQueue.wait(videoEditExportQueue.list()[1].id) })
  expect(videoEditExportQueue.list()[1].loudnessRequested).toBe(true)
})
it('面板默认跟随、解锁变自定义，保存重命名删除；队列和立即导出使用相同设置', async () => {
  const owner = await project(); const close = vi.fn(); const ui = render(<VideoEditExportDialog projectId={owner.document.id} onClose={close} />)
  expect(ui.getByRole('textbox', { name: '导出文件名' }).closest('[data-ui-form-row="panel"]')?.getAttribute('data-label-width')).toBe('72')
  expect(ui.getByRole('button', { name: '管理导出预设' }).closest('[data-ui-form-trailing]')).not.toBeNull()
  expect(ui.getByRole('button', { name: '导出预设' }).textContent).toContain('与序列一致')
  expectButtonDisabled(ui.getByRole('button', { name: '导出分辨率' }))
  fireEvent.click(ui.getByRole('button', { name: '分辨率跟随序列' }))
  expect(ui.getByRole('button', { name: '导出预设' }).textContent).toContain('自定义')
  await select(ui, '导出分辨率', '1080 × 1920')
  fireEvent.click(ui.getByRole('button', { name: '管理导出预设' })); fireEvent.click(ui.getByRole('button', { name: '保存当前设置为预设' }))
  fireEvent.change(ui.getByLabelText('自定义预设名称'), { target: { value: '自定义竖版' } }); fireEvent.click(ui.getByRole('button', { name: '保存' }))
  expect(videoEditExportPresetLibrary.custom()[0].name).toBe('自定义竖版')
  await waitFor(() => expect(ui.queryByRole('dialog', { name: '保存导出预设' })).toBeNull()); await new Promise(resolve => setTimeout(resolve, 200))
  fireEvent.click(ui.getByRole('button', { name: '管理导出预设' })); fireEvent.click(await ui.findByRole('button', { name: '重命名' }))
  fireEvent.change(ui.getByLabelText('自定义预设名称'), { target: { value: '新名称' } }); fireEvent.click(ui.getByRole('button', { name: '保存' }))
  expect(videoEditExportPresetLibrary.custom()[0].name).toBe('新名称')
  await waitFor(() => expectButtonEnabled(ui.getByRole('button', { name: '加入队列' })))
  await act(async () => fireEvent.click(ui.getByRole('button', { name: '加入队列' })))
  await act(async () => { await videoEditExportQueue.wait(videoEditExportQueue.list()[0].id) })
  vi.mocked(getPlatform().system.dialog.save).mockResolvedValueOnce(null)
  await act(async () => fireEvent.click(ui.getByRole('button', { name: '导出' }))); expect(close).not.toHaveBeenCalled()
  vi.mocked(getPlatform().system.dialog.save).mockResolvedValueOnce(file('immediate.mp4'))
  await act(async () => fireEvent.click(ui.getByRole('button', { name: '导出' })))
  expect(videoEditExportQueue.list()).toHaveLength(2)
  expect(videoEditExportQueue.list()[1].settings).toEqual(videoEditExportQueue.list()[0].settings)
  expect(videoEditExportQueue.list()[1].range).toEqual(videoEditExportQueue.list()[0].range)
  await waitFor(() => expect(close).toHaveBeenCalledOnce())
  fireEvent.click(ui.getByRole('button', { name: '管理导出预设' })); fireEvent.click(ui.getByRole('button', { name: '删除自定义预设' }))
  expect(videoEditExportPresetLibrary.custom()).toEqual([])
})
it('助手从通用目录读取预设，跨序列/剪辑一次批量提交、查询与单项取消，错误引用不部分提交', async () => {
  const first = await project(); const second = await project(); const app = createApplicationHarness(); const gate = deferred<void>(); encoding.finalize.mockImplementationOnce(() => gate.promise)
  try {
    const catalog = await app.requireResult('list_application_entities', { entityType: 'video_edit.export_preset' }); expect(JSON.stringify(catalog)).toContain('抖音')
    const presetState = await app.read({ kind: 'video_edit.export_preset', id: 'builtin:douyin' }, ['video_edit.export_preset.settings']); expect((presetState.properties as Record<string, { width: number }>)['video_edit.export_preset.settings'].width).toBe(1080)
    vi.mocked(getPlatform().system.dialog.save).mockResolvedValueOnce(file('vertical.mp4')).mockResolvedValueOnce(file('horizontal.mp4'))
    const result = await app.requireResult('export_video_edit', { documentRef: { kind: 'video_edit.document', id: first.document.id }, exports: [
      { presetRef: { kind: 'video_edit.export_preset', id: 'builtin:douyin' }, range: { startFrame: 1, endFrame: 3 } },
      { documentRef: { kind: 'video_edit.document', id: second.document.id }, sequenceRef: { kind: 'video_edit.sequence', id: `${second.document.id}:${second.activeSequenceId}` }, presetRef: { kind: 'video_edit.export_preset', id: 'builtin:bilibili' }, fit: 'fill' },
    ] })
    expect(result.queue).toHaveLength(2)
    const jobs = videoEditExportQueue.list(); expect(jobs[1].settings.fit).toBe('fill'); expect(jobs[0].range).toEqual({ startFrame: 1, endFrame: 3 })
    // 助手/外部智能体导出不弹保存对话框（无人可点会一直等待），默认放进项目“导出”文件夹。
    expect(getPlatform().system.dialog.save).not.toHaveBeenCalled()
    for (const job of jobs) expect(job.path).toMatch(/导出[\\/][^\\/]+\.mp4$/)
    const read = await app.requireResult('query_video_edit_export', { detail: 'full', documentRef: { kind: 'video_edit.document', id: second.document.id } }); expect(read.queue).toHaveLength(1)
    expect((await app.call('cancel_video_edit_export', { documentRef: { kind: 'video_edit.document', id: first.document.id }, taskId: jobs[1].id })).ok).toBe(false)
    await app.requireResult('cancel_video_edit_export', { documentRef: { kind: 'video_edit.document', id: second.document.id }, taskId: jobs[1].id }); expect(jobs[1].state).toBe('cancelled')
    const bad = await app.call('export_video_edit', { documentRef: { kind: 'video_edit.document', id: first.document.id }, exports: [{ presetRef: { kind: 'video_edit.export_preset', id: 'builtin:douyin' }, sequenceRef: { kind: 'video_edit.sequence', id: `${second.document.id}:${second.activeSequenceId}` } }] }); expect(bad.ok).toBe(false); expect(videoEditExportQueue.list()).toHaveLength(2)
  } finally { gate.resolve(); for (const job of videoEditExportQueue.list()) await videoEditExportQueue.wait(job.id); app.dispose() }
})
it('助手通用集合保存/删除自定义预设，内置删除拒绝，回读本机真相而不修改剪辑历史', async () => {
  const owner = await project(); const before = owner.past.length; const app = createApplicationHarness()
  try {
    const created = await app.requireResult('change_application_entities', { summary: '保存导出模板', changes: [{ kind: 'create_items', entityType: 'video_edit.export_preset', parent: { kind: 'video_edit.document', id: owner.document.id }, items: [{ properties: { 'video_edit.export_preset.name': '助手模板', 'video_edit.export_preset.settings': VIDEO_EDIT_EXPORT_PRESETS[0].settings } }] }] })
    expect(created).toBeDefined(); const preset = videoEditExportPresetLibrary.custom()[0]; expect(preset.name).toBe('助手模板')
    const renamed = await app.change({ kind: 'video_edit.export_preset', id: preset.id }, { 'video_edit.export_preset.name': '助手重命名' }); if (!renamed.ok) throw new Error(JSON.stringify(renamed.error))
    expect(videoEditExportPresetLibrary.custom()[0].name).toBe('助手重命名')
    const state = await app.read({ kind: 'video_edit.export_preset', id: preset.id }, ['video_edit.export_preset.name']); expect(JSON.stringify(state)).toContain('助手重命名')
    await app.requireResult('change_application_entities', { summary: '删除导出模板', changes: [{ kind: 'remove_items', entityType: 'video_edit.export_preset', parent: { kind: 'video_edit.document', id: owner.document.id }, targets: [{ kind: 'video_edit.export_preset', id: preset.id }] }] }, state.revisions as Record<string, number>)
    expect(videoEditExportPresetLibrary.custom()).toEqual([]); expect(owner.past).toHaveLength(before)
    const builtin = await app.read({ kind: 'video_edit.export_preset', id: 'builtin:douyin' }, ['video_edit.export_preset.name'])
    expect((await app.call('change_application_entities', { summary: '不能删除内置模板', changes: [{ kind: 'remove_items', entityType: 'video_edit.export_preset', parent: { kind: 'video_edit.document', id: owner.document.id }, targets: [{ kind: 'video_edit.export_preset', id: 'builtin:douyin' }] }] }, builtin.revisions as Record<string, number>)).ok).toBe(false)
  } finally { app.dispose() }
})

it('8K120帧母版导出实际选HEVC并保持120帧时钟', async () => {
  const owner = await project()
  editVideoSequence(owner.document.id, owner.activeSequenceId, sequence => ({ ...sequence, width: 7680, height: 4320, frameRate: { numerator: 120, denominator: 1 } }))
  const jobs = await enqueueVideoEditExports([{ projectId: owner.document.id, presetId: 'builtin:master', path: file('8k.mp4') }])
  const job = await videoEditExportQueue.wait(jobs[0].id)
  expect(job.state).toBe('completed')
  expect(encoding.videoOptions).toEqual([{ codec: 'hevc', bitrate: 20_000_000, bitrateMode: 'variable', hardwareAcceleration: 'prefer-hardware', fullCodecString: 'hev1.1.6.L186.B0', latencyMode: 'quality', alpha: 'discard', onEncoderConfig: expect.any(Function) }])
  expect(encoding.videoTimes).toEqual([0, 1 / 120, 2 / 120, 3 / 120])
})
it('导出面板对设备不支持的8K120帧禁用动作并给出降低规格的恢复方式', async () => {
  const owner = await project()
  editVideoSequence(owner.document.id, owner.activeSequenceId, sequence => ({ ...sequence, width: 7680, height: 4320, frameRate: { numerator: 120, denominator: 1 } }))
  vi.mocked(canEncodeVideo).mockResolvedValue(false)
  const view = render(<VideoEditExportDialog projectId={owner.document.id} onClose={vi.fn()} />)
  await waitFor(() => expect(view.getByText(/当前设备不支持所选编码设置/)).toBeTruthy())
  expectButtonDisabled(view.getByRole('button', { name: '导出' }))
  expectButtonDisabled(view.getByRole('button', { name: '加入队列' }))
  await select(view, '导出预设', '仅音频 · AAC')
  await waitFor(() => expectButtonEnabled(view.getByRole('button', { name: '导出' })))
})

it('导出队列接纳300项，仍串行处理而不按128项拒绝', async () => {
  const owner = await project(); let active = 0; let peak = 0
  const queue = new VideoEditExportQueue(async () => { peak = Math.max(peak, ++active); await Promise.resolve(); active-- })
  queue.append(Array.from({ length: 300 }, (_, index) => localJob(owner, `large-${index}`)))
  await queue.wait('large-299'); expect(queue.list()).toHaveLength(300); expect(peak).toBe(1)
})

it('4K60默认提交跟随序列；真实编码收到CBR软件关键帧与重采样声道参数', async () => {
  const owner = await project(); editVideoSequence(owner.document.id, owner.activeSequenceId, sequence => ({ ...sequence, width: 3840, height: 2160, frameRate: { numerator: 60, denominator: 1 } }))
  const [defaultJob] = await enqueueVideoEditExports([{ projectId: owner.document.id, path: file('4k.mp4') }]); await videoEditExportQueue.wait(defaultJob.id)
  expect(defaultJob.presetName).toBe('与序列一致'); expect(defaultJob.settings).toMatchObject({ width: 3840, height: 2160, fps: 60, videoBitrateMbps: 50 }); expect(defaultJob.task?.assetRef?.kind).toBe('asset')
  const settings = { ...defaultJob.settings, loudness: null, encoderPreference: 'software' as const, bitrateMode: 'cbr' as const, keyframeInterval: 1 as const, sampleRate: 44100 as const, channels: 1 as const, followSequence: { ...defaultJob.settings.followSequence, sampleRate: false, channels: false } }
  const [job] = await enqueueVideoEditExports([{ projectId: owner.document.id, path: file('cbr.mp4'), settings }]); await videoEditExportQueue.wait(job.id)
  expect(job.state).toBe('completed'); expect(encoding.videoOptions.at(-1)).toMatchObject({ bitrateMode: 'constant', hardwareAcceleration: 'prefer-software', keyFrameInterval: 1 })
  expect(encoding.audioOptions.at(-1)).toMatchObject({ codec: 'aac', transform: { sampleRate: 44100, numberOfChannels: 1 } })
})
it.each(['burn', 'srt', 'vtt'] as const)('字幕%s进入正式画面或同名独立文件；关闭音频不混音不标准化', async captionMode => {
  const owner = await project(); editVideoSequence(owner.document.id, owner.activeSequenceId, sequence => ({ ...sequence, captions: [{ id: 'caption', start: 0, duration: 3, text: '对白' }] }))
  const files = new Map<string, Uint8Array>()
  vi.mocked(getPlatform().system.fs.writeFile).mockImplementation(async (path, bytes) => { files.set(path, bytes) })
  vi.spyOn(getPlatform().system.fs, 'readTextFile').mockImplementation(async path => new TextDecoder().decode(files.get(path)))
  const settings = { ...videoEditSequenceExportSettings(getActiveVideoEditSequence(owner)), audioEnabled: false, captionMode, addToLibrary: false }
  const [job] = await enqueueVideoEditExports([{ projectId: owner.document.id, path: file('caption.mp4'), settings }]); await videoEditExportQueue.wait(job.id)
  expect(job.state).toBe('completed'); expect(encoding.audio).toEqual([]); expect(encoding.audioOptions).toEqual([]); expect(getPlatform().audioEdit.loudness.normalize).not.toHaveBeenCalled()
  expect(encoding.pictures[0].captions?.length).toBe(captionMode === 'burn' ? 1 : 0)
  expect(files.has(file(`caption.${captionMode}`))).toBe(captionMode !== 'burn')
  if (captionMode !== 'burn') expect(new TextDecoder().decode(files.get(file(`caption.${captionMode}`)))).toContain('对白')
})
it('仅音频WAV不编码视频，关闭响度不创建PCM标准化会话；显式代理传给共同渲染入口', async () => {
  const owner = await project(); const settings = patchVideoEditExportSettings(videoEditSequenceExportSettings(getActiveVideoEditSequence(owner)), { format: 'wav', loudness: null, useProxies: true, addToLibrary: false, captionMode: 'none' })
  const [job] = await enqueueVideoEditExports([{ projectId: owner.document.id, path: file('sound.wav'), settings }]); await videoEditExportQueue.wait(job.id)
  expect(job.state).toBe('completed'); expect(encoding.videoOptions).toEqual([]); expect(encoding.rendered).toEqual([]); expect(encoding.audioOptions).toEqual([{ codec: 'pcm-s24', transform: { sampleRate: 48000, numberOfChannels: 2 } }]); expect(getPlatform().audioEdit.loudness.start).not.toHaveBeenCalled()
  expect(encoding.rendererOptions[0].slice(-2)).toEqual([owner.document.id, true])
})
it('默认按设备切到H264软件；手动选择HEVC后禁用不支持的CBR', async () => {
  const owner = await project(); vi.mocked(canEncodeVideo).mockImplementation(async config => config.codec.startsWith('hev1') ? config?.bitrateMode !== 'constant' : config?.hardwareAcceleration === 'prefer-software')
  const view = render(<VideoEditExportDialog projectId={owner.document.id} onClose={vi.fn()} />)
  await waitFor(() => expectButtonEnabled(view.getByRole('button', { name: '导出' })))
  expect(view.getByRole('button', { name: '编码性能' }).textContent).toContain('软件编码')
  expect(view.getByRole('button', { name: '导出预设' }).textContent).toContain('与序列一致')
  fireEvent.click(view.getByRole('button', { name: '导出格式' })); expectButtonEnabled(view.getByRole('option', { name: 'MP4 · H.264' }))
  fireEvent.click(view.getByRole('option', { name: 'MP4 · HEVC (H.265)' }))
  await waitFor(() => expectButtonEnabled(view.getByRole('button', { name: '导出' })))
  fireEvent.click(view.getByRole('button', { name: '码率模式' })); expectButtonDisabled(view.getByRole('option', { name: 'CBR' }))
  fireEvent.click(view.getByRole('option', { name: 'VBR' })); await select(view, '编码性能', '软件编码')
  expect(view.getByRole('button', { name: '导出预设' }).textContent).toContain('自定义')
})

it('4K60硬件拒绝：面板禁用硬件并说明原因，AAC禁用64/256/320；助手仅传mp4适配软件后完成', async () => {
  const owner = await project()
  editVideoSequence(owner.document.id, owner.activeSequenceId, sequence => ({ ...sequence, width: 3840, height: 2160, frameRate: { numerator: 60, denominator: 1 }, sampleRate: 44100, channels: 1 }))
  canEncodeVideo.mockImplementation(async config => config.hardwareAcceleration === 'prefer-software')
  canEncodeAudio.mockImplementation(async config => [96000, 128000, 160000, 192000].includes(config.bitrate!))
  vi.mocked(getPlatform().audioEdit.loudness.read).mockImplementation(async (_id, _start, frames) => [new Float32Array(frames)])
  const view = render(<VideoEditExportDialog projectId={owner.document.id} onClose={vi.fn()} />)
  await waitFor(() => expectButtonEnabled(view.getByRole('button', { name: '导出' })))
  expect(view.getByRole('button', { name: '导出格式' }).textContent).toContain('H.264')
  expect(view.getByRole('button', { name: '编码性能' }).textContent).toContain('软件编码')
  fireEvent.click(view.getByRole('button', { name: '编码性能' }))
  const hardware = view.getByRole('option', { name: '硬件加速' })
  expectButtonDisabled(hardware)
  expectButtonEnabled(view.getByRole('option', { name: '软件编码' }))
  fireEvent.mouseEnter(hardware)
  await waitFor(() => expect(view.getByRole('tooltip').textContent).toContain('当前设备不支持此规格'))
  fireEvent.mouseLeave(hardware)
  fireEvent.click(view.getByRole('option', { name: '软件编码' }))
  fireEvent.click(view.getByRole('button', { name: '音频' }))
  fireEvent.click(view.getByRole('button', { name: '音频码率' }))
  for (const bitrate of [64, 256, 320]) expectButtonDisabled(view.getByRole('option', { name: `${bitrate} kbps` }))
  for (const bitrate of [96, 128, 160, 192]) expectButtonEnabled(view.getByRole('option', { name: `${bitrate} kbps` }))
  cleanup()
  const app = createApplicationHarness()
  try {
    await app.requireResult('export_video_edit', { documentRef: { kind: 'video_edit.document', id: owner.document.id }, format: 'mp4' })
    const job = await videoEditExportQueue.wait(videoEditExportQueue.list()[0].id)
    expect(job.error).toBeUndefined()
    expect(job.state).toBe('completed')
    expect(job.settings).toMatchObject({ codec: 'avc', encoderPreference: 'software', width: 3840, height: 2160, fps: 60, sampleRate: 44100, channels: 1, audioBitrateKbps: 192 })
    expect(encoding.videoOptions.at(-1)).toMatchObject({ codec: 'avc', hardwareAcceleration: 'prefer-software', latencyMode: 'quality' })
  } finally { app.dispose() }
})

it('显式关闭自动收录后，正式公共能力导出不写入素材库', async () => {
  const owner = await project(); const session = createApplicationCapabilitySession(createApplicationCallerGrant({ callerId: 'export-only' }))
  const input = { documentRef: { kind: 'video_edit.document', id: owner.document.id } }; const context = { requestId: crypto.randomUUID(), signal: new AbortController().signal }
  const allowed = await session.execute({ id: 'export_video_edit', version: 1, input: { ...input, settings: { ...videoEditSequenceExportSettings(getActiveVideoEditSequence(owner)), addToLibrary: false } } }, context)
  expect(allowed.ok).toBe(true); await videoEditExportQueue.wait(videoEditExportQueue.list()[0].id)
  expect(getPlatform().assetLibrary.createAsset).not.toHaveBeenCalled()
})
it('开关从实际面板提交仅音频，默认烧录的字幕改为SRT，响度关闭；折叠状态重新打开后保留', async () => {
  const owner = await project(); const view = render(<VideoEditExportDialog projectId={owner.document.id} onClose={vi.fn()} />)
  expect(view.getByRole('button', { name: '音频' }).getAttribute('aria-expanded')).toBe('false')
  expect(view.getByRole('switch', { name: '启用字幕' }).getAttribute('aria-checked')).toBe('true')
  fireEvent.click(view.getByRole('button', { name: '音频' })); fireEvent.click(view.getByRole('switch', { name: '启用响度' })); fireEvent.click(view.getByRole('switch', { name: '启用视频' }))
  expect(view.getByRole('switch', { name: '启用音频' })).toHaveProperty('disabled', true)
  const files = new Map<string, Uint8Array>(); vi.mocked(getPlatform().system.fs.writeFile).mockImplementation(async (path, bytes) => { files.set(path, bytes) }); vi.spyOn(getPlatform().system.fs, 'readTextFile').mockImplementation(async path => new TextDecoder().decode(files.get(path)))
  vi.mocked(getPlatform().system.dialog.save).mockResolvedValueOnce(file('only-audio.aac'))
  await waitFor(() => expectButtonEnabled(view.getByRole('button', { name: '加入队列' })))
  await act(async () => fireEvent.click(view.getByRole('button', { name: '加入队列' })))
  const job = videoEditExportQueue.list()[0]; await act(async () => { await videoEditExportQueue.wait(job.id) })
  expect(job.settings).toMatchObject({ videoEnabled: false, audioEnabled: true, loudness: null, captionMode: 'srt', format: 'aac' }); expect(job.state).toBe('completed')
  view.unmount(); const reopened = render(<VideoEditExportDialog projectId={owner.document.id} onClose={vi.fn()} />)
  expect(reopened.getByRole('button', { name: '音频' }).getAttribute('aria-expanded')).toBe('true')
})

it('设备仅支持HEVC软件CBR时默认自动适配并保留预设名称', async () => {
  const owner = await project(); vi.mocked(canEncodeVideo).mockImplementation(async config => config.codec.startsWith('hev1') && config?.bitrateMode === 'constant' && config?.hardwareAcceleration === 'prefer-software')
  const view = render(<VideoEditExportDialog projectId={owner.document.id} onClose={vi.fn()} />)
  await waitFor(() => expectButtonEnabled(view.getByRole('button', { name: '导出' })))
  expect(view.getByRole('button', { name: '导出格式' }).textContent).toContain('HEVC')
  expect(view.getByRole('button', { name: '导出预设' }).textContent).toContain('与序列一致')
  expect(view.getByRole('button', { name: '编码性能' }).textContent).toContain('软件编码'); expect(view.getByRole('button', { name: '码率模式' }).textContent).toContain('CBR')
  expectButtonEnabled(view.getByRole('button', { name: '导出' }))
})

it('音频码率按设备禁用并提示；高码率预设自动回落，采样率和声道变化重新判断', async () => {
  const owner = await project()
  vi.mocked(canEncodeAudio).mockImplementation(async config => Number(config?.bitrate) <= (config?.numberOfChannels === 1 ? 96000 : config?.sampleRate === 44100 ? 128000 : 192000))
  const high = videoEditExportPresetLibrary.save('高码率', { ...videoEditSequenceExportSettings(getActiveVideoEditSequence(owner)), audioBitrateKbps: 320 })
  const view = render(<VideoEditExportDialog projectId={owner.document.id} onClose={vi.fn()} />)
  fireEvent.click(view.getByRole('button', { name: '音频' }))
  await select(view, '导出预设', high.name)
  await waitFor(() => expect(view.getByRole('button', { name: '音频码率' }).textContent).toContain('192 kbps'))
  expect(view.getByRole('button', { name: '导出预设' }).textContent).toContain(high.name)
  fireEvent.click(view.getByRole('button', { name: '音频码率' }))
  const unsupported = view.getByRole('option', { name: '320 kbps' })
  expectButtonDisabled(unsupported)
  expectButtonDisabled(view.getByRole('option', { name: '256 kbps' }))
  expectButtonEnabled(view.getByRole('option', { name: '192 kbps' }))
  fireEvent.mouseEnter(unsupported)
  await waitFor(() => expect(view.getByRole('tooltip').textContent).toBe('此设备不支持该码率'))
  fireEvent.mouseLeave(unsupported)
  fireEvent.click(view.getByRole('option', { name: '192 kbps' }))
  fireEvent.click(view.getByRole('button', { name: '采样率跟随序列' }))
  await select(view, '音频采样率', '44100 Hz')
  await waitFor(() => expect(view.getByText(/此设备的 AAC 编码不支持 192 kbps/)).toBeTruthy())
  expectButtonDisabled(view.getByRole('button', { name: '导出' }))
  await select(view, '音频码率', '128 kbps')
  expect(canEncodeAudio).toHaveBeenCalledWith(expect.objectContaining({ sampleRate: 44100, numberOfChannels: 2, bitrate: 192000 }))
  fireEvent.click(view.getByRole('button', { name: '声道跟随序列' }))
  await select(view, '音频声道', '单声道')
  await waitFor(() => expect(view.getByText(/此设备的 AAC 编码不支持 128 kbps/)).toBeTruthy())
  await select(view, '音频码率', '96 kbps')
  expect(canEncodeAudio).toHaveBeenCalledWith(expect.objectContaining({ sampleRate: 44100, numberOfChannels: 1, bitrate: 128000 }))
  await waitFor(() => expectButtonEnabled(view.getByRole('button', { name: '导出' })))
})

it('跟随序列的声音规格变化会重新探测；AAC全不可用时阻止提交，改WAV可恢复', async () => {
  const owner = await project()
  vi.mocked(canEncodeAudio).mockImplementation(async config => config?.sampleRate === 48000 && Number(config?.bitrate) <= 192000)
  const view = render(<VideoEditExportDialog projectId={owner.document.id} onClose={vi.fn()} />)
  await waitFor(() => expectButtonEnabled(view.getByRole('button', { name: '导出' })))
  act(() => editVideoSequence(owner.document.id, owner.activeSequenceId, sequence => ({ ...sequence, sampleRate: 44100, channels: 1 })))
  await waitFor(() => expect(view.getByText(/此设备的 AAC 编码不支持/)).toBeTruthy())
  expectButtonDisabled(view.getByRole('button', { name: '导出' }))
  expectButtonDisabled(view.getByRole('button', { name: '加入队列' }))
  await select(view, '导出格式', '音频 · WAV')
  await waitFor(() => expectButtonEnabled(view.getByRole('button', { name: '导出' })))
})

it('立即导出、队列和助手在文件选择与写入前拒绝不支持的AAC；修正码率后可完成', async () => {
  const owner = await project(); const snapshot = getActiveVideoEditSequence(owner)
  vi.mocked(canEncodeAudio).mockImplementation(async config => Number(config?.bitrate) <= 192000)
  const settings = { ...videoEditSequenceExportSettings(snapshot), audioBitrateKbps: 320, addToLibrary: false, loudness: null }
  const message = '此设备的 AAC 编码不支持 320 kbps（48 kHz，立体声），请改用 192 kbps 或更低。'
  await expect(exportVideoEdit(owner.document.id, undefined, false, undefined, undefined, { snapshot, range: videoEditExportRange(owner), settings })).rejects.toThrow(message)
  await expect(enqueueVideoEditExports([{ projectId: owner.document.id, settings }])).rejects.toThrow(message)
  const app = createApplicationHarness()
  try {
    const result = await app.call('export_video_edit', { documentRef: { kind: 'video_edit.document', id: owner.document.id }, settings })
    expect(result.ok).toBe(false); expect(JSON.stringify(result)).toContain(message)
    expect(getPlatform().system.dialog.save).not.toHaveBeenCalled()
    expect(getPlatform().system.fs.writeFile).not.toHaveBeenCalled()
    expect(videoEditExportQueue.list()).toHaveLength(0); expect(owner.busy).toBe(false)
    const recovered = await app.call('export_video_edit', { documentRef: { kind: 'video_edit.document', id: owner.document.id }, settings: { ...settings, audioBitrateKbps: 192 } })
    expect(recovered.ok).toBe(true)
    const job = await videoEditExportQueue.wait(videoEditExportQueue.list()[0].id)
    expect(job.state).toBe('completed')
    expect(encoding.audioOptions.at(-1)).toMatchObject({ bitrate: 192000 })
  } finally { app.dispose() }
})

it('探测后底层意外拒绝AAC时任务错误仍为中文，失败文件被清理', async () => {
  const owner = await project()
  encoding.finalize.mockRejectedValueOnce(new Error('This specific encoder configuration (mp4a.40.2, 192000 bps, 2 channels, 48000 Hz) is not supported in this environment.'))
  const [job] = await enqueueVideoEditExports([{ projectId: owner.document.id, path: file('native-rejection.mp4') }])
  await videoEditExportQueue.wait(job.id)
  expect(job.state).toBe('failed')
  expect(job.error).toContain('此设备的 AAC 编码不支持 192 kbps')
  expect(job.task?.error).toBe(job.error); expect(job.error).not.toContain('mp4a.40.2')
  expect(getPlatform().system.fs.remove).toHaveBeenCalledWith(file('native-rejection.mp4'))
})

it('4K60面板默认回落HEVC且保留与序列一致，提交的完整配置通过同一探测并导出成功', async () => {
  const owner = await project()
  editVideoSequence(owner.document.id, owner.activeSequenceId, sequence => ({ ...sequence, width: 3840, height: 2160, frameRate: { numerator: 60, denominator: 1 } }))
  vi.mocked(canEncodeVideo).mockImplementation(async config => config.codec.startsWith('hev1'))
  const onClose = vi.fn(); const view = render(<VideoEditExportDialog projectId={owner.document.id} onClose={onClose} />)
  expectButtonDisabled(view.getByRole('button', { name: '导出' }))
  await waitFor(() => expectButtonEnabled(view.getByRole('button', { name: '导出' })))
  expect(view.getByRole('button', { name: '导出预设' }).textContent).toContain('与序列一致')
  expect(view.getByRole('button', { name: '导出格式' }).textContent).toContain('HEVC')
  expect(view.getByText(/HEVC · 3840 × 2160 · 60 帧 · 50 Mbps/)).toBeTruthy()
  const panelConfig = { width: 3840, height: 2160, bitrate: 25_000_000, bitrateMode: 'variable', hardwareAcceleration: 'prefer-hardware' }
  expect(canEncodeVideo).toHaveBeenCalledWith(expect.objectContaining(panelConfig))
  await act(async () => fireEvent.click(view.getByRole('button', { name: '导出' })))
  const job = videoEditExportQueue.list()[0]
  await act(async () => { await videoEditExportQueue.wait(job.id) })
  expect(job.state).toBe('completed'); expect(onClose).toHaveBeenCalledOnce()
  expect(job.settings).toMatchObject({ codec: 'hevc', width: 3840, height: 2160, fps: 60, videoBitrateMbps: 50 })
  expect(canEncodeVideo).toHaveBeenCalledWith(expect.objectContaining(panelConfig))
  expect(encoding.videoOptions.at(-1)).toMatchObject({ codec: 'hevc', bitrate: 25_000_000, bitrateMode: 'variable', hardwareAcceleration: 'prefer-hardware' })
})
it('序列从1080p变为4K60会重新适配；手动把码率调到不可用时禁用导出且不静默替换', async () => {
  const owner = await project()
  vi.mocked(canEncodeVideo).mockImplementation(async config => Number(config?.bitrate) <= (config?.width === 1920 ? 50_000_000 : 25_000_000) && (config?.width === 1920 || config.codec.startsWith('hev1')))
  const view = render(<VideoEditExportDialog projectId={owner.document.id} onClose={vi.fn()} />)
  await waitFor(() => expectButtonEnabled(view.getByRole('button', { name: '导出' })))
  expect(view.getByRole('button', { name: '导出格式' }).textContent).toContain('H.264')
  act(() => editVideoSequence(owner.document.id, owner.activeSequenceId, sequence => ({ ...sequence, width: 3840, height: 2160, frameRate: { numerator: 60, denominator: 1 } })))
  expectButtonDisabled(view.getByRole('button', { name: '导出' }))
  await waitFor(() => expect(view.getByText(/HEVC · 3840 × 2160 · 60 帧 · 50 Mbps/)).toBeTruthy())
  await waitFor(() => expectButtonEnabled(view.getByRole('button', { name: '导出' })))
  fireEvent.change(view.getByRole('slider', { name: '目标码率滑杆' }), { target: { value: '100' } })
  await waitFor(() => expect(view.getByText(/当前设备不支持所选编码设置/)).toBeTruthy())
  expectButtonDisabled(view.getByRole('button', { name: '导出' }))
  expect(view.getByRole('button', { name: '导出预设' }).textContent).toContain('自定义')
  expect(view.getByRole('slider', { name: '目标码率滑杆' })).toHaveProperty('value', '100')
  fireEvent.click(view.getByRole('button', { name: '编码性能' }))
  const unsupported = view.getByRole('option', { name: '软件编码' })
  expectButtonDisabled(unsupported)
  fireEvent.mouseEnter(unsupported)
  await waitFor(() => expect(view.getByRole('tooltip').textContent).toContain('当前设备不支持此规格'))
})
it('助手完整settings严格拒绝不支持H264且不选路径；只传预设则同源回落HEVC并完成', async () => {
  const owner = await project()
  editVideoSequence(owner.document.id, owner.activeSequenceId, sequence => ({ ...sequence, width: 3840, height: 2160, frameRate: { numerator: 60, denominator: 1 } }))
  vi.mocked(canEncodeVideo).mockImplementation(async config => config.codec.startsWith('hev1'))
  const app = createApplicationHarness(); const documentRef = { kind: 'video_edit.document', id: owner.document.id }
  try {
    const settings = videoEditSequenceExportSettings(getActiveVideoEditSequence(owner))
    const explicit = await app.call('export_video_edit', { documentRef, exports: [{ presetRef: { kind: 'video_edit.export_preset', id: 'builtin:sequence' }, settings }] })
    expect(explicit.ok).toBe(false); expect(JSON.stringify(explicit)).toContain('当前设备不支持所选编码设置')
    const topLevel = await app.call('export_video_edit', { documentRef, settings })
    expect(topLevel.ok).toBe(false)
    expect(videoEditExportQueue.list()).toHaveLength(0); expect(getPlatform().system.dialog.save).not.toHaveBeenCalled(); expect(getPlatform().system.fs.writeFile).not.toHaveBeenCalled()
    const presetOnly = await app.requireResult('export_video_edit', { documentRef, exports: [{ presetRef: { kind: 'video_edit.export_preset', id: 'builtin:sequence' } }] })
    expect(JSON.stringify(presetOnly)).toContain('hevc')
    const job = await videoEditExportQueue.wait(videoEditExportQueue.list()[0].id)
    expect(job.state).toBe('completed'); expect(job.presetName).toBe('与序列一致'); expect(job.settings).toMatchObject({ codec: 'hevc', width: 3840, height: 2160, fps: 60, videoBitrateMbps: 50 })
    await app.requireResult('export_video_edit', { documentRef })
    expect((await videoEditExportQueue.wait(videoEditExportQueue.list()[1].id)).settings.codec).toBe('hevc')
  } finally { app.dispose() }
})
it('本机4K60约束：format-only走软件适配；内置预设完整settings保持严格拒绝', async () => {
  const owner = await project()
  editVideoSequence(owner.document.id, owner.activeSequenceId, sequence => ({ ...sequence, width: 3840, height: 2160, frameRate: { numerator: 60, denominator: 1 }, sampleRate: 44100, channels: 1 }))
  canEncodeVideo.mockImplementation(async config => config.codec === 'avc1.640034' && config.hardwareAcceleration === 'prefer-software')
  const app = createApplicationHarness(); const documentRef = { kind: 'video_edit.document', id: owner.document.id }
  try {
    // The monitor scenario passes these explicit 12 Mbps hardware settings, which skip adaptation.
    const explicit = await app.call('export_video_edit', { documentRef, exports: [{ settings: { ...VIDEO_EDIT_EXPORT_PRESETS[0].settings, loudness: null, captionMode: 'burn' } }] })
    expect(explicit.ok).toBe(false); expect(JSON.stringify(explicit)).toContain('当前设备不支持所选编码设置')
    expect(canEncodeVideo).toHaveBeenCalledWith(expect.objectContaining({ codec: 'avc1.640034', width: 3840, height: 2160, bitrate: 6_000_000, hardwareAcceleration: 'prefer-hardware' }))
    expect(videoEditExportQueue.list()).toHaveLength(0); expect(getPlatform().system.dialog.save).not.toHaveBeenCalled()
    vi.mocked(getPlatform().audioEdit.loudness.read).mockImplementation(async (_id, _start, frames) => [new Float32Array(frames)])
    await app.requireResult('export_video_edit', { documentRef, format: 'mp4' })
    const job = await videoEditExportQueue.wait(videoEditExportQueue.list()[0].id)
    expect(job.state, job.error).toBe('completed')
    expect(job.settings).toMatchObject({ codec: 'avc', encoderPreference: 'software', fps: 60, videoBitrateMbps: 50, sampleRate: 44100, channels: 1 })
    expect(encoding.videoOptions.at(-1)).toMatchObject({ codec: 'avc', fullCodecString: 'avc1.640034', bitrate: 50_000_000, hardwareAcceleration: 'prefer-software' })
  } finally { app.dispose() }
})

it('导出后导入复用正式素材导入并只进素材箱，可撤销；不追加时间线片段', async () => {
  const owner = await project(); const clips = getActiveVideoEditSequence(owner).clips.length; const past = owner.past.length
  const files = new Set<string>(); vi.mocked(getPlatform().system.fs.exists).mockImplementation(async path => files.has(path)); vi.mocked(getPlatform().system.fs.writeFile).mockImplementation(async path => { files.add(path) })
  vi.spyOn(videoEditNativeMediaProbe, 'forcedBackend').mockResolvedValue('browser')
  const settings = { ...videoEditSequenceExportSettings(getActiveVideoEditSequence(owner)), importToProject: true, addToLibrary: false, loudness: null }
  const [job] = await enqueueVideoEditExports([{ projectId: owner.document.id, path: file('imported.mp4'), settings }]); await videoEditExportQueue.wait(job.id)
  expect(job.state).toBe('completed'); expect(owner.document.media.some(media => media.path === file('imported.mp4'))).toBe(true)
  expect(getActiveVideoEditSequence(owner).clips).toHaveLength(clips); expect(owner.past.length).toBe(past + 1)
})
it('字幕写入失败清理未发布成片并可重试，已有字幕路径在入队前被拒绝', async () => {
  const owner = await project(); const settings = { ...videoEditSequenceExportSettings(getActiveVideoEditSequence(owner)), captionMode: 'srt' as const, addToLibrary: false, loudness: null }
  vi.mocked(getPlatform().system.fs.exists).mockImplementationOnce(async () => false).mockImplementationOnce(async () => true)
  await expect(enqueueVideoEditExports([{ projectId: owner.document.id, path: file('caption.mp4'), settings }])).rejects.toThrow('字幕文件')
  vi.mocked(getPlatform().system.fs.writeFile).mockImplementation(async (path, _bytes, options) => { if (path.endsWith('.srt') && options?.position === 0) throw new Error('字幕位置不可写') })
  const [job] = await enqueueVideoEditExports([{ projectId: owner.document.id, path: file('caption.mp4'), settings }]); await videoEditExportQueue.wait(job.id)
  expect(job.state).toBe('failed'); expect(job.task?.output).toBeUndefined(); expect(getPlatform().system.fs.remove).toHaveBeenCalledWith(file('caption.mp4')); expect(getPlatform().system.fs.remove).toHaveBeenCalledWith(file('caption.srt'))
})

it('面板打开后删除原序列退回空态，禁用导出而不引用另一个序列', async () => {
  const owner = await project(); const view = render(<VideoEditExportDialog projectId={owner.document.id} onClose={vi.fn()} />)
  act(() => { editVideoSequence(owner.document.id, owner.activeSequenceId, sequence => ({ ...sequence, clips: [], annotations: [] })); deleteVideoEditSequence(owner.document.id, owner.activeSequenceId) })
  expect(view.getByText('请先打开序列')).toBeTruthy(); expectButtonDisabled(view.getByRole('button', { name: '导出' }))
  expect(getPlatform().system.fs.writeFile).not.toHaveBeenCalled()
})

it('响度标准化在输出44.1kHz单声道布局进行，回读PCM也用相同采样时钟', async () => {
  const owner = await project(); const settings = { ...videoEditSequenceExportSettings(getActiveVideoEditSequence(owner)), sampleRate: 44100 as const, channels: 1 as const, followSequence: { resolution: true, fps: true, sampleRate: false, channels: false }, addToLibrary: false }
  vi.mocked(getPlatform().audioEdit.loudness.read).mockImplementation(async (_id, _start, frames) => [new Float32Array(frames)])
  const [job] = await enqueueVideoEditExports([{ projectId: owner.document.id, path: file('normalized-mono.mp4'), settings, range: { startFrame: 1, endFrame: 3 } }]); await videoEditExportQueue.wait(job.id)
  expect(job.state).toBe('completed'); expect(getPlatform().audioEdit.loudness.start).toHaveBeenCalledWith(44100, 1, expect.any(String))
  expect(encoding.pictures[0]).toMatchObject({ sampleRate: 44100, channels: 1 }); expect(encoding.audio.reduce((sum, count) => sum + count, 0)).toBe(2940)
  expect(getPlatform().audioEdit.loudness.read).toHaveBeenCalledWith(expect.any(String), 0, 2940)
  expect(getActiveVideoEditSequence(owner)).toMatchObject({ sampleRate: 48000, channels: 2 })
})

it('非法自定义宽高保持面板可用但禁止提交，修正后恢复导出', async () => {
  const owner = await project(); const view = render(<VideoEditExportDialog projectId={owner.document.id} onClose={vi.fn()} />)
  fireEvent.click(view.getByRole('button', { name: '分辨率跟随序列' })); await select(view, '导出分辨率', '自定义…')
  fireEvent.change(view.getByLabelText('导出宽度'), { target: { value: '1919' } }); fireEvent.blur(view.getByLabelText('导出宽度'))
  expect(view.getByText(/请使用偶数宽高/)).toBeTruthy(); expectButtonDisabled(view.getByRole('button', { name: '导出' }))
  fireEvent.change(view.getByLabelText('导出宽度'), { target: { value: '1920' } }); fireEvent.blur(view.getByLabelText('导出宽度'))
  await waitFor(() => expectButtonEnabled(view.getByRole('button', { name: '导出' })))
})

it('completed exports survive a fresh document instance and either ID resolves; unknown ID is NOT_FOUND', async () => {
  const owner = await project(); const documentRef = { kind: 'video_edit.document', id: owner.document.id }
  const [job] = await enqueueVideoEditExports([{ projectId: owner.document.id, path: file('archived.mp4') }])
  await videoEditExportQueue.wait(job.id)
  expect(job.state).toBe('completed')
  const expected = { id: job.id, taskId: job.task!.id, presetName: job.presetName, rangeSource: 'content', assetRef: job.task!.assetRef, path: file('archived.mp4'), completedAt: expect.any(Number), settings: expect.objectContaining({ format: 'mp4' }) }
  expect(owner.document.exportHistory).toEqual([expect.objectContaining(expected)])
  undoVideoEdit(owner.document.id)
  expect(owner.document.exportHistory).toEqual([expect.objectContaining(expected)])
  videoEditExportQueue.clearFinished()
  const reopened = await reopenVideoEdit(owner.document.id)
  expect(reopened).not.toBe(owner)
  const app = createApplicationHarness()
  try {
    for (const taskId of [undefined, job.id, job.task!.id]) {
      const read = await app.requireResult('query_video_edit_export', { detail: 'full', documentRef, ...(taskId ? { taskId } : {}) })
      expect(read.queue).toEqual([expect.objectContaining({ ...expected, archived: true })])
    }
    editVideoProject(reopened.document.id, document => ({ ...document, exportHistory: Array.from({ length: 3 }, (_, index) => ({ ...document.exportHistory![0], id: `archived-${index}`, taskId: `render-${index}` })) }))
    const first = await app.requireResult('query_video_edit_export', { documentRef, limit: 2 })
    expect(first).toMatchObject({ total: 3, queue: [{ id: 'archived-0', resultRef: { documentRef, taskId: 'archived-0' } }, { id: 'archived-1' }] })
    expect((first.queue as Array<Record<string, unknown>>)[0]).not.toHaveProperty('settings')
    const second = await app.requireResult('query_video_edit_export', { documentRef, limit: 2, cursor: first.nextCursor })
    expect(second).toMatchObject({ total: 3, queue: [{ id: 'archived-2' }], nextCursor: null })
    expect(await app.requireResult('query_video_edit_export', { documentRef, activeOnly: true })).toMatchObject({ queue: [], total: 0, nextCursor: null })
    const live = vi.spyOn(videoEditExportQueue, 'list').mockReturnValueOnce([{ ...job, owner: reopened, state: 'running' }])
    expect(await app.requireResult('query_video_edit_export', { documentRef, activeOnly: true })).toMatchObject({ queue: [{ id: job.id, state: 'running' }], total: 1 })
    live.mockRestore()
    const invalidCursor = await app.call('query_video_edit_export', { documentRef, activeOnly: true, cursor: first.nextCursor })
    expect(invalidCursor).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT', recoverable: true, message: expect.stringContaining('cursor') } })
    if (!invalidCursor.ok) expect(invalidCursor.error.message).not.toMatch(/^[A-Z_]+:/)
    const missing = await app.call('query_video_edit_export', { documentRef, taskId: 'missing' })
    expect(missing).toMatchObject({ ok: false, error: { code: 'NOT_FOUND', recoverable: true } })
  } finally { app.dispose() }
})

it('7.776秒声音在60fps占466帧，字幕到456不会裁短内容；修剪声音后新导出才到456', async () => {
  const owner = await project()
  editVideoProject(owner.document.id, document => { document = structuredClone(document);
    document.media.push({ id: 'voice-media', kind: 'audio', name: '旁白', path: file('voice.mp3'), durationSeconds: 7.776, width: 0, height: 0 })
    document.items.push({ id: 'voice-item', kind: 'audio', name: '旁白', mediaId: 'voice-media' })
    const sequence = document.sequences[0]; sequence.frameRate = { numerator: 60, denominator: 1 }
    sequence.clips = [makeVideoEditItemClip(document, 'voice-item', sequence.id, { frame: 0 })]
    sequence.captions = [{ id: 'first', start: 9, duration: 226, text: '第一句' }, { id: 'second', start: 235, duration: 139, text: '第二句' }, { id: 'third', start: 386, duration: 70, text: '第三句' }]
    sequence.markers = []; sequence.transitions = []
    return document
  })
  expect(getActiveVideoEditSequence(owner).clips[0].duration).toBe(466)
  expect(videoEditExportRange(owner)).toEqual({ startFrame: 0, endFrame: 466 })
  const [full] = await enqueueVideoEditExports([{ projectId: owner.document.id, path: file('full-voice.mp4') }])
  await videoEditExportQueue.wait(full.id)
  editVideoSequence(owner.document.id, owner.activeSequenceId, sequence => ({ ...sequence, clips: sequence.clips.map(clip => ({ ...clip, duration: 456 })) }))
  expect(videoEditExportRange(owner)).toEqual({ startFrame: 0, endFrame: 456 })
  const [trimmed] = await enqueueVideoEditExports([{ projectId: owner.document.id, path: file('trimmed-voice.mp4') }])
  await videoEditExportQueue.wait(trimmed.id)
  const app = createApplicationHarness()
  try {
    const read = await app.requireResult('query_video_edit_export', { detail: 'full', documentRef: { kind: 'video_edit.document', id: owner.document.id } })
    expect(read.queue).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: full.id, state: 'completed', range: { startFrame: 0, endFrame: 466 }, rangeSource: 'content' }),
      expect.objectContaining({ id: trimmed.id, state: 'completed', range: { startFrame: 0, endFrame: 456 }, rangeSource: 'content' }),
    ]))
  } finally { app.dispose() }
})

it('默认导出没有十帧余量，包含字幕尾部并读回内容、入出点和显式区间来源', async () => {
  const owner = await project()
  editVideoSequence(owner.document.id, owner.activeSequenceId, sequence => ({ ...sequence, clips: sequence.clips.map(clip => ({ ...clip, duration: 456 })) }))
  expect(videoEditExportRange(owner)).toEqual({ startFrame: 0, endFrame: 456 })
  editVideoSequence(owner.document.id, owner.activeSequenceId, sequence => ({ ...sequence, captions: [{ id: 'tail', start: 450, duration: 16, text: '片尾字幕' }] }))
  const [content] = await enqueueVideoEditExports([{ projectId: owner.document.id, path: file('content.mp4') }])
  setVideoEditTimelineView(owner.document.id, { inFrame: 1, outFrame: 3 })
  const [marked, explicit] = await enqueueVideoEditExports([
    { projectId: owner.document.id, path: file('marked.mp4') },
    { projectId: owner.document.id, path: file('explicit.mp4'), range: { startFrame: 2, endFrame: 4 } },
  ])
  for (const job of [content, marked, explicit]) await videoEditExportQueue.wait(job.id)
  const app = createApplicationHarness()
  try {
    const read = await app.requireResult('query_video_edit_export', { detail: 'full', documentRef: { kind: 'video_edit.document', id: owner.document.id } })
    expect(read.queue).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: content.id, range: { startFrame: 0, endFrame: 466 }, rangeSource: 'content' }),
      expect.objectContaining({ id: marked.id, range: { startFrame: 1, endFrame: 3 }, rangeSource: 'in-out' }),
      expect.objectContaining({ id: explicit.id, range: { startFrame: 2, endFrame: 4 }, rangeSource: 'explicit' }),
    ]))
  } finally { app.dispose() }
})
it('界面重载后从主进程登记恢复：排队项按原快照接着导出，中断项可重试，查询返回 interrupted', async () => {
  const owner = await project(); const projectId = owner.document.id; const app = createApplicationHarness()
  const registry = getPlatform().videoEditExport
  const register = vi.spyOn(registry, 'register').mockImplementation(async request => request.jobs.map(job => ({ id: job.id, retained: true })))
  const update = vi.spyOn(registry, 'update').mockResolvedValue(undefined); vi.spyOn(registry, 'remove').mockResolvedValue(undefined); vi.spyOn(registry, 'discardLeftovers').mockResolvedValue(undefined)
  const created = vi.spyOn(registry, 'createOutput').mockResolvedValue(undefined); const published = vi.spyOn(registry, 'outputPublished').mockResolvedValue(undefined)
  try {
    const gate = deferred<void>(); encoding.finalize.mockImplementationOnce(() => gate.promise)
    const [running, queued] = await enqueueVideoEditExports([{ projectId, path: file('running.mp4') }, { projectId, path: file('queued.mp4') }])
    await vi.waitFor(() => expect(encoding.finalize).toHaveBeenCalledOnce())
    // 输出文件由主进程创建，渲染层不再自己独占创建。
    expect(created).toHaveBeenCalledWith(running.id, file('running.mp4'))
    expect(vi.mocked(getPlatform().system.fs.writeFile).mock.calls.some(([, , options]) => options?.exclusive)).toBe(false)
    const request = register.mock.calls[0][0]
    expect(request.snapshots).toHaveLength(1); expect(request.jobs.map(value => [value.outputPaths, value.snapshotIndex])).toEqual([[[file('running.mp4')], 0], [[file('queued.mp4')], 0]])
    // 模拟重载：旧页面的队列整体消失，只剩主进程登记。
    for (const job of videoEditExportQueue.list()) videoEditExportQueue.cancel(job.id)
    gate.resolve(); for (const job of videoEditExportQueue.list()) await videoEditExportQueue.wait(job.id)
    videoEditExportQueue.clearFinished()
    editVideoSequence(projectId, owner.activeSequenceId, sequence => ({ ...sequence, name: '重载后修改' }))
    encoding.rendered = []; published.mockClear(); update.mockClear()
    const record = (index: number, state: 'queued' | 'interrupted', id = request.jobs[index].id, projectRef = projectId) => ({ ...request.jobs[index], id, projectId: projectRef, snapshotJson: request.snapshots[0], payload: request.jobs[index].payload, state, progress: state === 'interrupted' ? 0.129 : 0, outputPublished: false })
    const closedId = (await createVideoEditProject())!.document.id; await closeVideoEditProject(closedId)
    vi.spyOn(registry, 'restore').mockResolvedValueOnce([record(0, 'interrupted'), record(1, 'queued'), record(1, 'queued', 'waiting', closedId)])
    await restoreVideoEditExports()
    expect(videoEditExportQueue.list().map(job => [job.id, job.state, job.restored])).toEqual([[running.id, 'interrupted', true], [queued.id, 'running', true]])
    // 原剪辑没打开的恢复项留在等待区，并占住它的输出路径。
    expect(listWaitingVideoEditExports().map(value => value.id)).toEqual(['waiting'])
    const queuedJob = await videoEditExportQueue.wait(queued.id)
    expect(queuedJob.state).toBe('completed'); expect(encoding.rendered.length).toBeGreaterThan(0); expect(encoding.rendered.every(([name]) => name !== '重载后修改')).toBe(true)
    expect(published).toHaveBeenCalledWith(queued.id)
    await expect(enqueueVideoEditExports([{ projectId, path: file('queued.mp4') }])).rejects.toThrow('占用')
    await app.requireResult('cancel_video_edit_export', { documentRef: { kind: 'video_edit.document', id: closedId }, taskId: 'waiting' })
    // 助手调用会在后台打开原剪辑，等待项随之接回队列，再按队列项取消；登记同步为已取消（主进程据此移除并释放路径）。
    expect(listWaitingVideoEditExports()).toEqual([]); expect(videoEditExportQueue.list().find(job => job.id === 'waiting')?.state).toBe('cancelled')
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ id: 'waiting', state: 'cancelled' }))
    const read = await app.requireResult('query_video_edit_export', { documentRef: { kind: 'video_edit.document', id: projectId }, taskId: running.id })
    expect((read.queue as Array<{ state: string }>)[0].state).toBe('interrupted')
    // 中断项的进度来自登记（中断时导出到哪），不是还没开始的本页任务的 0。
    expect((read.queue as Array<{ progress: number }>)[0].progress).toBe(0.129)
    const list = render(<VideoEditExportQueueList />)
    expect(list.getByText('已中断（导出到 13%）')).toBeTruthy(); list.unmount()
    await app.requireResult('export_video_edit', { documentRef: { kind: 'video_edit.document', id: projectId }, retryTaskId: running.id })
    const retried = await videoEditExportQueue.wait(running.id)
    expect(retried.state).toBe('completed'); expect(retried.path).toBe(file('running.mp4'))
    expect(registry.discardLeftovers).toHaveBeenCalledWith(running.id)
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ id: running.id, invocationId: retried.invocationId }))
    expect(retried.invocationId).toEqual(expect.any(String))
    // 登记拒绝保留时不能开始导出或对外确认提交。
    register.mockImplementationOnce(async value => value.jobs.map(job => ({ id: job.id, retained: false, reason: 'snapshot_too_large' as const })))
    await expect(enqueueVideoEditExports([{ projectId, path: file('large.mp4') }])).rejects.toThrow('无法保留')
    expect(videoEditExportQueue.list().at(-1)?.state).toBe('failed')
  } finally { app.dispose() }
})
it('恢复项的本地状态与登记不同（排队转为中断）时同步到主进程', async () => {
  const owner = await project()
  const mirror = { register: vi.fn(async () => undefined), update: vi.fn(), remove: vi.fn() }
  const queue = new VideoEditExportQueue(async () => undefined, mirror)
  const interrupted = { ...localJob(owner, 'held'), state: 'interrupted' as const }
  const unchanged = { ...localJob(owner, 'same'), state: 'interrupted' as const }
  queue.restore([{ job: interrupted, registeredState: 'queued' }, { job: unchanged, registeredState: 'interrupted' }])
  expect(mirror.update.mock.calls.map(([job]) => [job.id, job.state])).toEqual([['held', 'interrupted']])
})
it('恢复完成和取消记录不重新编码，恢复信息损坏时仍保留可查询的失败记录', async () => {
  const owner = await project(); const app = createApplicationHarness(); const base = localJob(owner, 'history')
  const registry = getPlatform().videoEditExport
  const record = (id: string, state: 'completed' | 'cancelled' | 'queued') => ({ id, projectId: owner.document.id, name: base.name, presetName: base.presetName, outputPaths: [base.path],
    snapshotJson: JSON.stringify(base.snapshot), payload: { settings: base.settings, path: base.path, range: base.range, rangeSource: base.rangeSource, loudnessRequested: false }, state, progress: .8, outputPublished: state === 'completed' })
  const broken = { ...record('broken', 'queued'), snapshotJson: '{' }
  const update = vi.spyOn(registry, 'update').mockResolvedValue(undefined)
  vi.spyOn(registry, 'restore').mockResolvedValueOnce([record('finished', 'completed'), record('cancelled', 'cancelled'), broken])
  try {
    await restoreVideoEditExports()
    const result = await app.requireResult('query_video_edit_export', { documentRef: { kind: 'video_edit.document', id: owner.document.id } })
    expect(result.queue).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'finished', state: 'completed' }), expect.objectContaining({ id: 'cancelled', state: 'cancelled' }),
      expect.objectContaining({ id: 'broken', state: 'failed', error: expect.stringContaining('恢复信息无法读取') }),
    ]))
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ id: 'broken', state: 'failed', progress: .8 }))
    expect(encoding.rendered).toEqual([])
    await app.requireResult('cancel_video_edit_export', { documentRef: { kind: 'video_edit.document', id: owner.document.id }, taskId: 'broken' })
    expect(listWaitingVideoEditExports(owner.document.id)).toEqual([])
  } finally { cancelWaitingVideoEditExport('broken'); app.dispose() }
})
it('单次导出删不掉未完成文件时保留登记交给主进程兜底，删干净或已发布才撤销登记', async () => {
  const owner = await project(); const projectId = owner.document.id
  const registry = getPlatform().videoEditExport
  vi.spyOn(registry, 'register').mockImplementation(async request => request.jobs.map(job => ({ id: job.id, retained: false })))
  const update = vi.spyOn(registry, 'update').mockResolvedValue(undefined); const remove = vi.spyOn(registry, 'remove').mockResolvedValue(undefined)
  const create = vi.spyOn(registry, 'createOutput').mockResolvedValue(undefined); vi.spyOn(registry, 'outputPublished').mockResolvedValue(undefined)
  const options = () => ({ snapshot: structuredClone(getActiveVideoEditSequence(owner)), range: videoEditExportRange(owner), settings: { ...VIDEO_EDIT_EXPORT_PRESETS[0].settings, loudness: null, addToLibrary: false, captionMode: 'none' as const } })
  encoding.finalize.mockRejectedValueOnce(new Error('encode failed')); vi.mocked(getPlatform().system.fs.remove).mockRejectedValueOnce(new Error('busy'))
  await expect(exportVideoEdit(projectId, file('transient-left.mp4'), false, undefined, undefined, options())).rejects.toThrow()
  const leftId = create.mock.calls.at(-1)![0]
  expect(remove.mock.calls.flat(2)).not.toContain(leftId)
  expect(update).toHaveBeenLastCalledWith({ id: leftId, state: 'failed', progress: 0 })
  encoding.finalize.mockRejectedValueOnce(new Error('encode failed'))
  await expect(exportVideoEdit(projectId, file('transient-clean.mp4'), false, undefined, undefined, options())).rejects.toThrow()
  expect(remove).toHaveBeenLastCalledWith([create.mock.calls.at(-1)![0]])
  await expect(exportVideoEdit(projectId, file('transient-done.mp4'), false, undefined, undefined, options())).resolves.toBe(file('transient-done.mp4'))
  expect(remove).toHaveBeenLastCalledWith([create.mock.calls.at(-1)![0]])
})
it('界面取消等待原剪辑打开的项：从登记移除并释放输出路径', async () => {
  const owner = await project(); const projectId = owner.document.id
  const registry = getPlatform().videoEditExport
  const remove = vi.spyOn(registry, 'remove').mockResolvedValue(undefined)
  const closedId = (await createVideoEditProject())!.document.id; await closeVideoEditProject(closedId)
  vi.spyOn(registry, 'restore').mockResolvedValueOnce([{ id: 'waiting', projectId: closedId, name: '序列', presetName: '默认', outputPaths: [file('held.mp4')], snapshotJson: '{}', payload: {}, state: 'queued', progress: 0, outputPublished: false }])
  await restoreVideoEditExports()
  await expect(enqueueVideoEditExports([{ projectId, path: file('held.mp4') }])).rejects.toThrow('占用')
  cancelWaitingVideoEditExport('waiting')
  expect(listWaitingVideoEditExports()).toEqual([]); expect(remove).toHaveBeenCalledWith(['waiting'])
  const [job] = await enqueueVideoEditExports([{ projectId, path: file('held.mp4') }]); await videoEditExportQueue.wait(job.id)
})
