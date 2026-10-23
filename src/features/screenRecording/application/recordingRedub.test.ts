// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createRecordingDocument } from '@/core/screenRecording/document'
import { createVideoEditDocument, videoEditDocumentSchema, videoEditDuration } from '@/core/videoEdit/document'
import { RECORDING_MOVIE_RECIPES } from '@/core/screenRecording/movie'
import { recordingRedubTarget, replaceRecordingNarration } from '@/core/screenRecording/redub'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { seedVideoEditDocument, closeAllVideoEdits } from '@/features/videoEdit/application/videoEditDocumentTestKit'
import { openVideoEditDocument, editVideoProject, undoVideoEdit } from '@/features/videoEdit/application/videoEditService'
import { buildRecordingMoviePlan } from './recordingMoviePlan'

beforeEach(() => installHarnessNativeStorage())
afterEach(async () => { await closeAllVideoEdits(); vi.restoreAllMocks(); uninstallHarnessNativeStorage() })
function fixture() {
  const recording = createRecordingDocument(), document = createVideoEditDocument('补录')
  recording.media = [{ id: 'screen', kind: 'screen', path: '/screen.mp4', monoUs: 0, durationUs: 10e6 }, { id: 'mic', kind: 'microphone', path: '/mic.wav', monoUs: 0, durationUs: 10e6 }]
  recording.understanding.transcript = [0, 5].map((start, index) => ({ id: `s${index}`, mediaId: 'mic', audioDocumentId: 'audio', startUs: start * 1e6, endUs: (start + 3) * 1e6, text: `句子${index}。`, granularity: 'segment' }))
  document.media = recording.media.map(v => ({ id: v.id, kind: v.kind === 'screen' ? 'video' : 'audio', path: v.path, name: v.id, width: 1920, height: 1080, durationSeconds: 10, creativeSource: { type: 'document', docRef: { docId: 'session', path: '/session.hjrec' }, revision: 1 } }))
  document.items = document.media.map(v => ({ id: `i${v.id}`, mediaId: v.id, kind: v.kind, name: v.name }))
  const result = buildRecordingMoviePlan(document, recording, recording.understanding, { ...RECORDING_MOVIE_RECIPES.original, captions: true, frame: true }, '补录')
  const sequence = document.sequences.find(v => v.id === result.sequenceIds[0])!
  // Quiet gaps in a raw microphone recording remain independent audio clips. Remove those
  // explicitly for this editorial fixture, just as a user may trim the original microphone.
  sequence.clips = sequence.clips.filter(v => v.kind !== 'audio' || v.text)
  document.media.push({ id: 'new', kind: 'audio', path: '/new.wav', name: '新旁白', width: 0, height: 0, durationSeconds: 5.2 }, { id: 'still', kind: 'image', path: '/still.png', name: '停留', durationSeconds: 0, width: 1920, height: 1080 })
  document.items.push({ id: 'inew', kind: 'audio', mediaId: 'new', name: '新旁白' }, { id: 'istill', kind: 'image', mediaId: 'still', name: '停留' })
  videoEditDocumentSchema.parse(document)
  return { document, sequence, clip: sequence.clips.find(v => v.kind === 'audio')!, media: document.media.find(v => v.id === 'new')!, still: document.media.find(v => v.id === 'still')! }
}
it('按句关联普通录制文字稿；微变速保持源画面端点，字幕与后续旁白同步后移，一次撤销恢复', async () => {
  const { document, sequence, clip, media } = fixture()
  const owner = await openVideoEditDocument({ id: seedVideoEditDocument(document) }), before = structuredClone(owner.document)
  const target = recordingRedubTarget(owner.document, clip.id)
  editVideoProject(owner.document.id, draft => { replaceRecordingNarration(draft, target, media, '更新后的句子。'); return videoEditDocumentSchema.parse(draft) })
  const after = owner.document.sequences.find(v => v.id === sequence.id)!
  expect(after.clips.find(v => v.id === clip.id)).toMatchObject({ duration: 156, text: '更新后的句子。', fadeInFrames: 1, fadeOutFrames: 1 })
  expect(after.captions?.[0]).toMatchObject({ text: '更新后的句子。', duration: 156, clipId: clip.id })
  expect(after.captions?.[1].start).toBe(156)
  expect(after.clips.find(v => v.kind === 'sequence' && v.start === 0)?.speed).toEqual({ numerator: 25, denominator: 26 })
  expect(videoEditDuration(after)).toBe(306)
  undoVideoEdit(owner.document.id)
  expect(owner.document.sequences).toEqual(before.sequences)
})
it('大幅延长用末帧停留并后移后续内容；锁轨与交叠声音在修改前拒绝', () => {
  const { document, sequence, clip, media, still } = fixture()
  media.durationSeconds = 7
  const target = recordingRedubTarget(document, clip.id)
  const overlap = structuredClone(document)
  overlap.sequences.find(v => v.id === sequence.id)!.clips.push({ ...clip, id: 'other-sound', track: 1, start: 120, duration: 60 })
  expect(() => replaceRecordingNarration(overlap, target, media, '延长时不能撞上另一声音', still)).toThrow('其他声音')
  const copy = structuredClone(document)
  expect(() => replaceRecordingNarration(copy, target, media, '更长的旁白。')).toThrow('停留')
  replaceRecordingNarration(document, target, media, '更长的旁白。', still)
  const after = document.sequences.find(v => v.id === sequence.id)!
  expect(after.clips.find(v => v.itemId === 'istill')).toMatchObject({ start: 150, duration: 60 })
  expect(after.captions?.[1].start).toBe(210)
  expect(videoEditDocumentSchema.parse(document).sequences).toHaveLength(document.sequences.length)
  const again = recordingRedubTarget(document, clip.id)
  media.durationSeconds = 8
  replaceRecordingNarration(document, again, media, '再次修改。')
  expect(document.sequences.find(v => v.id === sequence.id)!.clips.filter(v => v.itemId === 'istill')).toMatchObject([{ duration: 90 }])
  after.tracks[0].locked = true
  expect(() => recordingRedubTarget(document, clip.id)).toThrow('锁轨')
})
