// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import path from 'node:path'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { harnessDocumentStore, installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { getPlatform } from '@/platform/runtime'
import { makeVideoEditItemClip } from '@/core/videoEdit/projectItems'
import { createVideoEditTestProject, closeAllVideoEdits, reopenVideoEdit } from './videoEditDocumentTestKit'
import { editVideoProject, undoVideoEdit, videoEditDocumentOperations, closeVideoEditProject } from './videoEditService'
import { getVideoEditAudioLinkNotices, refreshVideoEditAudioDocumentClips, sendVideoEditClipToAudioEdit, startVideoEditAudioDocumentLinks } from './videoEditAudioLinks'
import { videoEditCaptionsFromAudioEdit } from '@/core/videoEdit/audioEditLink'
import { buildProjectAudioEditSubtitleCues } from '@/core/audioEdit/subtitles'
import { videoEditSubtitleStyleSchema } from '@/core/videoEdit/subtitleStyle'
import { applyVideoEditTimelineEdit } from '@/core/videoEdit/timelineEdits'
import { editAudioEditProject, flushAudioEditProject, loadAudioEditProject, resetAudioEditProjectInstancesForTests, undoAudioEditProject } from '@/features/audioEdit/application/audioEditProjectInstances'
import { insertAudioEditFile } from '@/features/audioEdit/application/audioEditSpliceService'
import { editedDurationFrames, buildProjectAudioEditTimeline } from '@/core/audioEdit/timeline'
import { audioEditProjectFromDocument } from '@/core/audioEdit/documentContent'
import { videoEditFps } from '@/core/videoEdit/time'
import { updateVideoEditAudioLinks } from '@/core/videoEdit/audioLink'

beforeEach(() => {
  installHarnessNativeStorage()
  vi.spyOn(getPlatform().audioEdit, 'probeSource').mockResolvedValue({ mediaType: 'audio', sourcePath: path.resolve(path.sep, 'source.wav'), audioPath: path.resolve(path.sep, 'source.wav'), sampleRate: 48000, channels: 1, durationFrames: 480000 })
  vi.spyOn(getPlatform().audioEdit, 'render').mockImplementation(async ({ projectId }) => {
    const stored = harnessDocumentStore().stored(projectId)!
    const project = audioEditProjectFromDocument(stored.meta, stored.content).project
    return { audioPath: path.resolve(path.sep, `render-${stored.meta.revision}.wav`), durationFrames: editedDurationFrames(buildProjectAudioEditTimeline(project)), revision: stored.meta.revision, sampleRate: 48000, channels: 1 }
  })
  vi.spyOn(videoEditDocumentOperations(), 'importFile').mockImplementation(async input => ({ path: input.sourcePath, copied: true } as Awaited<ReturnType<ReturnType<typeof videoEditDocumentOperations>['importFile']>>))
})
afterEach(async () => { await closeAllVideoEdits(); await resetAudioEditProjectInstancesForTests(); vi.restoreAllMocks(); uninstallHarnessNativeStorage() })

