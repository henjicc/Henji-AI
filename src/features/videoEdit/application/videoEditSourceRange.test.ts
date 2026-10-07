import { createVideoEditTestProject as createVideoEditProject } from './videoEditDocumentTestKit'
// @vitest-environment jsdom
import { it, expect, beforeEach, afterEach, vi } from 'vitest'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { getPlatform } from '@/platform/runtime'
import { appendVideoEditMedia, listVideoEditInstances, closeVideoEditProject, undoVideoEdit, getActiveVideoEditSequence, editVideoProject } from './videoEditService'
import { updateVideoEditSource, registerVideoEditSourcePresenter } from './videoEditSource'
import { captureVideoEditSourceRange, placeVideoEditSourceRange } from './videoEditSourceRange'
beforeEach(() => {
  installHarnessNativeStorage()
  vi.spyOn(getPlatform().system.dialog, 'save').mockResolvedValue('D:/source-range.henji-video')
  vi.spyOn(getPlatform().system.fs, 'writeTextFile').mockResolvedValue(undefined)
})
afterEach(async () => { for (const owner of listVideoEditInstances()) await closeVideoEditProject(owner.document.id); vi.restoreAllMocks(); uninstallHarnessNativeStorage() })
async function fixture() {
  const owner = (await createVideoEditProject())!; const id = owner.document.id
  appendVideoEditMedia(id, { id: 'source', name: '原视频', path: 'D:/original.mp4', kind: 'video', width: 3840, height: 2160, durationSeconds: 3600, hasAudio: true, sourceRevision: 'first' })
  const off = registerVideoEditSourcePresenter(id, async request => ({ timeUs: request.timeUs, presentedTimeUs: request.timeUs, playing: request.playing, volume: request.volume }))
  await updateVideoEditSource(id, { itemId: owner.document.items[0].id, inUs: 1000000, outUs: 2000000 })
  return { owner, id, off }
}
it('只画面/只声音/链接音画从同一源范围落入真实轨道，原路径和一次撤销一致', async () => {
  const { owner, id, off } = await fixture()
  try {
    for (const component of ['video', 'audio', 'linked'] as const) {
      const input = captureVideoEditSourceRange(id, component); const history = owner.past.length
      const ids = placeVideoEditSourceRange(id, input, owner.activeSequenceId, { frame: 53940, track: component === 'audio' ? 0 : 1 })
      const sequence = getActiveVideoEditSequence(owner); const clips = sequence.clips.filter(clip => ids.includes(clip.id))
      expect(clips).toHaveLength(component === 'linked' ? 2 : 1); expect(clips.every(clip => clip.start === 53940 && clip.duration === 30 && clip.sourceInUs === 1000000)).toBe(true)
      expect(clips.map(clip => clip.kind)).toEqual(component === 'linked' ? ['video', 'audio'] : [component])
      if (component === 'linked') expect(clips[0].linkId).toBe(clips[1].linkId)
      expect(owner.past).toHaveLength(history + 1); expect(owner.document.media[0].path).toBe('D:/original.mp4')
      undoVideoEdit(id); expect(getActiveVideoEditSequence(owner).clips).toEqual([])
    }
  } finally { off() }
})
it('落点类型、音轨、短范围与重新链接拒绝，不留下半段链接或历史', async () => {
  const { owner, id, off } = await fixture()
  try {
    const input = captureVideoEditSourceRange(id, 'linked'); const history = owner.past.length
    expect(() => placeVideoEditSourceRange(id, input, owner.activeSequenceId, { frame: 0, track: 0 })).toThrow('轨道')
    expect(owner.past).toHaveLength(history); expect(getActiveVideoEditSequence(owner).clips).toHaveLength(0)
    expect(() => placeVideoEditSourceRange(id, { ...input, outUs: input.inUs + 1 }, owner.activeSequenceId, { frame: 0, track: 1 })).toThrow('短于')
    editVideoProject(id, document => ({ ...document, media: document.media.map(media => ({ ...media, sourceRevision: 'relinked' })) }))
    expect(() => placeVideoEditSourceRange(id, input, owner.activeSequenceId, { frame: 0, track: 1 })).toThrow('源素材已改变')
    editVideoProject(id, document => ({ ...document, media: document.media.map(media => ({ ...media, hasAudio: false })) }))
    expect(() => captureVideoEditSourceRange(id, 'linked')).toThrow()
    expect(getActiveVideoEditSequence(owner).clips).toHaveLength(0)
  } finally { off() }
})
it('节目监视器拖放区：源范围按插入、替换、添加到末尾放置，一次撤销', async () => {
  const { owner, id, off } = await fixture()
  try {
    const input = captureVideoEditSourceRange(id, 'linked')
    placeVideoEditSourceRange(id, input, owner.activeSequenceId, { frame: 0, mode: 'overwrite' })
    placeVideoEditSourceRange(id, input, owner.activeSequenceId, { frame: 10, mode: 'insert' })
    let clips = getActiveVideoEditSequence(owner).clips
    // 原片段在 10 处被切开，后半段后移 30 帧
    expect(clips.map(clip => [clip.start, clip.duration]).sort((a, b) => a[0] - b[0] || a[1] - b[1])).toEqual([[0, 10], [0, 10], [10, 30], [10, 30], [40, 20], [40, 20]])
    expect(Math.max(...clips.map(clip => clip.start + clip.duration))).toBe(60)
    const appended = placeVideoEditSourceRange(id, input, owner.activeSequenceId, { frame: 0, mode: 'end' })
    expect(getActiveVideoEditSequence(owner).clips.filter(clip => appended.includes(clip.id)).every(clip => clip.start === 60)).toBe(true)
    const history = owner.past.length
    const replaced = placeVideoEditSourceRange(id, input, owner.activeSequenceId, { frame: 15, mode: 'replace' })
    clips = getActiveVideoEditSequence(owner).clips.filter(clip => replaced.includes(clip.id))
    expect(clips.map(clip => [clip.kind, clip.start, clip.duration])).toEqual([['video', 10, 30], ['audio', 10, 30]])
    expect(owner.past).toHaveLength(history + 1)
  } finally { off() }
})
