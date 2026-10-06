// @vitest-environment jsdom
import path from 'node:path'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { VideoEditComposition } from '@/core/videoEdit/document'
import { videoEditDuckingSettingsSchema } from '@/core/videoEdit/audioDucking'
import { isVideoEditDuckingKeyframe } from '@/core/videoEdit/keyframes'
import { getPlatform } from '@/platform/runtime'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { createApplicationCallerGrant } from '@/core/application-control/callerContext'
import { createApplicationCapabilitySession } from '@/features/application-control/applicationCapabilityService'
import { generateVideoEditAudioDucking, setVideoEditAudioRoles } from './videoEditAudioDucking'
import { appendVideoEditClip, appendVideoEditMedia, closeVideoEditProject, createVideoEditProject, editVideoSequence, getActiveVideoEditSequence, listVideoEditInstances, setVideoEditTimelineView, subscribeVideoEditView, undoVideoEdit, videoEditViewRevision } from './videoEditService'
import { updateVideoEditClipKeyframes } from './videoEditClipProperties'
import { VideoEditBasicSoundPanel } from '../panels/VideoEditBasicSoundPanel'
import { useSyncExternalStore } from 'react'
import type { VideoEditInstance } from './videoEditService'
import { failVideoEditSaves, reopenVideoEdit } from './videoEditDocumentTestKit'

