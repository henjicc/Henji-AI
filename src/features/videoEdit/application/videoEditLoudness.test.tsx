import { createVideoEditTestProject as createVideoEditProject } from './videoEditDocumentTestKit'
// @vitest-environment jsdom
import path from 'node:path'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { getPlatform } from '@/platform/runtime'
import { matchVideoEditShortcut } from '@/core/videoEdit/commands'


import { videoEditComposition, type VideoEditComposition } from '@/core/videoEdit/document'
import { assertVideoEditSequenceGraph } from '@/core/videoEdit/sequenceGraph'
import type { VideoEditLoudnessMeasurement } from '@/core/videoEdit/loudness'
import type { AssetRecord } from '@/platform/contracts/assetLibrary'
import { appendVideoEditClip, appendVideoEditMedia, closeVideoEditProject, editVideoSequence, getActiveVideoEditSequence, videoEditExportRange, requireVideoEditInstance, listVideoEditInstances, undoVideoEdit } from './videoEditService'
import { applyVideoEditAudioGain, measureVideoEditClips, prepareVideoEditAudioGain, prepareVideoEditRecordingGain } from './videoEditLoudness'
import { VideoEditAudioGainDialog } from '../panels/VideoEditAudioGainDialog'
import { cancelVideoEditExport, exportVideoEdit as exportWithSettings, videoEditExportTask } from './videoEditExport'

import { videoEditSequenceExportSettings } from '@/core/videoEdit/exportPresets'
import { videoEditExportQueue } from './videoEditExportQueue'
const exportVideoEdit: typeof exportWithSettings = (id, target, background, signal, loudness) => { const owner = requireVideoEditInstance(id); const snapshot = getActiveVideoEditSequence(owner); return exportWithSettings(id, target, background, signal, loudness, { snapshot, range: videoEditExportRange(owner), settings: { ...videoEditSequenceExportSettings(snapshot), addToLibrary: false } }) }

