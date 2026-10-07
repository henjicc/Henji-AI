import { createVideoEditTestProject as createVideoEditProject } from './videoEditDocumentTestKit'
// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { createApplicationCallerGrant } from '@/core/application-control/callerContext'
import { createApplicationCapabilitySession } from '@/features/application-control/applicationCapabilityService'
import { makeVideoEditItemClip } from '@/core/videoEdit/projectItems'
import { videoEditClipSourceRange } from '@/core/videoEdit/clipSpeed'
import { VIDEO_EDIT_MAX_SEQUENCE_SECONDS, videoEditFps } from '@/core/videoEdit/time'
import { closeAllVideoEdits, savedVideoEdit } from './videoEditDocumentTestKit'
import { editVideoProject, getActiveVideoEditSequence, undoVideoEdit, type VideoEditInstance } from './videoEditService'

vi.mock('../engine/videoEditRenderSession', () => ({ VideoEditRenderSession: class {
  setTracks() {}
  async updateDocument() {}
  async present() { return { presented: true, bitmap: { close() {} } } }
  async dispose() {}
} }))
beforeEach(installHarnessNativeStorage)
afterEach(async () => { await closeAllVideoEdits(); vi.restoreAllMocks(); uninstallHarnessNativeStorage() })

async function fixture() {
  const owner = await createVideoEditProject(); const id = owner.document.id
  editVideoProject(id, document => {
    document.media.push({ id: 'media', name: '对白镜头', path: '/fixture/dialog.mp4', kind: 'video', width: 64, height: 64, durationSeconds: 20, hasAudio: true })
    document.items.push({ id: 'item', name: '对白镜头', kind: 'video', mediaId: 'media' })
    const sequence = document.sequences[0]
    const video = sequence.tracks.find(track => track.kind === 'video')!.index
    const audio = sequence.tracks.find(track => track.kind === 'audio')!.index
    sequence.tracks.push({ ...sequence.tracks.find(track => track.kind === 'video')!, id: 'other-track', index: 2, syncLocked: true })
    const base = makeVideoEditItemClip(document, 'item', sequence.id, { frame: 0, track: video, duration: 60 })
    sequence.clips = [
      { ...base, id: 'a', linkId: 'pair-a', sourceComponent: 'video' },
      { ...base, id: 'a-audio', kind: 'audio', track: audio, linkId: 'pair-a', sourceComponent: 'audio' },
      { ...base, id: 'b', start: 60, linkId: 'pair-b', sourceComponent: 'video' },
      { ...base, id: 'b-audio', start: 60, kind: 'audio', track: audio, linkId: 'pair-b', sourceComponent: 'audio' },
      { ...base, id: 'c', start: 150 }, { ...base, id: 'other', track: 2, start: 150 },
    ]
    sequence.markers = [{ id: 'clip-marker', clipId: 'c', frame: 160, name: '后续片段锚点' }, { id: 'sequence-marker', frame: 160, name: '序列锚点' }]
    sequence.captions = [{ id: 'caption', clipId: 'c', start: 160, duration: 15, text: '对白' }]
    return document
  })
  return owner
}
const input = (owner: VideoEditInstance, extra: Record<string, unknown> = {}) => ({ documentRef: { kind: 'video_edit.document', id: owner.document.id }, clipRefs: [{ kind: 'video_edit.clip', id: `${owner.document.id}:a` }], speedPercent: 50, ...extra })

it('公共原子波纹变速：音画一起变、后续同轨片段与锚定内容跟随，保存回读且仅一步撤销', async () => {
  const owner = await fixture(); const app = createApplicationHarness()
  try {
    const before = structuredClone(owner.document.sequences[0]); const history = owner.past.length
    const result = await app.call('ripple_video_edit_clip_speed', input(owner, { reverse: true, preservePitch: true }))
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true, data: { verification: { verified: true } } })
    const after = owner.document.sequences[0]; const clip = (id: string) => after.clips.find(value => value.id === id)!
    expect(clip('a')).toMatchObject({ duration: 120, speed: { numerator: 1, denominator: 2 }, reverse: true, preservePitch: true })
    expect(clip('a-audio')).toMatchObject({ duration: 120, reverse: true, preservePitch: true })
    expect(videoEditClipSourceRange(clip('a'), 30)).toEqual({ from: 0, to: 2 })
    expect(clip('b').start).toBe(120); expect(clip('b-audio').start).toBe(120); expect(clip('c').start).toBe(210)
    expect(clip('other').start).toBe(150)
    expect(after.markers).toMatchObject([{ frame: 220 }, { frame: 160 }]); expect(after.captions?.[0].start).toBe(220)
    expect(owner.past.length).toBe(history + 1)
    expect(savedVideoEdit(owner).sequences[0]).toEqual(after)
    expect((await app.read({ kind: 'video_edit.clip', id: `${owner.document.id}:a` }, ['video_edit.clip.speed_percent'])).properties).toEqual({ 'video_edit.clip.speed_percent': 50 })
    await app.requireResult('undo_video_edit', { documentRef: input(owner).documentRef })
    expect(owner.document.sequences[0]).toEqual(before)
  } finally { app.dispose() }
})

