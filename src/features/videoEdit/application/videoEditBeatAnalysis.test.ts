import { readVideoEditMediaAudio, analyzeVideoEditMediaAudio } from './videoEditContentAudio'
import { AudioContentAnalyzer } from '@/core/audioAnalysis/contentAnalysis'
// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import path from 'node:path'
import { BeatAnalyzer } from '@/core/audioAnalysis/beatAnalysis'
import type { VideoEditComposition } from '@/core/videoEdit/document'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { createApplicationCallerGrant } from '@/core/application-control/callerContext'
import { createApplicationCapabilitySession } from '@/features/application-control/applicationCapabilityService'
import { createVideoEditTestProject, failVideoEditSaves, reopenVideoEdit } from './videoEditDocumentTestKit'
import { appendVideoEditClip, appendVideoEditMedia, closeVideoEditProject, editVideoSequence, getActiveVideoEditSequence, listVideoEditInstances, undoVideoEdit, updateVideoEditCreativeIntents } from './videoEditService'
import { analyzeVideoEditBeats, cancelVideoEditBeatAnalysis, videoEditBeatTask } from './videoEditBeatAnalysis'
import { harnessDocumentStore } from '@/tests/harnessNativeStorage'

const boundary = vi.hoisted(() => ({ compositions: [] as VideoEditComposition[], dispose: vi.fn(), silence: false, block: undefined as (() => Promise<void>) | undefined }))
vi.mock('../engine/videoEditRenderSession', () => ({ VideoEditRenderSession: class {
  constructor(private readonly composition: VideoEditComposition) { boundary.compositions.push(composition) }
  async dispose() { boundary.dispose() }
  async mixAudio(at: number, seconds: number) {
    await boundary.block?.()
    const rate = this.composition.sampleRate, clipStart = this.composition.clips[0].start / this.composition.fps
    const pcm = new Float32Array(Math.round(seconds * rate))
    if (!boundary.silence) for (let i = 0; i < pcm.length; i++) {
      const time = at - clipStart + i / rate - .137, phase = ((time % .5) + .5) % .5
      if (time >= 0 && phase < .035) pcm[i] = Math.exp(-phase / .008) * Math.cos(2 * Math.PI * 90 * phase)
    }
    return { numberOfChannels: 1, getChannelData: () => pcm }
  }
} }))
vi.mock('./videoEditBeatWorkerClient', () => ({ analyzeVideoEditBeatsOffThread: async (rate: number, blocks: AsyncIterable<Float32Array[]>, signal: AbortSignal, fps?: number) => {
  const analyzer = fps === undefined ? new BeatAnalyzer(rate) : new AudioContentAnalyzer(rate, fps)
  for await (const planes of blocks) { signal.throwIfAborted(); analyzer.append(planes) }
  signal.throwIfAborted(); return analyzer.finish()
} }))
beforeEach(() => { installHarnessNativeStorage(); boundary.compositions = []; boundary.dispose.mockClear(); boundary.silence = false; boundary.block = undefined })
afterEach(async () => { failVideoEditSaves(false); for (const owner of listVideoEditInstances()) await closeVideoEditProject(owner.document.id); vi.restoreAllMocks(); uninstallHarnessNativeStorage() })
async function setup() {
  const owner = await createVideoEditTestProject(), id = owner.document.id
  appendVideoEditMedia(id, { id: 'sound', name: '鼓点', path: path.resolve(path.sep, 'fixture', 'beat.wav'), kind: 'audio', width: 0, height: 0, durationSeconds: 4, hasAudio: true })
  const track = getActiveVideoEditSequence(owner).tracks.find(t => t.kind === 'audio')!.index
  appendVideoEditClip(id, 'sound', { frame: 30, track })
  const clipId = getActiveVideoEditSequence(owner).clips[0].id, target = { projectId: id, sequenceId: owner.activeSequenceId, clipId }
  editVideoSequence(id, target.sequenceId, sequence => ({ ...sequence, markers: [{ id: 'normal', frame: 60, name: '保留' }, { id: 'other-beat', frame: 0, name: '另一来源', type: 'beat' }] }))
  return { owner, id, clipId, target }
}
it('混音期间仅写讲解元数据不使节拍分析失效，元数据保留且一次撤销', async () => {
  const { owner, id, target } = await setup(); const history = owner.past.length
  const head = { drafts: [], sessions: [], resources: [] }
  boundary.block = async () => { updateVideoEditCreativeIntents(id, head) }
  expect(await analyzeVideoEditBeats(target)).toHaveLength(8)
  expect(owner.document.creativeIntents).toEqual(head)
  expect(owner.past).toHaveLength(history + 1)
})