const boundary = vi.hoisted(() => ({ mixes: vi.fn(), encoded: [] as number[], normalized: false }))
vi.mock('mediabunny', () => ({
  ALL_FORMATS: [], Input: class {}, UrlSource: class {}, Mp4OutputFormat: class {}, StreamTarget: class {},
  Output: class { addVideoTrack() {} addAudioTrack() {} async start() {} async finalize() {} async cancel() {} },
  CanvasSource: class { async add() {} }, AudioBufferSource: class { async add(buffer: AudioBuffer) { boundary.encoded.push(buffer.getChannelData(0)[0]) } },
}))
vi.mock('../engine/videoEditRenderSession', () => ({ VideoEditRenderSession: class {
  canvas = {}; constructor(private composition: VideoEditComposition) { assertVideoEditSequenceGraph({ items: composition.items, sequences: composition.sequences ?? [] }) }
  setSmartRegions() {} setTracks() {} async dispose() {}
  async render() { return { singleFrameReads: 0 } }
  async mixAudio(_start: number, duration: number) {
    boundary.mixes()
    const planes = Array.from({ length: this.composition.channels }, () => new Float32Array(Math.round(duration * this.composition.sampleRate)).fill((this.composition.clips[0]?.volume ?? 0) * 10 ** ((this.composition.clips[0]?.gainDb ?? 0) / 20)))
    return { numberOfChannels: planes.length, getChannelData: (channel: number) => planes[channel] }
  }
} }))
const peak = (volume: number): VideoEditLoudnessMeasurement => ({ integratedLufs: volume > 0 ? -20 + 20 * Math.log10(volume) : null, shortTermLufs: -20, truePeakDbtp: volume > 0 ? -12 + 20 * Math.log10(volume) : null, samplePeakDbfs: volume > 0 ? -13 + 20 * Math.log10(volume) : null, durationSeconds: 4 })
const pcm = new Map<string, number>()
beforeEach(() => {
  vi.stubGlobal('VideoEncoder', { isConfigSupported: async () => ({ supported: true }) })
  vi.stubGlobal('AudioEncoder', { isConfigSupported: async () => ({ supported: true }) })
  installHarnessNativeStorage(); pcm.clear(); boundary.encoded = []; boundary.normalized = false; boundary.mixes.mockClear()
  vi.stubGlobal('OffscreenCanvas', class { constructor(readonly width: number, readonly height: number) {} getContext() { return { fillRect() {}, drawImage() {}, fillStyle: '' } } })
  const platform = getPlatform()
  vi.spyOn(platform.videoEditExport, 'register').mockImplementation(async request => request.jobs.map(job => ({ id: job.id, retained: job.restorable })))
  vi.spyOn(platform.system.fs, 'writeTextFile').mockResolvedValue(undefined)
  vi.spyOn(platform.system.fs, 'exists').mockResolvedValue(false)
  vi.spyOn(platform.system.fs, 'writeFile').mockResolvedValue(undefined)
  vi.spyOn(platform.system.fs, 'remove').mockResolvedValue(undefined)
  vi.spyOn(platform.system.paths, 'dirname').mockResolvedValue(path.resolve(path.sep, 'fixture'))
  vi.spyOn(platform.assetLibrary, 'inspectFileContent').mockResolvedValue({ sizeBytes: 5, fileModifiedAt: 1, contentIdentity: 'a'.repeat(64) })
  const api = platform.audioEdit.loudness
  vi.spyOn(api, 'start').mockImplementation(async (_rate, _channels, id) => { pcm.set(id, 0) })
  vi.spyOn(api, 'append').mockImplementation(async (id, planes) => { pcm.set(id, planes[0][0]) })
  vi.spyOn(api, 'measure').mockImplementation(async id => peak(pcm.get(id)!))
  vi.spyOn(api, 'normalize').mockImplementation(async () => { boundary.normalized = true; return { ...peak(1), integratedLufs: -14 } })
  vi.spyOn(api, 'read').mockImplementation(async (_id, _start, frames) => [new Float32Array(frames).fill(.25), new Float32Array(frames).fill(.25)])
  vi.spyOn(api, 'close').mockImplementation(async id => { pcm.delete(id) })
  vi.stubGlobal('AudioBuffer', class { private planes: Float32Array[]; constructor({ numberOfChannels, length }: { numberOfChannels: number; length: number }) { this.planes = Array.from({ length: numberOfChannels }, () => new Float32Array(length)) } getChannelData(channel: number) { return this.planes[channel] } })
})
afterEach(async () => { cleanup(); for (const owner of listVideoEditInstances()) await closeVideoEditProject(owner.document.id); vi.restoreAllMocks(); vi.unstubAllGlobals(); uninstallHarnessNativeStorage() })
async function project() {
  const owner = (await createVideoEditProject())!; const id = owner.document.id
  appendVideoEditMedia(id, { id: 'sound', name: '对白', path: path.resolve(path.sep, 'fixture', 'dialog.wav'), kind: 'audio', width: 0, height: 0, durationSeconds: 4, hasAudio: true })
  const track = getActiveVideoEditSequence(owner).tracks.find(track => track.kind === 'audio')!.index
  appendVideoEditClip(id, 'sound', { frame: 0, track }); appendVideoEditClip(id, 'sound', { frame: 120, track })
  const target = { projectId: id, sequenceId: owner.activeSequenceId, clipIds: getActiveVideoEditSequence(owner).clips.map(clip => clip.id) }
  return { owner, id, target }
}
it('录后在草稿测量并保留单步撤销，片段音量可经现有属性读回；取消不产生历史', async () => {
  const { owner, target, id } = await project(), before = owner.past.length
  const volumes = await prepareVideoEditRecordingGain(videoEditComposition(owner.document, target.sequenceId), target.clipIds)
  expect(owner.past).toHaveLength(before)
  expect([...volumes.values()]).toEqual([4, 4])
  editVideoSequence(id, target.sequenceId, sequence => ({ ...sequence, clips: sequence.clips.map(clip => ({ ...clip, gainDb: volumes.get(clip.id) ?? clip.gainDb })) }))
  expect(owner.past).toHaveLength(before + 1)
  const app = createApplicationHarness()
  try { expect(((await app.read({ kind: 'video_edit.clip', id: `${id}:${target.clipIds[0]}` }, ['video_edit.clip.gain_db'])).properties as Record<string, unknown>)['video_edit.clip.gain_db']).toBe(4) }
  finally { app.dispose() }
  undoVideoEdit(id); expect(getActiveVideoEditSequence(owner).clips.map(clip => clip.volume)).toEqual([1, 1])
  const controller = new AbortController(); controller.abort()
  await expect(prepareVideoEditRecordingGain(videoEditComposition(owner.document, target.sequenceId), target.clipIds, controller.signal)).rejects.toThrow()
  expect(pcm.size).toBe(0)
})
it('G 与 PR 核对一致；多选增益对话框确定一次撤销，取消不改音量', async () => {
  expect(matchVideoEditShortcut({ code: 'KeyG', key: 'g', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, repeat: false, isComposing: false, defaultPrevented: false }, 'timeline', {})).toBe('audio_gain')
  const { owner, target, id } = await project(); const before = owner.past.length
  const close = vi.fn(); const view = render(<VideoEditAudioGainDialog target={target} onClose={close} />)
  fireEvent.change(view.getByLabelText('增益方式'), { target: { value: 'set' } })
  fireEvent.change(view.getByLabelText('增益 dB'), { target: { value: '-6.02' } }); fireEvent.blur(view.getByLabelText('增益 dB'))
  await act(async () => fireEvent.click(view.getByRole('button', { name: '确定' })))
  expect(owner.past).toHaveLength(before + 1); expect(getActiveVideoEditSequence(owner).clips.every(clip => clip.gainDb === -6.02 && clip.volume === 1)).toBe(true)
  undoVideoEdit(id); expect(getActiveVideoEditSequence(owner).clips.map(clip => clip.volume)).toEqual([1, 1]); expect(close).toHaveBeenCalledOnce()
  cleanup(); const cancel = render(<VideoEditAudioGainDialog target={target} onClose={vi.fn()} />); fireEvent.click(cancel.getByRole('button', { name: '取消' })); expect(getActiveVideoEditSequence(owner).clips.map(clip => clip.volume)).toEqual([1, 1])
})
it('测量只读；助手标准化经正式公共能力写音量、回读、保存并一步撤销；跨工程与无权限拒绝', async () => {
  const { owner, target, id } = await project(); const before = owner.past.length; const app = createApplicationHarness()
  const input = { documentRef: { kind: 'video_edit.document', id }, clipRefs: target.clipIds.map(clipId => ({ kind: 'video_edit.clip', id: `${id}:${clipId}` })) }
  try {
    const measured = await app.requireResult('measure_video_edit_loudness', input); expect(measured.verified).toBe(true); expect(owner.past).toHaveLength(before)
    const changed = await app.requireResult('normalize_video_edit_loudness', { ...input, targetLufs: -23 }); expect(changed.verified).toBe(true)
    expect(owner.past).toHaveLength(before + 1)
    expect(((await app.read(input.clipRefs[0], ['video_edit.clip.gain_db'])).properties as Record<string, unknown>)['video_edit.clip.gain_db']).toBe(-3)
    undoVideoEdit(id); expect(getActiveVideoEditSequence(owner).clips.map(clip => clip.volume)).toEqual([1, 1])
    expect((await app.call('normalize_video_edit_loudness', { ...input, clipRefs: [{ kind: 'video_edit.clip', id: `foreign:${target.clipIds[0]}` }], targetLufs: -23 })).ok).toBe(false)

    const baseline = await app.read(input.clipRefs[0])
    editVideoSequence(id, target.sequenceId, sequence => ({ ...sequence, name: '后续修改' }))
    expect((await app.call('normalize_video_edit_loudness', { ...input, targetLufs: -23 }, baseline.revisions as Record<string, number>)).ok).toBe(false)
    expect(getActiveVideoEditSequence(owner).clips.map(clip => clip.volume)).toEqual([1, 1])
  } finally { app.dispose() }
})
it('轨道锁定、测量期间修改与目标超出独立增益范围不产生部分历史', async () => {
  const { owner, target, id } = await project(); const before = owner.past.length
  await expect(applyVideoEditAudioGain(target, 'set', 97)).rejects.toThrow('-96～+96'); expect(owner.past).toHaveLength(before)
  vi.mocked(getPlatform().audioEdit.loudness.measure).mockImplementationOnce(async () => { editVideoSequence(id, target.sequenceId, sequence => ({ ...sequence, name: '另一次修改' })); return peak(1) })
  await expect(measureVideoEditClips(target)).rejects.toThrow('已有修改'); expect(getActiveVideoEditSequence(owner).clips.map(clip => clip.volume)).toEqual([1, 1])
  editVideoSequence(id, target.sequenceId, sequence => ({ ...sequence, tracks: sequence.tracks.map(track => ({ ...track, locked: true })) }))
  await expect(applyVideoEditAudioGain(target, 'set', -6)).rejects.toThrow('锁定')
  expect(pcm.size).toBe(0)
})
it('导出标准化编码处理后的 PCM、附上摘要；原片段音量与撤销历史不变', async () => {
  const { owner, id } = await project(); const before = owner.past.length
  await exportVideoEdit(id, path.resolve(path.sep, 'fixture', 'finished.mp4'), false, undefined, { targetLufs: -14, truePeakDbtp: -1 })
  expect(boundary.normalized).toBe(true); expect(boundary.encoded.length).toBe(8); expect(boundary.encoded.every(sample => sample === .25)).toBe(true)
  expect(boundary.mixes).toHaveBeenCalledTimes(8); expect(owner.past).toHaveLength(before); expect(getActiveVideoEditSequence(owner).clips.map(clip => clip.volume)).toEqual([1, 1])
  expect(videoEditExportTask(id)).toMatchObject({ state: 'completed', loudness: { targetLufs: -14, truePeakDbtp: -1 }, loudnessMeasurement: { integratedLufs: -14 } }); expect(pcm.size).toBe(0)
})
it('助手字幕导出拒绝响度设置，避免静默忽略目标', async () => {
  const { id } = await project(); const app = createApplicationHarness()
  try {
    const result = await app.call('export_video_edit', { documentRef: { kind: 'video_edit.document', id }, format: 'srt', loudness: { targetLufs: -14, truePeakDbtp: -1 } })
    expect(result.ok).toBe(false); expect(JSON.stringify(result)).toContain('字幕导出不包含声音')
    expect(getPlatform().system.fs.writeFile).not.toHaveBeenCalled()
  } finally { app.dispose() }
})

