// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { getPlatform } from '@/platform/runtime'
import type { VideoEditAudioMapping } from '@/core/videoEdit/audioChannels'
import { appendVideoEditMedia, closeVideoEditProject, createVideoEditProject, editVideoProject, getActiveVideoEditSequence, listVideoEditInstances, undoVideoEdit } from './videoEditService'
import { makeVideoEditItemClip } from '@/core/videoEdit/projectItems'
import { appendVideoEditItems, setVideoEditClipAudioMapping, setVideoEditItemAudioChannels } from './videoEditProjectItems'
import { captureVideoEditCommandContext, executeVideoEditCommand } from './videoEditCommands'
import { separateVideoEditAudio } from './videoEditTimeline'

const files = new Map<string, string>()
beforeEach(() => {
  installHarnessNativeStorage(); files.clear()
  const platform = getPlatform()
  vi.spyOn(platform.system.dialog, 'save').mockResolvedValue('D:/fixture/channels.henji-video')
  vi.spyOn(platform.system.fs, 'writeTextFile').mockImplementation(async (path, content) => { files.set(path, content) })
  vi.spyOn(platform.system.fs, 'readTextFile').mockImplementation(async path => { const value = files.get(path); if (!value) throw new Error('missing'); return value })
  vi.spyOn(platform.system.paths, 'dirname').mockResolvedValue('D:/fixture')
  vi.spyOn(platform.media, 'allowRoot').mockResolvedValue(undefined)
})
afterEach(async () => { for (const owner of listVideoEditInstances()) await closeVideoEditProject(owner.document.id); vi.restoreAllMocks(); uninstallHarnessNativeStorage() })

const mono = (stream: number, channel = 0): VideoEditAudioMapping => ({ format: 'mono', sources: [{ stream, channel }] })
async function obsProject() {
  const owner = (await createVideoEditProject())!; const id = owner.document.id
  // OBS-style recording: two stereo streams (game and microphone).
  appendVideoEditMedia(id, { id: 'obs', name: '录屏', path: 'D:/fixture/obs.mp4', kind: 'video', width: 1920, height: 1080, durationSeconds: 4, hasAudio: true, frameRate: { numerator: 30, denominator: 1 }, frameRateMode: 'sampled-constant', audioStreams: [{ channels: 2, sampleRate: 48000 }, { channels: 2, sampleRate: 48000 }] })
  return { owner, id, item: owner.document.items[0] }
}

it('修改项目项音频声道只影响之后放入的片段（Premiere 规则），已在序列中的片段不变；恢复“使用文件”', async () => {
  const { owner, id, item } = await obsProject()
  const sequenceId = owner.activeSequenceId
  appendVideoEditItems(id, [item.id], sequenceId, { frame: 0 })
  const first = getActiveVideoEditSequence(owner).clips.map(clip => structuredClone(clip))
  expect(first.map(clip => [clip.kind, clip.track, clip.audioMapping?.format ?? 'file'])).toEqual([['video', 1, 'file'], ['audio', 0, 'file'], ['audio', 8, 'stereo']])
  // Break both stereo streams out to four mono clips.
  setVideoEditItemAudioChannels(id, [item.id], [mono(0, 0), mono(0, 1), mono(1, 0), mono(1, 1)])
  expect(getActiveVideoEditSequence(owner).clips).toEqual(first)
  appendVideoEditItems(id, [item.id], sequenceId, { frame: 200 })
  const later = getActiveVideoEditSequence(owner).clips.filter(clip => clip.start === 200)
  expect(later.map(clip => [clip.track, clip.audioMapping ?? null])).toEqual([[1, null], [0, mono(0, 0)], [8, mono(0, 1)], [9, mono(1, 0)], [10, mono(1, 1)]])
  expect(() => setVideoEditItemAudioChannels(id, [item.id], [mono(2)])).toThrow('没有声音流 3')
  setVideoEditItemAudioChannels(id, [item.id], null)
  expect(owner.document.items[0]).not.toHaveProperty('audioChannels')
  // A timeline clip's own mapping: reassign, and back to its file default.
  const sound = first[2]
  setVideoEditClipAudioMapping(id, sequenceId, [sound.id], mono(1, 1))
  expect(getActiveVideoEditSequence(owner).clips.find(clip => clip.id === sound.id)!.audioMapping).toEqual(mono(1, 1))
  setVideoEditClipAudioMapping(id, sequenceId, [sound.id], null)
  expect(getActiveVideoEditSequence(owner).clips.find(clip => clip.id === sound.id)).not.toHaveProperty('audioMapping')
  expect(() => setVideoEditClipAudioMapping(id, sequenceId, [first[0].id], mono(0))).toThrow('只有发声的音视频片段')
})

