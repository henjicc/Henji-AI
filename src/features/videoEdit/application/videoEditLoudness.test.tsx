import { createVideoEditTestProject as createVideoEditProject } from './videoEditDocumentTestKit'
// @vitest-environment jsdom
import path from 'node:path'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { getPlatform } from '@/platform/runtime'
import { matchVideoEditShortcut } from '@/core/videoEdit/commands'
import { createApplicationCallerGrant } from '@/core/application-control/callerContext'
import { createApplicationCapabilitySession } from '@/features/application-control/applicationCapabilityService'
import type { VideoEditComposition } from '@/core/videoEdit/document'
import type { VideoEditLoudnessMeasurement } from '@/core/videoEdit/loudness'
import { appendVideoEditClip, appendVideoEditMedia, closeVideoEditProject, editVideoSequence, getActiveVideoEditSequence, videoEditExportRange, requireVideoEditInstance, listVideoEditInstances, undoVideoEdit } from './videoEditService'
import { applyVideoEditAudioGain, measureVideoEditClips } from './videoEditLoudness'
import { VideoEditAudioGainDialog } from '../panels/VideoEditAudioGainDialog'
import { cancelVideoEditExport, exportVideoEdit as exportWithSettings, videoEditExportTask } from './videoEditExport'

import { videoEditSequenceExportSettings } from '@/core/videoEdit/exportPresets'
const exportVideoEdit: typeof exportWithSettings = (id, target, background, signal, loudness) => { const owner = requireVideoEditInstance(id); const snapshot = getActiveVideoEditSequence(owner); return exportWithSettings(id, target, background, signal, loudness, { snapshot, range: videoEditExportRange(owner), settings: { ...videoEditSequenceExportSettings(snapshot), addToLibrary: false } }) }