async function fixture(kind: 'audio' | 'video' = 'audio') {
  const owner = (await createVideoEditTestProject())!, sequence = owner.document.sequences[0]
  editVideoProject(owner.document.id, document => ({ ...document, media: [{ id: 'm', name: '声音', kind, path: path.resolve(path.sep, 'source.wav'), durationSeconds: 10, hasAudio: true, width: kind === 'video' ? 1920 : 0, height: kind === 'video' ? 1080 : 0 }], items: [{ id: 'i', name: '声音', kind, mediaId: 'm' }] }))
  const clip = makeVideoEditItemClip(owner.document, 'i', sequence.id, { frame: 20, duration: 120, track: sequence.tracks.find(t => t.kind === kind)!.index })
  editVideoProject(owner.document.id, document => ({ ...document, sequences: document.sequences.map(s => ({ ...s, clips: [{ ...clip, sourceInUs: 1000000 }, { ...clip, id: 'following', start: 300 }] })) }))
  return { owner, clipId: clip.id }
}
it('public send action binds source range, reuses a link, and one undo restores video/audio separation', async () => {
  const { owner, clipId } = await fixture('video')
  const before = owner.document, app = createApplicationHarness()
  try {
    const result = await app.requireResult('send_video_edit_clip_to_audio_edit', { documentRef: { kind: 'video_edit.document', id: before.id }, clipRef: { kind: 'video_edit.clip', id: `${before.id}:${clipId}` } }) as { audioDocumentRef: { id: string }; clipRef: { id: string }; created: boolean }
    expect(result.created).toBe(true)
    const sound = owner.document.sequences[0].clips.find(c => c.creativeSource?.type === 'document')!
    expect(sound.kind).toBe('audio'); expect(sound.sourceInUs).toBe(0)
    expect(owner.document.sequences[0].clips.find(c => c.id === clipId)?.sourceComponent).toBe('video')
    const audio = await loadAudioEditProject(result.audioDocumentRef.id)
    expect(audio.document.cuts?.[0]).toMatchObject({ startFrame: 0, endFrame: 48000 })
    expect((await sendVideoEditClipToAudioEdit(before.id, sound.id, false)).created).toBe(false)
    expect((await sendVideoEditClipToAudioEdit(before.id, clipId, false)).documentId).toBe(audio.document.id)
    undoVideoEdit(before.id)
    expect(owner.document.sequences[0].clips).toEqual(before.sequences[0].clips)
  } finally { app.dispose() }
})
it('saved edits refresh all links, trim tails without ripple, do not extend, and update after reopen', async () => {
  const { owner, clipId } = await fixture()
  const sent = await sendVideoEditClipToAudioEdit(owner.document.id, clipId, false)
  const audio = await loadAudioEditProject(sent.documentId)
  const start = audio.document.cuts![0].endFrame
  editAudioEditProject(sent.documentId, p => ({ ...p, cuts: [{ id: 'head', startFrame: 0, endFrame: start, enabled: true, reason: 'manual' }, { id: 'tail', startFrame: start + 48000, endFrame: p.source.durationFrames, enabled: true, reason: 'manual' }] }))
  await flushAudioEditProject(sent.documentId)
  // The persisted-revision subscription may already have refreshed it; join its queue.
  await refreshVideoEditAudioDocumentClips(owner.document.id, sent.documentId)
  const shortened = owner.document.sequences[0].clips.find(c => c.id === clipId)!
  expect(shortened.duration).toBe(videoEditFps(owner.document.sequences[0].frameRate)); expect(shortened.start).toBe(20)
  expect(owner.document.sequences[0].clips.find(c => c.id === 'following')?.start).toBe(300)
  expect(getVideoEditAudioLinkNotices(owner.document.id)[0].message).toContain('截短')
  expect(await refreshVideoEditAudioDocumentClips(owner.document.id, sent.documentId)).toBe(0)
  await closeVideoEditProject(owner.document.id)
  editAudioEditProject(sent.documentId, p => ({ ...p, cuts: [] })); await flushAudioEditProject(sent.documentId)
  const reopened = await reopenVideoEdit(owner.document.id)
  await refreshVideoEditAudioDocumentClips(reopened.document.id, sent.documentId)
  expect(reopened.document.sequences[0].clips.find(c => c.id === clipId)?.duration).toBe(shortened.duration)
})