it('公共入口以通用属性读写项目项音频声道与片段声道映射，越界映射拒绝且零提交，源声音流只读', async () => {
  const { owner, id, item } = await obsProject()
  appendVideoEditItems(id, [item.id], owner.activeSequenceId, { frame: 0 })
  const sound = getActiveVideoEditSequence(owner).clips[1]
  const app = createApplicationHarness()
  const itemRef = { kind: 'video_edit.item', id: `${id}:${item.id}` }; const clipRef = { kind: 'video_edit.clip', id: `${id}:${sound.id}` }; const mediaRef = { kind: 'video_edit.media', id: `${id}:obs` }
  try {
    expect((await app.read(itemRef, ['video_edit.item.audio_channels'])).properties).toEqual({ 'video_edit.item.audio_channels': null })
    expect((await app.read(mediaRef, ['video_edit.media.audio_streams'])).properties).toEqual({ 'video_edit.media.audio_streams': [{ channels: 2, sampleRate: 48000 }, { channels: 2, sampleRate: 48000 }] })
    const merged = [{ format: 'stereo' as const, sources: [{ stream: 0, channel: 0 }, { stream: 1, channel: 1 }] }]
    const changed = await app.change(itemRef, { 'video_edit.item.audio_channels': merged })
    expect(changed, JSON.stringify(changed)).toMatchObject({ ok: true })
    expect(owner.document.items[0].audioChannels).toEqual(merged)
    const history = owner.past.length
    expect((await app.change(itemRef, { 'video_edit.item.audio_channels': [mono(4)] })).ok).toBe(false)
    expect(owner.document.items[0].audioChannels).toEqual(merged); expect(owner.past.length).toBe(history)
    expect((await app.change(itemRef, { 'video_edit.item.audio_channels': null })).ok).toBe(true)
    expect(owner.document.items[0]).not.toHaveProperty('audioChannels')
    expect((await app.change(clipRef, { 'video_edit.clip.audio_mapping': mono(1, 0) })).ok).toBe(true)
    expect((await app.read(clipRef, ['video_edit.clip.audio_mapping'])).properties).toEqual({ 'video_edit.clip.audio_mapping': mono(1, 0) })
    expect((await app.change(clipRef, { 'video_edit.clip.audio_mapping': null })).ok).toBe(true)
    expect(getActiveVideoEditSequence(owner).clips[1]).not.toHaveProperty('audioMapping')
    expect((await app.change(mediaRef, { 'video_edit.media.audio_streams': [{ channels: 1 }] })).ok).toBe(false)
  } finally { app.dispose() }
})

it('项目面板“插入”把多音轨素材连同新增音频轨放在同一撤销步；旧工程合一片段拆开时声音保留映射', async () => {
  const { owner, id, item } = await obsProject()
  const tracks = getActiveVideoEditSequence(owner).tracks.length
  await executeVideoEditCommand(captureVideoEditCommandContext(id, 'project', { itemIds: [item.id], frame: 0 }), 'insert')
  const sequence = getActiveVideoEditSequence(owner)
  expect(sequence.tracks).toHaveLength(tracks + 1)
  expect(sequence.clips.map(clip => [clip.sourceComponent, clip.track])).toEqual([['video', 1], ['audio', 0], ['audio', 8]])
  expect(owner.selectedClipIds).toHaveLength(3)
  undoVideoEdit(id)
  expect(getActiveVideoEditSequence(owner).tracks).toHaveLength(tracks); expect(getActiveVideoEditSequence(owner).clips).toEqual([])
  // A picture-and-sound clip of an older project with a mapping: separating hands the mapping to the sound.
  editVideoProject(id, document => ({ ...document, sequences: document.sequences.map(sequence => ({ ...sequence, clips: [{ ...makeVideoEditItemClip(document, item.id, sequence.id, { frame: 0 }), audioMapping: mono(1, 1) }] })) }))
  const merged = getActiveVideoEditSequence(owner).clips[0]
  expect(merged).toMatchObject({ kind: 'video', audioMapping: mono(1, 1) })
  expect(merged).not.toHaveProperty('sourceComponent')
  await separateVideoEditAudio(id, owner.activeSequenceId, [merged.id], 0)
  expect(getActiveVideoEditSequence(owner).clips.map(clip => [clip.sourceComponent, clip.audioMapping ?? null])).toEqual([['video', null], ['audio', mono(1, 1)]])
})
