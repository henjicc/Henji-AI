// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { getPlatform } from '@/platform/runtime'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { videoEditClipSourceRange } from '@/core/videoEdit/clipSpeed'
import { appendVideoEditClip, appendVideoEditMedia, closeVideoEditProject, createVideoEditProject, getActiveVideoEditSequence, listVideoEditInstances } from './videoEditService'

// 任务 4.13 片段速度：助手经通用实体属性读写速度、倒放与保持音调，与“速度/持续时间”同一领域入口。
vi.mock('../engine/videoEditRenderSession', () => ({ VideoEditRenderSession: class {
  setTracks() {}
  async updateDocument() {}
  async present() { return { presented: true, bitmap: { close() {} } } }
  async dispose() {}
} }))
beforeEach(() => {
  installHarnessNativeStorage()
  vi.spyOn(getPlatform().system.dialog, 'save').mockResolvedValue('D:/speed.henji-video')
  vi.spyOn(getPlatform().system.fs, 'writeTextFile').mockResolvedValue(undefined)
})
afterEach(async () => {
  for (const owner of listVideoEditInstances()) await closeVideoEditProject(owner.document.id)
  vi.restoreAllMocks(); uninstallHarnessNativeStorage()
})

it('助手写 speed_percent：时长按速度换算并回读；倒放与保持音调为开关；越界与文字片段给出原因', async () => {
  const owner = (await createVideoEditProject())!; const id = owner.document.id
  appendVideoEditMedia(id, { id: 'sound', name: '对白', path: 'D:/dialog.wav', kind: 'audio', width: 0, height: 0, durationSeconds: 4, hasAudio: true })
  const audioTrack = getActiveVideoEditSequence(owner).tracks.find(track => track.kind === 'audio')!.index
  const videoTrack = getActiveVideoEditSequence(owner).tracks.find(track => track.kind === 'video')!.index
  appendVideoEditClip(id, 'sound', { frame: 0, track: audioTrack })
  appendVideoEditClip(id, undefined, { frame: 0, track: videoTrack })
  const sequence = getActiveVideoEditSequence(owner)
  const sound = sequence.clips.find(clip => clip.kind === 'audio')!; const title = sequence.clips.find(clip => clip.kind !== 'audio')!
  const app = createApplicationHarness()
  try {
    const ref = { kind: 'video_edit.clip', id: `${id}:${sound.id}` }
    expect((await app.read(ref, ['video_edit.clip.speed_percent', 'video_edit.clip.reverse', 'video_edit.clip.preserve_pitch'])).properties).toEqual({ 'video_edit.clip.speed_percent': 100, 'video_edit.clip.reverse': false, 'video_edit.clip.preserve_pitch': false })
    const changed = await app.change(ref, { 'video_edit.clip.speed_percent': 200, 'video_edit.clip.reverse': true, 'video_edit.clip.preserve_pitch': true })
    expect(changed, JSON.stringify(changed)).toMatchObject({ ok: true })
    const clip = getActiveVideoEditSequence(owner).clips.find(value => value.id === sound.id)!
    expect(clip).toMatchObject({ duration: sound.duration / 2, speed: { numerator: 2, denominator: 1 }, reverse: true, preservePitch: true })
    expect(videoEditClipSourceRange(clip, 30)).toEqual({ from: 0, to: 4 })
    expect((await app.read(ref, ['video_edit.clip.speed_percent', 'video_edit.clip.duration'])).properties).toEqual({ 'video_edit.clip.speed_percent': 200, 'video_edit.clip.duration': sound.duration / 2 })
    const tooFast = await app.change(ref, { 'video_edit.clip.speed_percent': 20000 })
    expect(tooFast.ok).toBe(false); expect(JSON.stringify(tooFast)).toContain('1 到 10000')
    const text = await app.change({ kind: 'video_edit.clip', id: `${id}:${title.id}` }, { 'video_edit.clip.speed_percent': 50 })
    expect(text.ok).toBe(false); expect(JSON.stringify(text)).toContain('只有视频、音频与代码素材片段')
    expect(getActiveVideoEditSequence(owner).clips.find(value => value.id === title.id)!.speed).toBeUndefined()
  } finally { app.dispose() }
})