it('t95 D5：公共默认无声导出正常完成并说明跳过；显式标准化返回可行动错误', async () => {
  const { id, target } = await project()
  editVideoSequence(id, target.sequenceId, sequence => ({ ...sequence, clips: sequence.clips.map(clip => ({ ...clip, volume: 0 })) }))
  const platform = getPlatform()
  vi.spyOn(platform.system.fs, 'mkdir').mockResolvedValue(undefined)
  let exportedAsset: AssetRecord
  vi.spyOn(platform.assetLibrary, 'createAsset').mockImplementation(async input => {
    exportedAsset = { id: 'silent-export', filePath: input.filePath, mediaType: input.mediaType, displayName: input.displayName ?? '无声成片', displayUrl: '', source: input.source, mimeType: 'video/mp4', sizeBytes: 5, fileModifiedAt: 1, contentIdentity: 'a'.repeat(64), width: 1920, height: 1080, durationSeconds: 8, thumbnailPath: null, thumbnailUrl: null, inspectionStatus: 'ready', inspectionError: null, lastUsedAt: null, createdAt: 1, updatedAt: 1, tags: [], libraryIds: [] }
    return exportedAsset
  })
  vi.spyOn(platform.assetLibrary, 'inspectAsset').mockImplementation(async () => exportedAsset)
  const app = createApplicationHarness(); const documentRef = { kind: 'video_edit.document', id }
  try {
    const submitted = await app.requireResult('export_video_edit', { documentRef })
    const jobId = (submitted.queue as Array<{ id: string }>)[0].id
    await videoEditExportQueue.wait(jobId)
    const queried = await app.requireResult('query_video_edit_export', { documentRef, taskId: jobId })
    expect(queried, JSON.stringify(queried)).toMatchObject({ queue: [{ state: 'completed', outputReady: true, notice: expect.stringContaining('跳过默认响度标准化') }] })
    expect(platform.audioEdit.loudness.normalize).not.toHaveBeenCalled()
    const explicit = await app.requireResult('export_video_edit', { documentRef, loudness: { targetLufs: -14, truePeakDbtp: -1 } })
    const explicitId = (explicit.queue as Array<{ id: string }>)[0].id
    await videoEditExportQueue.wait(explicitId)
    expect(await app.requireResult('query_video_edit_export', { documentRef, taskId: explicitId })).toMatchObject({ queue: [{ state: 'failed', error: expect.stringContaining('关闭响度标准化') }] })
  } finally { videoEditExportQueue.clearFinished(); app.dispose() }
})
it('标准化期间取消不会写出导出文件，释放后台声音并解除忙碌状态', async () => {
  const { owner, id } = await project()
  let reject!: (error: Error) => void
  const api = getPlatform().audioEdit.loudness
  vi.mocked(api.normalize).mockImplementationOnce(async () => new Promise((_resolve, fail) => { reject = fail }))
  const operation = exportVideoEdit(id, path.resolve(path.sep, 'fixture', 'cancelled.mp4'), false, undefined, { targetLufs: -14, truePeakDbtp: -1 })
  await vi.waitFor(() => expect(api.normalize).toHaveBeenCalledOnce())
  cancelVideoEditExport(id); reject(new Error('取消'))
  expect(await operation).toBeNull(); expect(owner.busy).toBe(false); expect(videoEditExportTask(id)?.state).toBe('cancelled')
  expect(getPlatform().system.fs.writeFile).not.toHaveBeenCalled(); expect(pcm.size).toBe(0)
})
it('成片草稿保留不可测量静音，不影响显式响度调整的失败契约', async () => {
  const { owner, target } = await project()
  vi.mocked(getPlatform().audioEdit.loudness.measure).mockResolvedValue(peak(0))
  const composition = videoEditComposition(owner.document, target.sequenceId), history = owner.past.length
  const prepared = await prepareVideoEditAudioGain(composition, composition.clips, 'loudness', -16, undefined, undefined, true)
  expect(prepared.map(v => v.gainDb)).toEqual(composition.clips.map(v => v.gainDb ?? 0))
  expect(owner.past).toHaveLength(history)
  await expect(applyVideoEditAudioGain(target, 'loudness', -16)).rejects.toThrow()
  expect(owner.past).toHaveLength(history)
})
it('含嵌套序列的工程测量独立声音时，不携带已被裁剪素材引用的无关序列', async () => {
  const { owner, target } = await project(), composition = structuredClone(videoEditComposition(owner.document, target.sequenceId))
  composition.items.push({ id: 'nested-item', name: '嵌套', kind: 'sequence', sequenceId: composition.id })
  composition.sequences = [{ ...composition, id: 'parent', clips: [{ ...composition.clips[0], id: 'nested-clip', kind: 'sequence', itemId: 'nested-item' }] }, { ...composition }]
  assertVideoEditSequenceGraph({ items: composition.items, sequences: composition.sequences })
  const gains = await prepareVideoEditAudioGain(composition, composition.clips, 'loudness', -16)
  expect(gains.every(value => Math.abs(value.measurement!.integratedLufs! + 16) <= .5)).toBe(true)
})
it.each(['peak_max', 'peak_all'] as const)('%s：最大峰值共同缩放保持相对关系，所有峰值分别对齐，重新测量后一次提交', async mode => {
  const { owner, target, id } = await project()
  editVideoSequence(id, target.sequenceId, sequence => ({ ...sequence, clips: sequence.clips.map((clip, index) => ({ ...clip, volume: index ? .5 : 1 })) }))
  const before = owner.past.length
  const result = await applyVideoEditAudioGain(target, mode, -12)
  expect(result[0].measurement!.samplePeakDbfs).toBeCloseTo(-12)
  if (mode === 'peak_max') expect(result[1].gainDb).toBeCloseTo(result[0].gainDb)
  else expect(result[1].measurement!.samplePeakDbfs).toBeCloseTo(-12)
  expect(owner.past).toHaveLength(before + 1); undoVideoEdit(id); expect(getActiveVideoEditSequence(owner).clips.map(clip => clip.volume)).toEqual([1, .5])
})