it('口播改字、分段、剪掉和恢复只更新声音，剪辑字幕保留且不写回；整段移除与普通删除一致', async () => {
  const { owner, clipId } = await fixture()
  const sent = await sendVideoEditClipToAudioEdit(owner.document.id, clipId, false)
  const audio = await loadAudioEditProject(sent.documentId)
  editAudioEditProject(sent.documentId, document => ({ ...document, transcript: [
    { id: 'word-a', text: '口播', startFrame: 48000, endFrame: 96000, included: true, locked: false, granularity: 'word' },
    { id: 'word-b', text: '原文', startFrame: 96000, endFrame: 144000, included: true, locked: false, granularity: 'word' },
  ] }))
  await flushAudioEditProject(sent.documentId)
  await refreshVideoEditAudioDocumentClips(owner.document.id, sent.documentId)
  const sequence = owner.document.sequences[0], clip = sequence.clips.find(value => value.id === clipId)!
  const captions = videoEditCaptionsFromAudioEdit(clip, videoEditFps(sequence.frameRate), buildProjectAudioEditSubtitleCues(audio.document), audio.document.source.sampleRate)
    .map(caption => ({ ...caption, start: caption.start + 2, duration: caption.duration - 4, text: '剪辑定稿', translation: 'Final', style: videoEditSubtitleStyleSchema.parse({ fontSize: 52 }), speech: { ...caption.speech!, words: caption.speech!.words.slice(-1) } }))
  editVideoProject(owner.document.id, document => ({ ...document, sequences: document.sequences.map(value => ({ ...value, captions })) }))
  const stop = startVideoEditAudioDocumentLinks()
  try {
    const cuts = audio.document.cuts
    editAudioEditProject(sent.documentId, document => ({ ...document, transcript: document.transcript.map(block => ({ ...block, text: `${block.text}改字`, captionBreakAfter: true })) }))
    await flushAudioEditProject(sent.documentId)
    await refreshVideoEditAudioDocumentClips(owner.document.id, sent.documentId)
    expect(owner.document.sequences[0].captions).toEqual(captions)
    editAudioEditProject(sent.documentId, document => ({ ...document, cuts: [...cuts ?? [], { id: 'shorten', startFrame: 96000, endFrame: 240000, enabled: true, reason: 'manual' }] }))
    await flushAudioEditProject(sent.documentId)
    await refreshVideoEditAudioDocumentClips(owner.document.id, sent.documentId)
    const { clipId: _clipId, ...authored } = captions[0]
    const independent = { ...authored, speech: undefined, reviewReasons: ['timing'] }
    expect(owner.document.sequences[0].captions).toEqual([independent])
    expect(owner.document.sequences[0].clips.find(value => value.id === clipId)?.duration).toBe(30)
    editVideoProject(owner.document.id, document => ({ ...document, sequences: document.sequences.map(value => ({ ...value, clips: value.clips.map(item => item.id === 'following' ? { ...item, volume: 0.5 } : item) })) }))
    expect(owner.document.sequences[0].captions).toEqual([independent])
    editAudioEditProject(sent.documentId, document => ({ ...document, cuts }))
    await flushAudioEditProject(sent.documentId)
    await refreshVideoEditAudioDocumentClips(owner.document.id, sent.documentId)
    expect(owner.document.sequences[0].captions).toEqual([independent])
    const audioBefore = audio.document
    editVideoProject(owner.document.id, document => ({ ...document, sequences: document.sequences.map(value => ({ ...value, captions: value.captions?.map(caption => ({ ...caption, text: '剪辑再次改字' })) })) }))
    await flushAudioEditProject(sent.documentId)
    expect(audio.document).toEqual(audioBefore)
    const expected = applyVideoEditTimelineEdit(owner.document, sequence.id, { kind: 'delete', clipIds: [clipId], linked: false }).captions
    editAudioEditProject(sent.documentId, document => ({ ...document, cuts: [{ id: 'all', startFrame: 0, endFrame: document.source.durationFrames, enabled: true, reason: 'manual' }] }))
    await flushAudioEditProject(sent.documentId)
    await refreshVideoEditAudioDocumentClips(owner.document.id, sent.documentId)
    expect(owner.document.sequences[0].clips.some(value => value.id === clipId)).toBe(false)
    expect(owner.document.sequences[0].captions).toEqual(expected)
  } finally { stop() }
})