const boundary = vi.hoisted(() => ({ compositions: [] as VideoEditComposition[], disposed: vi.fn() }))
vi.mock('../engine/videoEditRenderSession', () => ({ VideoEditRenderSession: class {
  constructor(composition: VideoEditComposition) { boundary.compositions.push(composition) }
  async dispose() { boundary.disposed() }
  async mixAudio(_at: number, duration: number) { return { numberOfChannels: 2, getChannelData: () => new Float32Array(Math.round(duration * 48000)).fill(.1) } }
} }))
const settings = videoEditDuckingSettingsSchema.parse({})
beforeEach(() => {
  installHarnessNativeStorage(); boundary.compositions = []; boundary.disposed.mockClear()
  const api = getPlatform().audioEdit.loudness
  vi.spyOn(api, 'start').mockResolvedValue(undefined); vi.spyOn(api, 'append').mockResolvedValue(undefined)
  vi.spyOn(api, 'close').mockResolvedValue(undefined); vi.spyOn(api, 'detectActivity').mockResolvedValue([{ startSeconds: 1, endSeconds: 2 }])
})
afterEach(async () => { cleanup(); failVideoEditSaves(false); for (const owner of listVideoEditInstances()) await closeVideoEditProject(owner.document.id); vi.restoreAllMocks(); uninstallHarnessNativeStorage() })
async function project() {
  const owner = await createVideoEditProject(); const id = owner.document.id
  appendVideoEditMedia(id, { id: 'sound', name: '声音', path: path.resolve(path.sep, 'fixture', 'dialog.wav'), kind: 'audio', width: 0, height: 0, durationSeconds: 12, hasAudio: true })
  const track = getActiveVideoEditSequence(owner).tracks.find(track => track.kind === 'audio')!.index
  appendVideoEditClip(id, 'sound', { frame: 0, track }); appendVideoEditClip(id, 'sound', { frame: 360, track }); appendVideoEditClip(id, 'sound', { frame: 720, track })
  const clips = getActiveVideoEditSequence(owner).clips
  const target = { projectId: id, sequenceId: owner.activeSequenceId, clipIds: clips.slice(0, 2).map(clip => clip.id) }
  // Put dialogue on a distinct audio track, overlap both music clips, preserve source in/speed/fades.
  editVideoSequence(id, target.sequenceId, sequence => ({ ...sequence, tracks: [...sequence.tracks, { id: 'voice-track', name: '对话', index: 2, kind: 'audio', enabled: true, locked: false, solo: false, muted: false }], clips: sequence.clips.map((clip, index) => index < 2 ? { ...clip, start: index * 180, duration: 180, audioRole: 'music' as const } : { ...clip, start: 0, duration: 360, track: 2, audioRole: 'dialogue' as const }) }))
  return { owner, target, id, musicIds: target.clipIds, dialogueId: clips[2].id }
}
function Panel({ owner, onError }: { owner: VideoEditInstance; onError: (error: unknown) => void }): React.ReactElement {
  useSyncExternalStore(subscribeVideoEditView, videoEditViewRevision)
  return <VideoEditBasicSoundPanel instance={owner} onError={onError} />
}
it('面板多选音乐一键生成及重生成各一步撤销；手调点保留，旧回避点被替换', async () => {
  const { owner, target, id } = await project()
  setVideoEditTimelineView(id, { selectedClipIds: target.clipIds }, target.clipIds[0])
  const errors = vi.fn(); const before = owner.past.length
  const view = render(<Panel owner={owner} onError={errors} />)
  await act(async () => fireEvent.click(view.getByRole('button', { name: '生成回避' })))
  expect(errors).not.toHaveBeenCalled(); expect(owner.past).toHaveLength(before + 1)
  const first = getActiveVideoEditSequence(owner).clips[0]; expect(first.curves?.volume?.every(point => point.source === 'ducking')).toBe(true)
  const oldTime = first.curves!.volume![1].time
  act(() => updateVideoEditClipKeyframes(id, target.sequenceId, first.id, 'volume', first.curves!.volume!.map(point => point.time === oldTime ? { ...point, value: .5 } : point)))
  const manual = getActiveVideoEditSequence(owner).clips[0].curves!.volume!.find(point => point.time === oldTime)!
  expect(manual.source).toBeUndefined()
  vi.mocked(getPlatform().audioEdit.loudness.detectActivity).mockResolvedValue([{ startSeconds: 3, endSeconds: 4 }])
  const afterManual = owner.past.length
  await act(async () => fireEvent.click(view.getByRole('button', { name: '重新生成回避' })))
  expect(owner.past).toHaveLength(afterManual + 1)
  expect(getActiveVideoEditSequence(owner).clips[0].curves!.volume!).toContainEqual(manual)
  act(() => undoVideoEdit(id)); expect(getActiveVideoEditSequence(owner).clips[0].curves!.volume!).toContainEqual(manual)
  expect(boundary.disposed).toHaveBeenCalledTimes(2)
})
it('声音角色可批量一步撤销；正式 describe/change/read、null 恢复、算法保存回读及权限拒绝', async () => {
  const { owner, target, id, dialogueId } = await project(); const app = createApplicationHarness()
  const ref = { kind: 'video_edit.clip', id: `${id}:${dialogueId}` }
  try {
    const before = owner.past.length
    setVideoEditAudioRoles(target, 'ambience'); expect(owner.past).toHaveLength(before + 1); undoVideoEdit(id)
    const described = await app.requireResult('describe_application_entities', { entityTypes: ['video_edit.clip'], refs: [ref] })
    expect(JSON.stringify(described)).toContain('video_edit.clip.audio_role')
    expect((await app.change(ref, { 'video_edit.clip.audio_role': 'sound_effect' })).ok).toBe(true)
    expect((await app.read(ref, ['video_edit.clip.audio_role'])).properties).toEqual({ 'video_edit.clip.audio_role': 'sound_effect' })
    expect((await app.change(ref, { 'video_edit.clip.audio_role': null })).ok).toBe(true)
    expect((await app.read(ref, ['video_edit.clip.audio_role'])).properties).toEqual({ 'video_edit.clip.audio_role': null })
    expect((await app.change(ref, { 'video_edit.clip.audio_role': 'dialogue' })).ok).toBe(true)
    const input = { documentRef: { kind: 'video_edit.document', id }, musicClipRefs: target.clipIds.map(clipId => ({ kind: 'video_edit.clip', id: `${id}:${clipId}` })), settings }
    const history = owner.past.length
    const result = await app.requireResult('generate_video_edit_audio_ducking', input); expect(result.verified).toBe(true); expect(owner.past).toHaveLength(history + 1)
    expect(JSON.stringify((await app.read(input.musicClipRefs[0], ['video_edit.clip.volume.keyframes'])).properties)).toContain('ducking')
    undoVideoEdit(id); expect(getActiveVideoEditSequence(owner).clips[0].curves?.volume).toBeUndefined()
    const denied = createApplicationCapabilitySession(createApplicationCallerGrant({ callerId: 'read-only', capabilityIds: ['generate_video_edit_audio_ducking'], permissions: ['video_edit:read'], allowWrites: false, allowDestructive: false }))
    await expect(denied.execute({ id: 'generate_video_edit_audio_ducking', version: 1, input }, { requestId: crypto.randomUUID(), signal: new AbortController().signal })).rejects.toThrow('PERMISSION_DENIED')
    expect((await app.call('generate_video_edit_audio_ducking', { ...input, musicClipRefs: [{ kind: 'video_edit.clip', id: `foreign:${target.clipIds[0]}` }] })).ok).toBe(false)
  } finally { app.dispose() }
})
it('锁轨/分析失败/迟到编辑/取消均不产生部分闪避；释放会话', async () => {
  const { owner, target, id } = await project(); const history = owner.past.length
  vi.mocked(getPlatform().audioEdit.loudness.detectActivity).mockRejectedValueOnce(new Error('analysis failed'))
  await expect(generateVideoEditAudioDucking(target, settings)).rejects.toThrow('analysis failed'); expect(owner.past).toHaveLength(history)
  vi.mocked(getPlatform().audioEdit.loudness.detectActivity).mockImplementationOnce(async () => { editVideoSequence(id, target.sequenceId, sequence => ({ ...sequence, name: '修改' })); return [] })
  await expect(generateVideoEditAudioDucking(target, settings)).rejects.toThrow('已有修改')
  expect(getActiveVideoEditSequence(owner).clips.every(clip => !clip.curves?.volume)).toBe(true)
  const controller = new AbortController()
  vi.mocked(getPlatform().audioEdit.loudness.detectActivity).mockImplementationOnce(async () => { controller.abort(); return [] })
  await expect(generateVideoEditAudioDucking(target, settings, controller.signal)).rejects.toThrow()
  editVideoSequence(id, target.sequenceId, sequence => ({ ...sequence, tracks: sequence.tracks.map(track => ({ ...track, locked: true })) }))
  await expect(generateVideoEditAudioDucking(target, settings)).rejects.toThrow('锁定')
  expect(getPlatform().audioEdit.loudness.close).toHaveBeenCalled(); expect(boundary.disposed).toHaveBeenCalledTimes(3)
})
it('静音或无重叠目标清除旧生成点并保留手动点；目标角色切换与混音源映射复用', async () => {
  const { owner, target, id } = await project()
  await generateVideoEditAudioDucking(target, settings)
  expect(boundary.compositions[0].clips).toHaveLength(1); expect(boundary.compositions[0].clips[0].track).toBe(2)
  editVideoSequence(id, target.sequenceId, sequence => ({ ...sequence, tracks: sequence.tracks.map(track => track.index === 2 ? { ...track, muted: true } : track) }))
  const before = owner.past.length
  await generateVideoEditAudioDucking(target, settings); expect(owner.past).toHaveLength(before + 1)
  expect(getActiveVideoEditSequence(owner).clips[0].curves?.volume).toEqual([])
  expect(getPlatform().audioEdit.loudness.detectActivity).toHaveBeenCalledTimes(1)
  const voice = getActiveVideoEditSequence(owner).clips[2]
  editVideoSequence(id, target.sequenceId, sequence => ({ ...sequence, tracks: sequence.tracks.map(track => track.index === 2 ? { ...track, muted: false } : track) }))
  setVideoEditAudioRoles({ ...target, clipIds: [voice.id] }, 'sound_effect')
  await generateVideoEditAudioDucking(target, settings); expect(getPlatform().audioEdit.loudness.detectActivity).toHaveBeenCalledTimes(1)
  await generateVideoEditAudioDucking(target, { ...settings, targetRole: 'sound_effect', sensitivity: 80 })
  expect(getPlatform().audioEdit.loudness.detectActivity).toHaveBeenLastCalledWith(expect.any(String), 80)
  editVideoSequence(id, target.sequenceId, sequence => ({ ...sequence, clips: sequence.clips.map(clip => clip.id === voice.id ? { ...clip, start: 1000 } : clip) }))
  await generateVideoEditAudioDucking(target, { ...settings, targetRole: 'sound_effect' })
  expect(getPlatform().audioEdit.loudness.detectActivity).toHaveBeenCalledTimes(2)
})
it('助手落盘失败保留一次内存写入，重试保存后角色/来源标记可重开回读', async () => {
  const { owner, target, id } = await project(); const app = createApplicationHarness()
  try {
    const input = { documentRef: { kind: 'video_edit.document', id }, musicClipRefs: target.clipIds.map(clipId => ({ kind: 'video_edit.clip', id: `${id}:${clipId}` })), settings }
    const history = owner.past.length
    failVideoEditSaves(true)
    const result = await app.call('generate_video_edit_audio_ducking', input)
    expect(result.ok).toBe(false); expect(JSON.stringify(result)).toContain('保存')
    expect(owner.past).toHaveLength(history + 1); expect(getActiveVideoEditSequence(owner).clips[0].curves?.volume?.some(isVideoEditDuckingKeyframe)).toBe(true)
    failVideoEditSaves(false)
    await app.requireResult('save_video_edit', { documentRef: input.documentRef })
    expect(getPlatform().audioEdit.loudness.detectActivity).toHaveBeenCalledTimes(1)
    const reopened = await reopenVideoEdit(id)
    expect(getActiveVideoEditSequence(reopened).clips[0].audioRole).toBe('music')
    expect(getActiveVideoEditSequence(reopened).clips[0].curves?.volume?.every(isVideoEditDuckingKeyframe)).toBe(true)
  } finally { app.dispose() }
})
it('助手编辑回避点的整条音量曲线后归用户，重新生成保留编辑点', async () => {
  const { owner, target, id } = await project(); const app = createApplicationHarness()
  try {
    await generateVideoEditAudioDucking(target, settings)
    const first = getActiveVideoEditSequence(owner).clips[0]
    const changed = first.curves!.volume!.map((point, index) => index === 1 ? { ...point, value: .6 } : point)
    const result = await app.change({ kind: 'video_edit.clip', id: `${id}:${first.id}` }, { 'video_edit.clip.volume.keyframes': changed })
    expect(result.ok).toBe(true)
    expect(getActiveVideoEditSequence(owner).clips[0].curves!.volume![1]).toEqual(changed[1])
    expect(isVideoEditDuckingKeyframe(changed[1])).toBe(false)
    vi.mocked(getPlatform().audioEdit.loudness.detectActivity).mockResolvedValue([])
    await generateVideoEditAudioDucking(target, settings)
    expect(getActiveVideoEditSequence(owner).clips[0].curves!.volume!).toEqual([changed[1]])
  } finally { app.dispose() }
})