it('持续时间保持源内容；多目标的小数变速按正式算法舍入并累积波纹，linked=false 不展开音画', async () => {
  const owner = await fixture(); const app = createApplicationHarness()
  try {
    const byDuration = input(owner, { speedPercent: undefined, durationFrames: 90, linked: false })
    expect(await app.call('ripple_video_edit_clip_speed', byDuration)).toMatchObject({ ok: true })
    const clip = getActiveVideoEditSequence(owner).clips.find(value => value.id === 'a')!
    expect(clip.duration).toBe(90); expect(videoEditClipSourceRange(clip, 30)).toEqual({ from: 0, to: 2 })
    expect(getActiveVideoEditSequence(owner).clips.find(value => value.id === 'a-audio')!.duration).toBe(60)
    undoVideoEdit(owner.document.id)
    const result = await app.call('ripple_video_edit_clip_speed', input(owner, { speedPercent: 150.5, linked: false,
      clipRefs: ['a', 'b'].map(id => ({ kind: 'video_edit.clip', id: `${owner.document.id}:${id}` })),
    }))
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true })
    const after = getActiveVideoEditSequence(owner)
    expect(after.clips.find(value => value.id === 'a')!.duration).toBe(40)
    expect(after.clips.find(value => value.id === 'b')).toMatchObject({ start: 40, duration: 40 })
    expect(after.clips.find(value => value.id === 'c')!.start).toBe(110)
    expect(after.clips.find(value => value.id === 'b-audio')!.start).toBe(60)
  } finally { app.dispose() }
})

it('锁定链接音轨、越界、混合文档引用、冲突基线和超长波纹均在整组发布前拒绝', async () => {
  const owner = await fixture(); const app = createApplicationHarness()
  try {
    const denied = createApplicationCapabilitySession(createApplicationCallerGrant({ callerId: 'reader', capabilityIds: ['ripple_video_edit_clip_speed'], permissions: ['video_edit:read'], allowWrites: false, allowDestructive: false }))
    await expect(denied.execute({ id: 'ripple_video_edit_clip_speed', version: 1, input: input(owner) }, { requestId: 'denied', signal: new AbortController().signal })).rejects.toThrow('PERMISSION_DENIED')
    editVideoProject(owner.document.id, document => { document.sequences[0].tracks.find(track => track.kind === 'audio')!.locked = true; return document })
    const before = owner.document; const past = owner.past.length
    const locked = await app.call('ripple_video_edit_clip_speed', input(owner))
    expect(locked).toMatchObject({ ok: false }); expect(JSON.stringify(locked)).toContain('锁定')
    expect(owner.document).toBe(before); expect(owner.past).toHaveLength(past)
    expect(await app.call('ripple_video_edit_clip_speed', input(owner, { speedPercent: 0 }))).toMatchObject({ ok: false })
    expect(await app.call('ripple_video_edit_clip_speed', input(owner, { clipRefs: [{ kind: 'video_edit.clip', id: 'other:a' }] }))).toMatchObject({ ok: false })
    const baseline = await app.read(input(owner).documentRef)
    editVideoProject(owner.document.id, document => { document.sequences[0].tracks.find(track => track.kind === 'audio')!.locked = false; document.sequences[0].clips.find(clip => clip.id === 'c')!.start = Math.floor(videoEditFps(document.sequences[0].frameRate) * VIDEO_EDIT_MAX_SEQUENCE_SECONDS) - 60; return document })
    expect(await app.call('ripple_video_edit_clip_speed', input(owner), baseline.revisions as Record<string, number>)).toMatchObject({ ok: false })
    const longBefore = owner.document; const longPast = owner.past.length
    const overflow = await app.call('ripple_video_edit_clip_speed', input(owner))
    expect(overflow).toMatchObject({ ok: false }); expect(JSON.stringify(overflow)).toContain('24 小时')
    expect(owner.document).toBe(longBefore); expect(owner.past).toHaveLength(longPast)
  } finally { app.dispose() }
})

it('波纹移动超过128个片段时分批记录真实影响，公共调用仍成功且每个后续片段只移动一次', async () => {
  const owner = await fixture(); const app = createApplicationHarness()
  try {
    editVideoProject(owner.document.id, document => {
      const sequence = document.sequences[0]; const base = sequence.clips.find(clip => clip.id === 'c')!
      sequence.clips.push(...Array.from({ length: 130 }, (_, index) => ({ ...base, id: `following-${index}`, start: 300 + index * 90 })))
      return document
    })
    const result = await app.call('ripple_video_edit_clip_speed', input(owner, { linked: false }))
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true, data: { verification: { verified: true } } })
    if (!result.ok) throw new Error(result.error.message)
    expect((result.data as { changedClipRefs: unknown[] }).changedClipRefs).toHaveLength(133)
    expect(owner.document.sequences[0].clips.find(clip => clip.id === 'following-129')!.start).toBe(300 + 129 * 90 + 60)
  } finally { app.dispose() }
})