it('all linked clips respect speed and reverse boundaries; exhausted clips leave followers unmoved', async () => {
  const { owner, clipId } = await fixture()
  const sequence = owner.document.sequences[0], original = sequence.clips.find(c => c.id === clipId)!
  const source = { type: 'document' as const, docRef: { docId: 'audio', path: 'audio.hjaud' }, revision: 1 }
  const document: typeof owner.document = { ...owner.document, sequences: [{ ...sequence, clips: [
    { ...original, id: 'fast', sourceInUs: 0, speed: { numerator: 2, denominator: 1 }, creativeSource: source },
    { ...original, id: 'reverse', sourceInUs: 1000000, reverse: true, creativeSource: source },
    { ...original, id: 'exhausted', sourceInUs: 2000000, creativeSource: source },
    sequence.clips.find(c => c.id === 'following')!,
  ] }] }
  const result = updateVideoEditAudioLinks(document, 'audio', 'new-item', { ...source, revision: 2 }, 1)
  expect(result.changed).toBe(3)
  expect(result.document.sequences[0].clips.map(c => [c.id, c.duration, c.start])).toEqual([
    ['fast', 15, 20], ['reverse', 30, 20], ['following', 120, 300],
  ])
  expect(result.notices).toHaveLength(3)
  expect(result.document.sequences[0].clips[0].creativeSource).toMatchObject({ revision: 2 })
})

it('拼接替换素材后刷新动态链接，撤销恢复来源也刷新，剪辑时长不自动延长', async () => {
  const { owner, clipId } = await fixture()
  const sent = await sendVideoEditClipToAudioEdit(owner.document.id, clipId, false)
  const audio = await loadAudioEditProject(sent.documentId)
  const source = audio.document.source
  const original = owner.document.sequences[0].clips.find(clip => clip.id === clipId)!
  vi.spyOn(getPlatform().audioEdit, 'splice').mockResolvedValue({ source: { ...source, sourcePath: path.resolve(path.sep, 'take-spliced.wav'), audioPath: path.resolve(path.sep, 'take-spliced.wav'), durationFrames: source.durationFrames + 48000, ownership: 'managed' }, insertedFrames: 48000 })
  await insertAudioEditFile(sent.documentId, path.resolve(path.sep, 'take.wav'), 96000)
  await refreshVideoEditAudioDocumentClips(owner.document.id, sent.documentId)
  const updated = owner.document.sequences[0].clips.find(clip => clip.id === clipId)!
  expect(updated.creativeSource).toMatchObject({ revision: audio.persistedRevision })
  expect(updated.duration).toBe(original.duration)
  expect(updated.start).toBe(original.start)
  expect(updated.itemId).not.toBe(original.itemId)
  undoAudioEditProject(sent.documentId)
  await flushAudioEditProject(sent.documentId)
  await refreshVideoEditAudioDocumentClips(owner.document.id, sent.documentId)
  expect(audio.document.source).toEqual(source)
  expect(owner.document.sequences[0].clips.find(clip => clip.id === clipId)?.creativeSource).toMatchObject({ revision: audio.persistedRevision })
})

it('独立剪辑发送音频与刷新链接均把缓存产物收进作品目录', async () => {
  const { owner, clipId } = await fixture()
  await videoEditDocumentOperations().moveDocument(owner.session.documentMeta, { kind: 'user' })
  const imported = vi.mocked(videoEditDocumentOperations().importFile)
  imported.mockImplementation(async input => ({ path: path.resolve(path.sep, 'generated', path.basename(input.sourcePath)), copied: true }))
  const sent = await sendVideoEditClipToAudioEdit(owner.document.id, clipId, false)
  expect(imported).toHaveBeenLastCalledWith(expect.objectContaining({ container: { kind: 'user' }, folder: 'generated' }))
  const media = owner.document.media.find(media => media.linkedTimeline)
  expect(media?.path).toContain('generated')
  const audio = await loadAudioEditProject(sent.documentId)
  editAudioEditProject(audio.document.id, document => ({ ...document, cuts: [{ id: 'cut', startFrame: 0, endFrame: 24000, enabled: true, reason: 'manual' }] }))
  await flushAudioEditProject(audio.document.id)
  await refreshVideoEditAudioDocumentClips(owner.document.id, audio.document.id)
  expect(imported).toHaveBeenCalledTimes(2)
  expect(imported.mock.calls.every(([input]) => input.container.kind === 'user')).toBe(true)
})