it('超过 +6 dB 的源标准化保留音量、关键帧与效果，重复执行不累加增益', async () => {
  const { owner, target, id } = await project()
  editVideoSequence(id, target.sequenceId, sequence => ({ ...sequence, clips: sequence.clips.map(clip => ({ ...clip, gainDb: -8, volume: .25, curves: { volume: [{ time: 0, value: .1, interpolation: 'linear' as const }, { time: 30, value: .5, interpolation: 'linear' as const }] }, fadeInFrames: 10 })) }))
  const before = structuredClone(getActiveVideoEditSequence(owner).clips)
  const result = await applyVideoEditAudioGain(target, 'loudness', -5)
  expect(result.map(value => value.gainDb)).toEqual([15, 15])
  expect(result.every(value => Math.abs(value.measurement!.integratedLufs! + 5) <= .5)).toBe(true)
  expect(getActiveVideoEditSequence(owner).clips).toEqual(before.map(clip => ({ ...clip, gainDb: 15 })))
  expect((await applyVideoEditAudioGain(target, 'loudness', -5)).map(value => value.gainDb)).toEqual([15, 15])
  const app = createApplicationHarness()
  try {
    const ref = { kind: 'video_edit.clip', id: `${id}:${target.clipIds[0]}` }
    expect((await app.read(ref, ['video_edit.clip.gain_db'])).properties).toMatchObject({ 'video_edit.clip.gain_db': 15 })
    expect((await app.change(ref, { 'video_edit.clip.gain_db': 24 })).ok).toBe(true)
    expect((await app.read(ref, ['video_edit.clip.gain_db', 'video_edit.clip.volume'])).properties).toMatchObject({ 'video_edit.clip.gain_db': 24, 'video_edit.clip.volume': .25 })
    expect((await app.change(ref, { 'video_edit.clip.gain_db': 97 })).ok).toBe(false)
  } finally { app.dispose() }
})