it('公共节拍能力回读较新的元数据仍验证内容，回读期间内容编辑仍使验证失败', async () => {
  const { owner, id, target } = await setup(); const app = createApplicationHarness()
  const store = harnessDocumentStore(); const read = store.readDocument.bind(store)
  let changeContent = false
  vi.spyOn(store, 'readDocument').mockImplementation(async (...args) => {
    if (changeContent) editVideoSequence(id, target.sequenceId, sequence => ({ ...sequence, name: '回读期间编辑' }))
    else {
      updateVideoEditCreativeIntents(id, { drafts: [], sessions: [], resources: [] })
      const stored = store.stored(id)!
      stored.content = { ...(stored.content as object), creativeIntents: owner.document.creativeIntents }
    }
    return read(...args)
  })
  const input = { documentRef: { kind: 'video_edit.document', id }, sequenceRef: { kind: 'video_edit.sequence', id: `${id}:${target.sequenceId}` }, clipRef: { kind: 'video_edit.clip', id: `${id}:${target.clipId}` } }
  try {
    expect(await app.requireResult('analyze_video_edit_beats', input)).toMatchObject({ verified: true })
    changeContent = true
    expect(await app.requireResult('analyze_video_edit_beats', input)).toMatchObject({ verified: false })
  } finally { app.dispose() }
})
it('片段分析写现有标记、保留普通/其他来源标记，重分析替换旧结果且各一步撤销', async () => {
  const { owner, id, target } = await setup(), before = owner.document, history = owner.past.length
  const markers = await analyzeVideoEditBeats(target)
  expect(markers).toHaveLength(8); expect(markers[0].frame).toBe(34)
  expect(markers.every(mark => mark.type === 'beat' && mark.clipId === target.clipId && (mark.strength ?? 0) > 0)).toBe(true)
  expect(getActiveVideoEditSequence(owner).markers).toHaveLength(10); expect(owner.past).toHaveLength(history + 1)
  await analyzeVideoEditBeats(target); expect(getActiveVideoEditSequence(owner).markers).toHaveLength(10); expect(owner.past).toHaveLength(history + 2)
  undoVideoEdit(id); expect(getActiveVideoEditSequence(owner).markers).toEqual([...before.sequences[0].markers!, ...markers]); undoVideoEdit(id); expect(owner.document.sequences).toEqual(before.sequences)
  expect(boundary.dispose).toHaveBeenCalledTimes(2); expect(videoEditBeatTask(id)).toBeUndefined()
})
it('序列使用可听混音，显式片段可分析静音轨，锁定片段拒绝', async () => {
  const { owner, id, target } = await setup()
  const mixed = await analyzeVideoEditBeats({ ...target, clipId: undefined })
  expect(mixed).toHaveLength(8); expect(mixed.every(mark => mark.clipId === undefined)).toBe(true)
  expect(boundary.compositions[0].clips).toEqual(getActiveVideoEditSequence(owner).clips)
  expect(getActiveVideoEditSequence(owner).markers!.some(mark => mark.id === 'normal')).toBe(true)
  expect(getActiveVideoEditSequence(owner).markers!.some(mark => mark.id === 'other-beat')).toBe(false)
  editVideoSequence(id, target.sequenceId, sequence => ({ ...sequence, tracks: sequence.tracks.map(t => t.kind === 'audio' ? { ...t, muted: true } : t) }))
  await expect(analyzeVideoEditBeats({ ...target, clipId: undefined })).rejects.toThrow('没有')
  await analyzeVideoEditBeats(target); expect(boundary.compositions.at(-1)!.tracks.every(t => !t.muted && t.enabled)).toBe(true)
  editVideoSequence(id, target.sequenceId, sequence => ({ ...sequence, tracks: sequence.tracks.map(t => ({ ...t, locked: true })) }))
  const before = owner.document
  await expect(analyzeVideoEditBeats(target)).rejects.toThrow('锁定'); expect(owner.document).toBe(before)
})
it.each(['cancel', 'stale', 'silence'] as const)('%s 不写入、不新增历史、释放混音与任务', async mode => {
  const { owner, id, target } = await setup()
  let unblock: (() => void) | undefined
  if (mode !== 'silence') boundary.block = () => new Promise<void>(resolve => { unblock = resolve })
  else boundary.silence = true
  const operation = analyzeVideoEditBeats(target)
  const rejected = expect(operation).rejects.toThrow()
  if (mode !== 'silence') {
    await vi.waitFor(() => expect(unblock).toBeDefined())
    expect(videoEditBeatTask(id)?.progress).toBe(0)
    if (mode === 'cancel') cancelVideoEditBeatAnalysis(id)
    else editVideoSequence(id, target.sequenceId, sequence => ({ ...sequence, name: '用户继续编辑' }))
    unblock!()
  }
  const current = owner.document, history = owner.past.length
  await rejected; expect(owner.document).toBe(current); expect(owner.past).toHaveLength(history); expect(videoEditBeatTask(id)).toBeUndefined(); expect(boundary.dispose).toHaveBeenCalledOnce()
})
it('正式公共算法 → marker 通用读回与保存重开；通用开关读写和权限拒绝', async () => {
  const { owner, id, target, clipId } = await setup(), app = createApplicationHarness()
  try {
    const input = { documentRef: { kind: 'video_edit.document', id }, sequenceRef: { kind: 'video_edit.sequence', id: `${id}:${target.sequenceId}` }, clipRef: { kind: 'video_edit.clip', id: `${id}:${clipId}` } }
    expect((await app.read(input.clipRef, ['video_edit.clip.snap_to_beat'])).properties).toEqual({ 'video_edit.clip.snap_to_beat': false })
    expect((await app.read({ kind: 'video_edit.marker', id: `${id}:normal` }, ['video_edit.marker.type', 'video_edit.marker.strength'])).properties).toEqual({ 'video_edit.marker.type': 'marker', 'video_edit.marker.strength': 0 })
    const output = await app.requireResult('analyze_video_edit_beats', input)
    expect(output.verified).toBe(true)
    const refs = output.markerRefs as Array<{ kind: string; id: string }>
    expect((await app.read(refs[0], ['video_edit.marker.type', 'video_edit.marker.strength'])).properties).toMatchObject({ 'video_edit.marker.type': 'beat', 'video_edit.marker.strength': expect.any(Number) })
    expect((await app.change(input.clipRef, { 'video_edit.clip.snap_to_beat': true })).ok).toBe(true)
    expect((await app.read(input.clipRef, ['video_edit.clip.snap_to_beat'])).properties).toEqual({ 'video_edit.clip.snap_to_beat': true })
    const before = owner.document
    const result = await app.call('analyze_video_edit_beats', { ...input, sequenceRef: { ...input.sequenceRef, id: 'other:sequence' } })
    expect(result.ok).toBe(false); expect(owner.document).toBe(before)
    const denied = createApplicationCapabilitySession(createApplicationCallerGrant({ callerId: 'read-only', capabilityIds: ['analyze_video_edit_beats'], permissions: ['video_edit:read'], allowWrites: false, allowDestructive: false }))
    await expect(denied.execute({ id: 'analyze_video_edit_beats', version: 1, input }, { requestId: crypto.randomUUID(), signal: new AbortController().signal })).rejects.toThrow('PERMISSION_DENIED')
    const expected = structuredClone(getActiveVideoEditSequence(owner).markers)
    const reopened = await reopenVideoEdit(id); expect(getActiveVideoEditSequence(reopened).markers).toEqual(expected)
  } finally { app.dispose() }
})
it('保存失败保留已生成标记，恢复只保存，不重分析', async () => {
  const { owner, id, target } = await setup(), app = createApplicationHarness()
  try {
    failVideoEditSaves(true)
    const result = await app.call('analyze_video_edit_beats', { documentRef: { kind: 'video_edit.document', id }, sequenceRef: { kind: 'video_edit.sequence', id: `${id}:${target.sequenceId}` }, clipRef: { kind: 'video_edit.clip', id: `${id}:${target.clipId}` } })
    expect(result.ok).toBe(false); expect(getActiveVideoEditSequence(owner).markers).toHaveLength(10)
    failVideoEditSaves(false); await app.requireResult('save_video_edit', { documentRef: { kind: 'video_edit.document', id } })
    expect(boundary.compositions).toHaveLength(1)
  } finally { app.dispose() }
})

