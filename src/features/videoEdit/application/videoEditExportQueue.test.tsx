import { createVideoEditTestProject as createVideoEditProject } from './videoEditDocumentTestKit'
// @vitest-environment jsdom
import path from 'node:path'
import { canEncodeVideo } from 'mediabunny'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { getPlatform } from '@/platform/runtime'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { VIDEO_EDIT_EXPORT_PRESETS } from '@/core/videoEdit/exportPresets'
import type { VideoEditComposition } from '@/core/videoEdit/document'
import { runApplicationCloseGuards } from '@/core/applicationLifecycle/applicationCloseGuards'
import { appendVideoEditClip, closeVideoEditProject, editVideoSequence, getActiveVideoEditSequence, listVideoEditInstances, videoEditExportRange } from './videoEditService'
import { VideoEditExportQueue, enqueueVideoEditExports, videoEditExportQueue, retryVideoEditExportJob, videoEditQueuedExportTask, type VideoEditExportJob } from './videoEditExportQueue'
import { VideoEditExportPresetLibrary, videoEditExportPresetLibrary } from './videoEditExportPresets'
import { VideoEditExportDialog } from '../panels/VideoEditExportDialog'

const encoding = vi.hoisted(() => ({ rendered: [] as Array<[string, number]>, videoTimes: [] as number[], audio: [] as number[], finalize: vi.fn(), draw: vi.fn(), formats: [] as string[], videoOptions: [] as unknown[] }))
vi.mock('mediabunny', () => ({
  canEncodeVideo: vi.fn(async () => true),
  ALL_FORMATS: [], Input: class {}, UrlSource: class {},
  Mp4OutputFormat: class { constructor() { encoding.formats.push('mp4') } }, AdtsOutputFormat: class { constructor() { encoding.formats.push('aac') } }, WavOutputFormat: class { constructor() { encoding.formats.push('wav') } }, StreamTarget: class {},
  Output: class { addVideoTrack() {} addAudioTrack() {} async start() {} finalize = encoding.finalize; async cancel() {} },
  CanvasSource: class { constructor(_canvas: unknown, options: unknown) { encoding.videoOptions.push(options) } async add(time: number) { encoding.videoTimes.push(time) } },
  AudioBufferSource: class { async add(buffer: AudioBuffer) { encoding.audio.push(buffer.length) } },
}))
vi.mock('../engine/videoEditRenderSession', () => ({ VideoEditRenderSession: class {
  canvas = {}; constructor(private composition: VideoEditComposition) {}
  setSmartRegions() {} setTracks() {} async dispose() {}
  async render(frame: number) { encoding.rendered.push([this.composition.name, frame]); return { singleFrameReads: 0 } }
  async mixAudio(_time: number, duration: number) { return new AudioBuffer({ numberOfChannels: this.composition.channels, sampleRate: this.composition.sampleRate, length: Math.round(duration * this.composition.sampleRate) }) }
} }))
const file = (name: string): string => path.resolve(path.sep, 'fixture', name)
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail }); return { promise, resolve, reject } }
beforeEach(() => {
  vi.mocked(canEncodeVideo).mockReset().mockResolvedValue(true)
  installHarnessNativeStorage(); encoding.rendered = []; encoding.videoTimes = []; encoding.audio = []; encoding.formats = []; encoding.videoOptions = []; encoding.draw.mockClear(); encoding.finalize.mockReset().mockResolvedValue(undefined)
  videoEditExportQueue.clearFinished(); videoEditExportPresetLibrary.replace([])
  const platform = getPlatform()
  vi.spyOn(platform.system.fs, 'writeTextFile').mockResolvedValue(undefined)
  vi.spyOn(platform.system.fs, 'writeFile').mockResolvedValue(undefined)
  vi.spyOn(platform.system.fs, 'exists').mockResolvedValue(false)
  vi.spyOn(platform.system.fs, 'remove').mockResolvedValue(undefined)
  vi.spyOn(platform.system.dialog, 'save').mockResolvedValue(file('output.mp4'))
  vi.spyOn(platform.system.paths, 'dirname').mockResolvedValue(file(''))
  vi.spyOn(platform.media, 'allowRoot').mockResolvedValue(undefined)
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
  const settings = { ...VIDEO_EDIT_EXPORT_PRESETS[0].settings, fps: 60, loudness: null }
  const jobs = await enqueueVideoEditExports([{ projectId, settings, path: file('a.mp4'), range: { startFrame: 1, endFrame: 3 } }, { projectId, settings: { ...settings, format: 'wav' }, path: file('b.wav') }])
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
it('对话框选择预设、折叠高级、保存自定义并加入两份；立即导出取消文件选择保持对话框', async () => {
  const owner = await project(); const close = vi.fn(); const ui = render(<VideoEditExportDialog projectId={owner.document.id} onClose={close} />)
  expect(ui.queryByLabelText('导出宽度')).toBeNull()
  fireEvent.change(ui.getByLabelText('导出预设'), { target: { value: 'builtin:douyin' } })
  fireEvent.click(ui.getByRole('button', { name: '高级设置' })); expect((ui.getByLabelText('导出宽度') as HTMLInputElement).value).toBe('1080')
  fireEvent.change(ui.getByLabelText('自定义预设名称'), { target: { value: '自定义竖版' } }); fireEvent.click(ui.getByRole('button', { name: '保存' })); expect(videoEditExportPresetLibrary.custom()).toHaveLength(1)
  await act(async () => { fireEvent.click(ui.getByRole('button', { name: '加入队列' })) }); await waitFor(() => expect(videoEditExportQueue.list()).toHaveLength(1)); expect(close).not.toHaveBeenCalled()
  await act(async () => { await videoEditExportQueue.wait(videoEditExportQueue.list()[0].id) })
  fireEvent.change(ui.getByLabelText('导出预设'), { target: { value: 'builtin:bilibili' } }); vi.mocked(getPlatform().system.dialog.save).mockResolvedValueOnce(file('second.mp4'))
  await act(async () => { fireEvent.click(ui.getByRole('button', { name: '加入队列' })) }); await act(async () => { await videoEditExportQueue.wait(videoEditExportQueue.list()[1].id) })
  expect(videoEditExportQueue.list().map(job => [job.settings.width, job.settings.height])).toEqual([[1080, 1920], [1920, 1080]])
  vi.mocked(getPlatform().system.dialog.save).mockResolvedValueOnce(null); await act(async () => { fireEvent.click(ui.getByRole('button', { name: '立即导出' })) }); expect(close).not.toHaveBeenCalled()
  vi.mocked(getPlatform().system.dialog.save).mockResolvedValueOnce(file('immediate.mp4')); await act(async () => { fireEvent.click(ui.getByRole('button', { name: '立即导出' })) })
  await act(async () => { await videoEditExportQueue.wait(videoEditExportQueue.list()[2].id) }); await waitFor(() => expect(close).toHaveBeenCalledOnce())
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
    const state = await app.read({ kind: 'video_edit.export_preset', id: preset.id }, ['video_edit.export_preset.name']); expect(JSON.stringify(state)).toContain('助手模板')
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
  expect(encoding.videoOptions).toEqual([{ codec: 'hevc', bitrate: 80_000_000 }])
  expect(encoding.videoTimes).toEqual([0, 1 / 120, 2 / 120, 3 / 120])
})
it('导出面板对设备不支持的8K120帧禁用动作并给出降低规格的恢复方式', async () => {
  const owner = await project()
  editVideoSequence(owner.document.id, owner.activeSequenceId, sequence => ({ ...sequence, width: 7680, height: 4320, frameRate: { numerator: 120, denominator: 1 } }))
  vi.mocked(canEncodeVideo).mockResolvedValue(false)
  const view = render(<VideoEditExportDialog projectId={owner.document.id} onClose={vi.fn()} />)
  fireEvent.change(view.getByLabelText('导出预设'), { target: { value: 'builtin:master' } })
  await waitFor(() => expect(view.getByText('当前设备无法导出 7680 × 4320 · 120 帧视频。请降低导出分辨率或帧率后重试。')).toBeTruthy())
  expect(view.getByRole('button', { name: '立即导出' })).toHaveProperty('disabled', true)
  expect(view.getByRole('button', { name: '加入队列' })).toHaveProperty('disabled', true)
  fireEvent.change(view.getByLabelText('导出预设'), { target: { value: 'builtin:bilibili' } })
  expect(view.getByRole('button', { name: '立即导出' })).toHaveProperty('disabled', false)
})

it('导出队列接纳300项，仍串行处理而不按128项拒绝', async () => {
  const owner = await project(); let active = 0; let peak = 0
  const queue = new VideoEditExportQueue(async () => { peak = Math.max(peak, ++active); await Promise.resolve(); active-- })
  queue.append(Array.from({ length: 300 }, (_, index) => localJob(owner, `large-${index}`)))
  await queue.wait('large-299'); expect(queue.list()).toHaveLength(300); expect(peak).toBe(1)
})
