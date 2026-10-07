import { createVideoEditTestProject as createVideoEditProject } from './videoEditDocumentTestKit'
// @vitest-environment jsdom
import path from 'node:path'
import { canEncodeAudio, canEncodeVideo } from 'mediabunny'
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
import { runApplicationCloseGuards } from '@/core/applicationLifecycle/applicationCloseGuards'
import { appendVideoEditClip, closeVideoEditProject, editVideoSequence, getActiveVideoEditSequence, listVideoEditInstances, deleteVideoEditSequence, videoEditExportRange } from './videoEditService'
import { VideoEditExportQueue, enqueueVideoEditExports, videoEditExportQueue, retryVideoEditExportJob, videoEditQueuedExportTask, type VideoEditExportJob } from './videoEditExportQueue'
import { VideoEditExportPresetLibrary, videoEditExportPresetLibrary } from './videoEditExportPresets'
import { videoEditNativeMediaProbe } from './videoEditMediaProbe'
import { VideoEditExportDialog } from '../panels/VideoEditExportDialog'
import { exportVideoEdit } from './videoEditExport'

const encoding = vi.hoisted(() => ({ rendered: [] as Array<[string, number]>, videoTimes: [] as number[], audio: [] as number[], finalize: vi.fn(), draw: vi.fn(), formats: [] as string[], videoOptions: [] as unknown[], audioOptions: [] as unknown[], pictures: [] as VideoEditComposition[], rendererOptions: [] as unknown[][] }))
vi.mock('mediabunny', () => ({
  canEncodeVideo: vi.fn(async () => true),
  canEncodeAudio: vi.fn(async () => true),
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
  setSmartRegions() {} setTracks() {} async dispose() {}
  async render(frame: number) { encoding.rendered.push([this.composition.name, frame]); return { singleFrameReads: 0 } }
  async mixAudio(_time: number, duration: number) { return new AudioBuffer({ numberOfChannels: this.composition.channels, sampleRate: this.composition.sampleRate, length: Math.round(duration * this.composition.sampleRate) }) }
} }))
const file = (name: string): string => path.resolve(path.sep, 'fixture', name)
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail }); return { promise, resolve, reject } }
beforeEach(() => {
  vi.mocked(canEncodeVideo).mockReset().mockResolvedValue(true)
  vi.mocked(canEncodeAudio).mockReset().mockResolvedValue(true)
  installHarnessNativeStorage(); encoding.rendered = []; encoding.videoTimes = []; encoding.audio = []; encoding.formats = []; encoding.videoOptions = []; encoding.audioOptions = []; encoding.pictures = []; encoding.rendererOptions = []; encoding.draw.mockClear(); encoding.finalize.mockReset().mockResolvedValue(undefined)
  videoEditExportQueue.clearFinished(); videoEditExportPresetLibrary.replace([])
  const platform = getPlatform()
  vi.spyOn(platform.system.fs, 'writeTextFile').mockResolvedValue(undefined)
  vi.spyOn(platform.system.fs, 'writeFile').mockResolvedValue(undefined)
  vi.spyOn(platform.system.fs, 'exists').mockResolvedValue(false)
  vi.spyOn(platform.system.fs, 'remove').mockResolvedValue(undefined)
  vi.spyOn(platform.system.dialog, 'save').mockResolvedValue(file('output.mp4'))
  vi.spyOn(platform.system.paths, 'dirname').mockResolvedValue(file(''))
  vi.spyOn(platform.media, 'allowRoot').mockResolvedValue(undefined)
  const assets = new Map<string, AssetRecord>()
  vi.spyOn(platform.assetLibrary, 'createAsset').mockImplementation(async input => { const asset: AssetRecord = { id: crypto.randomUUID(), filePath: input.filePath, mediaType: input.mediaType, displayName: input.displayName ?? '成片', displayUrl: 'henji-media://local/output', source: 'video-edit', mimeType: 'video/mp4', sizeBytes: 5, fileModifiedAt: 1, contentIdentity: 'a'.repeat(64), width: 1920, height: 1080, durationSeconds: 1, thumbnailPath: null, thumbnailUrl: null, inspectionStatus: 'ready', inspectionError: null, createdAt: 1, updatedAt: 1, lastUsedAt: null, tags: [], libraryIds: [] }; assets.set(asset.id, asset); return asset })
  vi.spyOn(platform.assetLibrary, 'inspectAsset').mockImplementation(async id => assets.get(id)!)
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({ fillRect() {}, drawImage() {}, fillStyle: '', measureText: (text: string) => ({ width: text.length * 7 }) }) as unknown as CanvasRenderingContext2D)
  vi.spyOn(platform.assetLibrary, 'inspectFileContent').mockResolvedValue({ sizeBytes: 5, fileModifiedAt: 1, contentIdentity: 'a'.repeat(64) })
  vi.stubGlobal('OffscreenCanvas', class { constructor(readonly width: number, readonly height: number) {} getContext() { return { fillStyle: '', fillRect() {}, drawImage: encoding.draw } } })
  vi.stubGlobal('AudioBuffer', class { readonly length: number; readonly numberOfChannels: number; private planes: Float32Array[]; constructor({ numberOfChannels, length }: { numberOfChannels: number; length: number }) { this.length = length; this.numberOfChannels = numberOfChannels; this.planes = Array.from({ length: numberOfChannels }, () => new Float32Array(length)) } getChannelData(channel: number) { return this.planes[channel] } })
  const api = platform.audioEdit.loudness
  vi.spyOn(api, 'start').mockResolvedValue(undefined); vi.spyOn(api, 'append').mockResolvedValue(undefined); vi.spyOn(api, 'close').mockResolvedValue(undefined)
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
  return { id: name, name, owner, presetName: name, snapshot: structuredClone(getActiveVideoEditSequence(owner)), range: videoEditExportRange(owner), settings: { ...VIDEO_EDIT_EXPORT_PRESETS[0].settings, loudness: null }, path: file(`${name}.mp4`), state: 'queued', controller: new AbortController(), release: vi.fn() }
}
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
  values.set('video-edit-export-presets', 'broken'); const broken = new VideoEditExportPresetLibrary(storage); expect(() => broken.save('新预设', saved.settings)).toThrow('读取失败'); expect(values.get('video-edit-export-presets')).toBe('broken')
})
it('全部路径与范围确认后才批量提交；取消第二次选择不产生部分导出；范围错误不写文件', async () => {
  const owner = await project(); const projectId = owner.document.id
  vi.mocked(getPlatform().system.dialog.save).mockResolvedValueOnce(file('a.mp4')).mockResolvedValueOnce(null)
  expect(await enqueueVideoEditExports([{ projectId, presetId: 'builtin:douyin' }, { projectId, presetId: 'builtin:bilibili' }])).toEqual([])
  expect(videoEditExportQueue.list()).toHaveLength(0); expect(getPlatform().system.fs.writeFile).not.toHaveBeenCalled()
  await expect(enqueueVideoEditExports([{ projectId, range: { startFrame: 0, endFrame: 5 } }])).rejects.toThrow('范围')
  await expect(closeVideoEditProject(projectId)).resolves.toBeUndefined()
})
it('正式编码固定序列快照；输出帧率只影响画面；历史队列回执仍可收录，待处理阻止关闭', async () => {
  const owner = await project(); const projectId = owner.document.id; const gate = deferred<void>(); encoding.finalize.mockImplementationOnce(() => gate.promise)
  const settings = { ...VIDEO_EDIT_EXPORT_PRESETS.find(value => value.id === 'builtin:douyin')!.settings, fps: 60, loudness: null, addToLibrary: false }
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
it('面板默认跟随、解锁变自定义，保存重命名删除；队列和立即导出使用相同设置', async () => {
  const owner = await project(); const close = vi.fn(); const ui = render(<VideoEditExportDialog projectId={owner.document.id} onClose={close} />)
  expect(ui.getByRole('button', { name: '导出预设' }).textContent).toContain('与序列一致')
  expect(ui.getByRole('button', { name: '导出分辨率' })).toHaveProperty('disabled', true)
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
  await waitFor(() => expect(ui.getByRole('button', { name: '加入队列' })).toHaveProperty('disabled', false))
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
    const read = await app.requireResult('query_video_edit_export', { documentRef: { kind: 'video_edit.document', id: second.document.id } }); expect(read.queue).toHaveLength(1)
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
  expect(encoding.videoOptions).toEqual([{ codec: 'hevc', bitrate: 80_000_000, bitrateMode: 'variable', hardwareAcceleration: 'prefer-hardware' }])
  expect(encoding.videoTimes).toEqual([0, 1 / 120, 2 / 120, 3 / 120])
})
it('导出面板对设备不支持的8K120帧禁用动作并给出降低规格的恢复方式', async () => {
  const owner = await project()
  editVideoSequence(owner.document.id, owner.activeSequenceId, sequence => ({ ...sequence, width: 7680, height: 4320, frameRate: { numerator: 120, denominator: 1 } }))
  vi.mocked(canEncodeVideo).mockResolvedValue(false)
  const view = render(<VideoEditExportDialog projectId={owner.document.id} onClose={vi.fn()} />)
  await waitFor(() => expect(view.getByText(/当前设备不支持所选编码设置/)).toBeTruthy())
  expect(view.getByRole('button', { name: '导出' })).toHaveProperty('disabled', true)
  expect(view.getByRole('button', { name: '加入队列' })).toHaveProperty('disabled', true)
  await select(view, '导出预设', '仅音频 · AAC')
  await waitFor(() => expect(view.getByRole('button', { name: '导出' })).toHaveProperty('disabled', false))
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
  const owner = await project(); const settings = patchVideoEditExportSettings(videoEditSequenceExportSettings(getActiveVideoEditSequence(owner)), { format: 'wav', loudness: null, useProxies: true, addToLibrary: false })
  const [job] = await enqueueVideoEditExports([{ projectId: owner.document.id, path: file('sound.wav'), settings }]); await videoEditExportQueue.wait(job.id)
  expect(job.state).toBe('completed'); expect(encoding.videoOptions).toEqual([]); expect(encoding.rendered).toEqual([]); expect(encoding.audioOptions).toEqual([{ codec: 'pcm-s24', transform: { sampleRate: 48000, numberOfChannels: 2 } }]); expect(getPlatform().audioEdit.loudness.start).not.toHaveBeenCalled()
  expect(encoding.rendererOptions[0].slice(-2)).toEqual([owner.document.id, true])
})
it('默认按设备切到H264软件；手动选择HEVC后禁用不支持的CBR', async () => {
  const owner = await project(); vi.mocked(canEncodeVideo).mockImplementation(async (codec, config) => codec === 'hevc' ? config?.bitrateMode !== 'constant' : config?.hardwareAcceleration === 'prefer-software')
  const view = render(<VideoEditExportDialog projectId={owner.document.id} onClose={vi.fn()} />)
  await waitFor(() => expect(view.getByRole('button', { name: '导出' })).toHaveProperty('disabled', false))
  expect(view.getByRole('button', { name: '编码性能' }).textContent).toContain('软件编码')
  expect(view.getByRole('button', { name: '导出预设' }).textContent).toContain('与序列一致')
  fireEvent.click(view.getByRole('button', { name: '导出格式' })); expect(view.getByRole('option', { name: 'MP4 · H.264' })).toHaveProperty('disabled', false)
  fireEvent.click(view.getByRole('option', { name: 'MP4 · HEVC (H.265)' }))
  await waitFor(() => expect(view.getByRole('button', { name: '导出' })).toHaveProperty('disabled', false))
  fireEvent.click(view.getByRole('button', { name: '码率模式' })); expect(view.getByRole('option', { name: 'CBR' })).toHaveProperty('disabled', true)
  fireEvent.click(view.getByRole('option', { name: 'VBR' })); await select(view, '编码性能', '软件编码')
  expect(view.getByRole('button', { name: '导出预设' }).textContent).toContain('自定义')
})

it('无资产写授权拒绝自动收录；显式关闭后仍能通过正式公共能力导出', async () => {
  const owner = await project(); const session = createApplicationCapabilitySession(createApplicationCallerGrant({ callerId: 'export-only', capabilityIds: ['export_video_edit'], permissions: ['video_edit:write', 'video_edit:read'], allowWrites: true, allowDestructive: false }))
  const input = { documentRef: { kind: 'video_edit.document', id: owner.document.id } }; const context = { requestId: crypto.randomUUID(), signal: new AbortController().signal }
  const denied = await session.execute({ id: 'export_video_edit', version: 1, input }, context)
  expect(denied.ok).toBe(false); expect(JSON.stringify(denied)).toContain('assets:write'); expect(getPlatform().system.dialog.save).not.toHaveBeenCalled()
  const allowed = await session.execute({ id: 'export_video_edit', version: 1, input: { ...input, settings: { ...videoEditSequenceExportSettings(getActiveVideoEditSequence(owner)), addToLibrary: false } } }, context)
  expect(allowed.ok).toBe(true); await videoEditExportQueue.wait(videoEditExportQueue.list()[0].id)
  expect(getPlatform().assetLibrary.createAsset).not.toHaveBeenCalled()
})
it('开关从实际面板提交仅音频，字幕烧录改为SRT，响度关闭；折叠状态重新打开后保留', async () => {
  const owner = await project(); const view = render(<VideoEditExportDialog projectId={owner.document.id} onClose={vi.fn()} />)
  expect(view.getByRole('button', { name: '音频' }).getAttribute('aria-expanded')).toBe('false')
  fireEvent.click(view.getByRole('button', { name: '音频' })); fireEvent.click(view.getByRole('switch', { name: '启用字幕' })); fireEvent.click(view.getByRole('switch', { name: '启用响度' })); fireEvent.click(view.getByRole('switch', { name: '启用视频' }))
  expect(view.getByRole('switch', { name: '启用音频' })).toHaveProperty('disabled', true)
  const files = new Map<string, Uint8Array>(); vi.mocked(getPlatform().system.fs.writeFile).mockImplementation(async (path, bytes) => { files.set(path, bytes) }); vi.spyOn(getPlatform().system.fs, 'readTextFile').mockImplementation(async path => new TextDecoder().decode(files.get(path)))
  vi.mocked(getPlatform().system.dialog.save).mockResolvedValueOnce(file('only-audio.aac'))
  await waitFor(() => expect(view.getByRole('button', { name: '加入队列' })).toHaveProperty('disabled', false))
  await act(async () => fireEvent.click(view.getByRole('button', { name: '加入队列' })))
  const job = videoEditExportQueue.list()[0]; await act(async () => { await videoEditExportQueue.wait(job.id) })
  expect(job.settings).toMatchObject({ videoEnabled: false, audioEnabled: true, loudness: null, captionMode: 'srt', format: 'aac' }); expect(job.state).toBe('completed')
  view.unmount(); const reopened = render(<VideoEditExportDialog projectId={owner.document.id} onClose={vi.fn()} />)
  expect(reopened.getByRole('button', { name: '音频' }).getAttribute('aria-expanded')).toBe('true')
})

it('设备仅支持HEVC软件CBR时默认自动适配并保留预设名称', async () => {
  const owner = await project(); vi.mocked(canEncodeVideo).mockImplementation(async (codec, config) => codec === 'hevc' && config?.bitrateMode === 'constant' && config?.hardwareAcceleration === 'prefer-software')
  const view = render(<VideoEditExportDialog projectId={owner.document.id} onClose={vi.fn()} />)
  await waitFor(() => expect(view.getByRole('button', { name: '导出' })).toHaveProperty('disabled', false))
  expect(view.getByRole('button', { name: '导出格式' }).textContent).toContain('HEVC')
  expect(view.getByRole('button', { name: '导出预设' }).textContent).toContain('与序列一致')
  expect(view.getByRole('button', { name: '编码性能' }).textContent).toContain('软件编码'); expect(view.getByRole('button', { name: '码率模式' }).textContent).toContain('CBR')
  expect(view.getByRole('button', { name: '导出' })).toHaveProperty('disabled', false)
})

it('音频码率按设备禁用并提示；高码率预设自动回落，采样率和声道变化重新判断', async () => {
  const owner = await project()
  vi.mocked(canEncodeAudio).mockImplementation(async (_codec, config) => Number(config?.bitrate) <= (config?.numberOfChannels === 1 ? 96000 : config?.sampleRate === 44100 ? 128000 : 192000))
  const high = videoEditExportPresetLibrary.save('高码率', { ...videoEditSequenceExportSettings(getActiveVideoEditSequence(owner)), audioBitrateKbps: 320 })
  const view = render(<VideoEditExportDialog projectId={owner.document.id} onClose={vi.fn()} />)
  fireEvent.click(view.getByRole('button', { name: '音频' }))
  await select(view, '导出预设', high.name)
  await waitFor(() => expect(view.getByRole('button', { name: '音频码率' }).textContent).toContain('192 kbps'))
  expect(view.getByRole('button', { name: '导出预设' }).textContent).toContain(high.name)
  fireEvent.click(view.getByRole('button', { name: '音频码率' }))
  const unsupported = view.getByRole('option', { name: '320 kbps' })
  expect(unsupported).toHaveProperty('disabled', true)
  expect(view.getByRole('option', { name: '256 kbps' })).toHaveProperty('disabled', true)
  expect(view.getByRole('option', { name: '192 kbps' })).toHaveProperty('disabled', false)
  fireEvent.mouseEnter(unsupported.parentElement!)
  await waitFor(() => expect(view.getByRole('tooltip').textContent).toBe('此设备不支持该码率'))
  fireEvent.mouseLeave(unsupported.parentElement!)
  fireEvent.click(view.getByRole('option', { name: '192 kbps' }))
  fireEvent.click(view.getByRole('button', { name: '采样率跟随序列' }))
  await select(view, '音频采样率', '44100 Hz')
  await waitFor(() => expect(view.getByText(/此设备的 AAC 编码不支持 192 kbps/)).toBeTruthy())
  expect(view.getByRole('button', { name: '导出' })).toHaveProperty('disabled', true)
  await select(view, '音频码率', '128 kbps')
  expect(canEncodeAudio).toHaveBeenCalledWith('aac', { sampleRate: 44100, numberOfChannels: 2, bitrate: 192000 })
  fireEvent.click(view.getByRole('button', { name: '声道跟随序列' }))
  await select(view, '音频声道', '单声道')
  await waitFor(() => expect(view.getByText(/此设备的 AAC 编码不支持 128 kbps/)).toBeTruthy())
  await select(view, '音频码率', '96 kbps')
  expect(canEncodeAudio).toHaveBeenCalledWith('aac', { sampleRate: 44100, numberOfChannels: 1, bitrate: 128000 })
  await waitFor(() => expect(view.getByRole('button', { name: '导出' })).toHaveProperty('disabled', false))
})

it('跟随序列的声音规格变化会重新探测；AAC全不可用时阻止提交，改WAV可恢复', async () => {
  const owner = await project()
  vi.mocked(canEncodeAudio).mockImplementation(async (codec, config) => codec === 'pcm-s24' || config?.sampleRate === 48000 && Number(config?.bitrate) <= 192000)
  const view = render(<VideoEditExportDialog projectId={owner.document.id} onClose={vi.fn()} />)
  await waitFor(() => expect(view.getByRole('button', { name: '导出' })).toHaveProperty('disabled', false))
  act(() => editVideoSequence(owner.document.id, owner.activeSequenceId, sequence => ({ ...sequence, sampleRate: 44100, channels: 1 })))
  await waitFor(() => expect(view.getByText(/此设备的 AAC 编码不支持/)).toBeTruthy())
  expect(view.getByRole('button', { name: '导出' })).toHaveProperty('disabled', true)
  expect(view.getByRole('button', { name: '加入队列' })).toHaveProperty('disabled', true)
  await select(view, '导出格式', '音频 · WAV')
  await waitFor(() => expect(view.getByRole('button', { name: '导出' })).toHaveProperty('disabled', false))
})

it('立即导出、队列和助手在文件选择与写入前拒绝不支持的AAC；修正码率后可完成', async () => {
  const owner = await project(); const snapshot = getActiveVideoEditSequence(owner)
  vi.mocked(canEncodeAudio).mockImplementation(async (_codec, config) => Number(config?.bitrate) <= 192000)
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
  vi.mocked(canEncodeVideo).mockImplementation(async codec => codec === 'hevc')
  const onClose = vi.fn(); const view = render(<VideoEditExportDialog projectId={owner.document.id} onClose={onClose} />)
  expect(view.getByRole('button', { name: '导出' })).toHaveProperty('disabled', true)
  await waitFor(() => expect(view.getByRole('button', { name: '导出' })).toHaveProperty('disabled', false))
  expect(view.getByRole('button', { name: '导出预设' }).textContent).toContain('与序列一致')
  expect(view.getByRole('button', { name: '导出格式' }).textContent).toContain('HEVC')
  expect(view.getByText(/HEVC · 3840 × 2160 · 60 帧 · 50 Mbps/)).toBeTruthy()
  const panelConfig = { width: 3840, height: 2160, frameRate: 60, bitrate: 50_000_000, bitrateMode: 'variable', hardwareAcceleration: 'prefer-hardware' }
  expect(canEncodeVideo).toHaveBeenCalledWith('hevc', panelConfig)
  vi.mocked(canEncodeVideo).mockClear()
  await act(async () => fireEvent.click(view.getByRole('button', { name: '导出' })))
  const job = videoEditExportQueue.list()[0]
  await act(async () => { await videoEditExportQueue.wait(job.id) })
  expect(job.state).toBe('completed'); expect(onClose).toHaveBeenCalledOnce()
  expect(job.settings).toMatchObject({ codec: 'hevc', width: 3840, height: 2160, fps: 60, videoBitrateMbps: 50 })
  expect(canEncodeVideo).toHaveBeenCalledWith('hevc', panelConfig)
  expect(encoding.videoOptions.at(-1)).toMatchObject({ codec: 'hevc', bitrate: 50_000_000, bitrateMode: 'variable', hardwareAcceleration: 'prefer-hardware' })
})
it('序列从1080p变为4K60会重新适配；手动把码率调到不可用时禁用导出且不静默替换', async () => {
  const owner = await project()
  vi.mocked(canEncodeVideo).mockImplementation(async (codec, config) => Number(config?.bitrate) <= 50_000_000 && (config?.width === 1920 || codec === 'hevc'))
  const view = render(<VideoEditExportDialog projectId={owner.document.id} onClose={vi.fn()} />)
  await waitFor(() => expect(view.getByRole('button', { name: '导出' })).toHaveProperty('disabled', false))
  expect(view.getByRole('button', { name: '导出格式' }).textContent).toContain('H.264')
  act(() => editVideoSequence(owner.document.id, owner.activeSequenceId, sequence => ({ ...sequence, width: 3840, height: 2160, frameRate: { numerator: 60, denominator: 1 } })))
  expect(view.getByRole('button', { name: '导出' })).toHaveProperty('disabled', true)
  await waitFor(() => expect(view.getByText(/HEVC · 3840 × 2160 · 60 帧 · 50 Mbps/)).toBeTruthy())
  await waitFor(() => expect(view.getByRole('button', { name: '导出' })).toHaveProperty('disabled', false))
  fireEvent.change(view.getByRole('slider', { name: '目标码率滑杆' }), { target: { value: '100' } })
  await waitFor(() => expect(view.getByText(/当前设备不支持所选编码设置/)).toBeTruthy())
  expect(view.getByRole('button', { name: '导出' })).toHaveProperty('disabled', true)
  expect(view.getByRole('button', { name: '导出预设' }).textContent).toContain('自定义')
  expect(view.getByRole('slider', { name: '目标码率滑杆' })).toHaveProperty('value', '100')
  fireEvent.click(view.getByRole('button', { name: '编码性能' }))
  const unsupported = view.getByRole('option', { name: '软件编码' })
  expect(unsupported).toHaveProperty('disabled', true)
  fireEvent.mouseEnter(unsupported.parentElement!)
  await waitFor(() => expect(view.getByRole('tooltip').textContent).toContain('当前设备不支持此规格'))
})
it('助手完整settings严格拒绝不支持H264且不选路径；只传预设则同源回落HEVC并完成', async () => {
  const owner = await project()
  editVideoSequence(owner.document.id, owner.activeSequenceId, sequence => ({ ...sequence, width: 3840, height: 2160, frameRate: { numerator: 60, denominator: 1 } }))
  vi.mocked(canEncodeVideo).mockImplementation(async codec => codec === 'hevc')
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
  expect(view.getByText('请先打开序列')).toBeTruthy(); expect(view.getByRole('button', { name: '导出' })).toHaveProperty('disabled', true)
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
  expect(view.getByText(/请使用偶数宽高/)).toBeTruthy(); expect(view.getByRole('button', { name: '导出' })).toHaveProperty('disabled', true)
  fireEvent.change(view.getByLabelText('导出宽度'), { target: { value: '1920' } }); fireEvent.blur(view.getByLabelText('导出宽度'))
  await waitFor(() => expect(view.getByRole('button', { name: '导出' })).toHaveProperty('disabled', false))
})