const boundary = vi.hoisted(() => ({ mixes: vi.fn(), encoded: [] as number[], normalized: false }))
vi.mock('mediabunny', () => ({
  canEncodeVideo: async () => true,
  canEncodeAudio: async () => true,
  ALL_FORMATS: [], Input: class {}, UrlSource: class {}, Mp4OutputFormat: class {}, StreamTarget: class {},
  Output: class { addVideoTrack() {} addAudioTrack() {} async start() {} async finalize() {} async cancel() {} },
  CanvasSource: class { async add() {} }, AudioBufferSource: class { async add(buffer: AudioBuffer) { boundary.encoded.push(buffer.getChannelData(0)[0]) } },
}))
vi.mock('../engine/videoEditRenderSession', () => ({ VideoEditRenderSession: class {
  canvas = {}; constructor(private composition: VideoEditComposition) {}
  setSmartRegions() {} setTracks() {} async dispose() {}
  async render() { return { singleFrameReads: 0 } }
  async mixAudio(_start: number, duration: number) {
    boundary.mixes()
    const planes = Array.from({ length: this.composition.channels }, () => new Float32Array(Math.round(duration * this.composition.sampleRate)).fill(this.composition.clips[0]?.volume ?? 0))
    return { numberOfChannels: planes.length, getChannelData: (channel: number) => planes[channel] }
  }
} }))
const peak = (volume: number): VideoEditLoudnessMeasurement => ({ integratedLufs: volume > 0 ? -20 + 20 * Math.log10(volume) : null, shortTermLufs: -20, truePeakDbtp: volume > 0 ? -12 + 20 * Math.log10(volume) : null, samplePeakDbfs: volume > 0 ? -13 + 20 * Math.log10(volume) : null, durationSeconds: 4 })
const pcm = new Map<string, number>()
beforeEach(() => {
  installHarnessNativeStorage(); pcm.clear(); boundary.encoded = []; boundary.normalized = false; boundary.mixes.mockClear()
  vi.stubGlobal('OffscreenCanvas', class { constructor(readonly width: number, readonly height: number) {} getContext() { return { fillRect() {}, drawImage() {}, fillStyle: '' } } })
  const platform = getPlatform()
  vi.spyOn(platform.system.fs, 'writeTextFile').mockResolvedValue(undefined)
  vi.spyOn(platform.system.fs, 'exists').mockResolvedValue(false)
  vi.spyOn(platform.system.fs, 'writeFile').mockResolvedValue(undefined)
  vi.spyOn(platform.system.fs, 'remove').mockResolvedValue(undefined)
  vi.spyOn(platform.media, 'allowRoot').mockResolvedValue(undefined)
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
it('G 与 PR 核对一致；多选增益对话框确定一次撤销，取消不改音量', async () => {
  expect(matchVideoEditShortcut({ code: 'KeyG', key: 'g', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, repeat: false, isComposing: false, defaultPrevented: false }, 'timeline', {})).toBe('audio_gain')
  const { owner, target, id } = await project(); const before = owner.past.length
  const close = vi.fn(); const view = render(<VideoEditAudioGainDialog target={target} onClose={close} />)
  fireEvent.change(view.getByLabelText('增益方式'), { target: { value: 'set' } })
  fireEvent.change(view.getByLabelText('增益 dB'), { target: { value: '-6.02' } }); fireEvent.blur(view.getByLabelText('增益 dB'))
  await act(async () => fireEvent.click(view.getByRole('button', { name: '确定' })))
  expect(owner.past).toHaveLength(before + 1); expect(getActiveVideoEditSequence(owner).clips.every(clip => Math.abs(clip.volume - .5) < .001)).toBe(true)
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
    expect(((await app.read(input.clipRefs[0], ['video_edit.clip.volume'])).properties as Record<string, unknown>)['video_edit.clip.volume']).toBeCloseTo(10 ** (-3 / 20))
    undoVideoEdit(id); expect(getActiveVideoEditSequence(owner).clips.map(clip => clip.volume)).toEqual([1, 1])
    expect((await app.call('normalize_video_edit_loudness', { ...input, clipRefs: [{ kind: 'video_edit.clip', id: `foreign:${target.clipIds[0]}` }], targetLufs: -23 })).ok).toBe(false)
    const denied = createApplicationCapabilitySession(createApplicationCallerGrant({ callerId: 'read-only', capabilityIds: ['normalize_video_edit_loudness'], permissions: ['video_edit:read'], allowWrites: false, allowDestructive: false }))
    await expect(denied.execute({ id: 'normalize_video_edit_loudness', version: 1, input: { ...input, targetLufs: -23 } }, { requestId: crypto.randomUUID(), signal: new AbortController().signal })).rejects.toThrow('PERMISSION_DENIED')
    const baseline = await app.read(input.clipRefs[0])
    editVideoSequence(id, target.sequenceId, sequence => ({ ...sequence, name: '后续修改' }))
    expect((await app.call('normalize_video_edit_loudness', { ...input, targetLufs: -23 }, baseline.revisions as Record<string, number>)).ok).toBe(false)
    expect(getActiveVideoEditSequence(owner).clips.map(clip => clip.volume)).toEqual([1, 1])
  } finally { app.dispose() }
})
it('轨道锁定、测量期间修改与目标超出已有音量范围不产生部分历史', async () => {
  const { owner, target, id } = await project(); const before = owner.past.length
  await expect(applyVideoEditAudioGain(target, 'loudness', -5)).rejects.toThrow('+6.02'); expect(owner.past).toHaveLength(before)
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
it.each(['peak_max', 'peak_all'] as const)('%s：最大峰值共同缩放保持相对关系，所有峰值分别对齐，重新测量后一次提交', async mode => {
  const { owner, target, id } = await project()
  editVideoSequence(id, target.sequenceId, sequence => ({ ...sequence, clips: sequence.clips.map((clip, index) => ({ ...clip, volume: index ? .5 : 1 })) }))
  const before = owner.past.length
  const result = await applyVideoEditAudioGain(target, mode, -12)
  expect(result[0].measurement!.samplePeakDbfs).toBeCloseTo(-12)
  if (mode === 'peak_max') expect(result[1].volume / result[0].volume).toBeCloseTo(.5)
  else expect(result[1].measurement!.samplePeakDbfs).toBeCloseTo(-12)
  expect(owner.past).toHaveLength(before + 1); undoVideoEdit(id); expect(getActiveVideoEditSequence(owner).clips.map(clip => clip.volume)).toEqual([1, .5])
})