it('低电平源跨越响度门限后按复测有限校正，失败不产生部分提交', async () => {
  const { owner, target } = await project(), before = owner.past.length
  const measure = vi.mocked(getPlatform().audioEdit.loudness.measure)
  measure.mockResolvedValueOnce({ ...peak(1), integratedLufs: -50 }).mockResolvedValueOnce(peak(1))
    .mockResolvedValueOnce({ ...peak(1), integratedLufs: -17.2 }).mockResolvedValueOnce({ ...peak(1), integratedLufs: -16 })
  const result = await applyVideoEditAudioGain(target, 'loudness', -16)
  expect(result[0].gainDb).toBeCloseTo(35.2)
  expect(result[1].gainDb).toBe(4)
  expect(owner.past).toHaveLength(before + 1)
  expect(getActiveVideoEditSequence(owner).clips.map(clip => clip.volume)).toEqual([1, 1])
  measure.mockResolvedValue({ ...peak(1), integratedLufs: -20 })
  const saved = structuredClone(owner.document)
  await expect(applyVideoEditAudioGain(target, 'loudness', -16)).rejects.toThrow('未达到标准化目标')
  expect(owner.document).toEqual(saved)
  expect(owner.past).toHaveLength(before + 1)
  expect(pcm.size).toBe(0)
})