it('原素材分析沿公共能力与实体读回，复用缓存且不写标记/历史', async () => {
  const { owner, id, target } = await setup(), app = createApplicationHarness(), history = owner.past.length
  const input = { documentRef: { kind: 'video_edit.document', id }, sequenceRef: { kind: 'video_edit.sequence', id: `${id}:${target.sequenceId}` }, mediaRef: { kind: 'video_edit.media', id: `${id}:sound` } }
  expect(readVideoEditMediaAudio(id, 'sound')).toBeUndefined()
  try {
    const result = await app.requireResult('analyze_video_edit_beats', input)
    expect(result).toMatchObject({ verified: true, markerRefs: [], audio: { bpm: expect.any(Number) } })
    expect(readVideoEditMediaAudio(id, 'sound')!.bpm).toBeCloseTo(120, 0)
    const calls = boundary.compositions.length
    await app.requireResult('analyze_video_edit_beats', input)
    expect(boundary.compositions).toHaveLength(calls)
    expect(owner.past).toHaveLength(history)
    const read = await app.requireResult('read_application_entity', { ref: input.mediaRef, propertyIds: ['video_edit.media.audio_analysis'] })
    expect(JSON.stringify(read)).toContain('bpm')
  } finally { app.dispose() }
})
it('原素材分析静音完成为空；取消与解码失败不缓存，可重试', async () => {
  const { id, target } = await setup(); const controller = new AbortController()
  controller.abort(new Error('取消'))
  await expect(analyzeVideoEditMediaAudio(id, target.sequenceId, 'sound', controller.signal)).rejects.toThrow('取消')
  expect(readVideoEditMediaAudio(id, 'sound')).toBeUndefined()
  boundary.block = async () => { throw new Error('无法解码音频') }
  await expect(analyzeVideoEditMediaAudio(id, target.sequenceId, 'sound')).rejects.toThrow('无法解码音频')
  expect(readVideoEditMediaAudio(id, 'sound')).toBeUndefined()
  boundary.block = undefined; boundary.silence = true
  expect(await analyzeVideoEditMediaAudio(id, target.sequenceId, 'sound')).toMatchObject({ bpm: 0, beats: [], onsets: [] })
})
