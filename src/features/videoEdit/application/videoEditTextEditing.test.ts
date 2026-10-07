import { createVideoEditTestProject as createVideoEditProject } from './videoEditDocumentTestKit'
// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { makeVideoEditItemClip } from '@/core/videoEdit/projectItems'
import { buildVideoEditTextTranscription } from '@/core/videoEdit/textTranscript'
import { videoEditComposition } from '@/core/videoEdit/document'
import { editVideoProject, undoVideoEdit } from './videoEditService'
import { editVideoEditText } from './videoEditTextEditing'
import { closeAllVideoEdits, savedVideoEdit, reopenVideoEdit, failVideoEditSaves } from './videoEditDocumentTestKit'
import { handleVideoEditTextCapability } from './videoEditTextCapability'
import { getPlatform } from '@/platform/runtime'

beforeEach(installHarnessNativeStorage)
afterEach(async () => { await closeAllVideoEdits(); vi.restoreAllMocks(); uninstallHarnessNativeStorage() })
async function fixture() {
  const owner = await createVideoEditProject()
  editVideoProject(owner.document.id, document => {
    document.media = [{ id: 'm', name: '口播', kind: 'video', path: 'D:/voice.mp4', width: 64, height: 64, durationSeconds: 10, hasAudio: true }]
    document.items = [{ id: 'item', name: '口播', kind: 'video', mediaId: 'm' }]
    const sequence = document.sequences[0]
    const base = makeVideoEditItemClip(document, 'item', sequence.id, { frame: 0, duration: 150 })
    sequence.clips = [{ ...base, id: 'v', sourceComponent: 'video', linkId: 'link' }, { ...base, id: 'a', kind: 'audio', track: sequence.tracks.find(track => track.kind === 'audio')!.index, sourceComponent: 'audio', linkId: 'link' }]
    sequence.textTranscription = buildVideoEditTextTranscription(videoEditComposition(document, sequence.id), [sequence.clips[1]], { id: 'audio', name: '口播', source: { mediaType: 'audio', sourcePath: 'D:/mix.wav', audioPath: 'D:/mix.wav', durationFrames: 5000, sampleRate: 1000, channels: 1 }, revision: 1, createdAt: 1, updatedAt: 1, vstEnabled: false, referenceScript: '', suggestions: [], transcript: [
      { id: 'f1', text: '嗯', startFrame: 0, endFrame: 500, granularity: 'word', included: true, locked: false },
      { id: 'price', text: '价格九元。', startFrame: 1000, endFrame: 2000, granularity: 'word', included: true, locked: false },
      { id: 'f2', text: '那个', startFrame: 3000, endFrame: 3500, granularity: 'word', included: true, locked: false },
    ] }, 0)
    return document
  })
  return owner
}
it('batch fillers ripple-delete linked audio/video in one history step; stale selections refuse; undo restores all', async () => {
  const owner = await fixture(); const before = structuredClone(owner.document); const sequence = owner.document.sequences[0]; const history = owner.past.length
  editVideoEditText(owner.document.id, sequence.id, { kind: 'fillers' }, 'delete', undefined, undefined, sequence)
  expect(owner.past.length).toBe(history + 1)
  expect(owner.document.sequences[0].clips.filter(clip => clip.kind === 'video').reduce((sum, clip) => sum + clip.duration, 0)).toBe(120)
  expect(() => editVideoEditText(owner.document.id, sequence.id, { kind: 'words', ranges: [{ start: 0, end: 0 }] }, 'delete', undefined, undefined, sequence)).toThrow('已有修改')
  undoVideoEdit(owner.document.id); expect(owner.document.sequences).toEqual(before.sequences)
})
it('excerpt and insertion share a single undo step without touching the source sequence or media', async () => {
  const owner = await fixture(); const before = structuredClone(owner.document); const sequence = owner.document.sequences[0]
  const history = owner.past.length
  const result = editVideoEditText(owner.document.id, sequence.id, { kind: 'text', text: '价格九元' }, 'extract')
  expect(owner.document.sequences).toHaveLength(2); expect(owner.past.length).toBe(history + 1)
  expect(owner.document.sequences[0]).toEqual(before.sequences[0]); expect(result.ranges).toEqual([{ from: 30, to: 60 }])
  undoVideoEdit(owner.document.id); expect(owner.document.sequences).toEqual(before.sequences)
  editVideoEditText(owner.document.id, sequence.id, { kind: 'text', text: '价格九元' }, 'insert', 90)
  expect(owner.past.length).toBe(history + 1); expect(owner.document.media).toEqual(before.media)
  undoVideoEdit(owner.document.id); expect(owner.document.sequences).toEqual(before.sequences)
})
it('formal assistant reads mapped transcript, matches original text, extracts and saves recoverable source words', async () => {
  const owner = await fixture(); const app = createApplicationHarness(); const sequence = owner.document.sequences[0]
  const documentRef = { kind: 'video_edit.document', id: owner.document.id }; const sequenceRef = { kind: 'video_edit.sequence', id: `${owner.document.id}:${sequence.id}` }
  try {
    const read = await app.read(sequenceRef, ['video_edit.sequence.transcript'])
    expect(read.properties).toMatchObject({ 'video_edit.sequence.transcript': [{ index: 0, text: '嗯', from: 0, to: 15, editable: true }, { index: 1, text: '价格九元。', from: 30, to: 60 }, { index: 2, text: '那个' }] })
    const result = await app.call('extract_video_edit_text', { documentRef, sequenceRef, selector: { kind: 'text', text: '价格九元' }, name: '价格段' })
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true, data: { ranges: [{ from: 30, to: 60 }], changed: true, verified: true } })
    expect(savedVideoEdit(owner).sequences[1].name).toBe('价格段')
    const reopened = await reopenVideoEdit(owner.document.id)
    expect(reopened.document.sequences[1].textTranscription).toEqual(owner.document.sequences[1].textTranscription)
    expect(await app.change(sequenceRef, { 'video_edit.sequence.transcript': [] })).toMatchObject({ ok: false })
  } finally { app.dispose() }
})
it('capability returns actual deleted original intervals, no recognition; save failure keeps the edit and forbids replay', async () => {
  const owner = await fixture(); const sequence = owner.document.sequences[0]; const asr = vi.spyOn(getPlatform().audioEdit, 'transcribe')
  const raw = { documentRef: { kind: 'video_edit.document', id: owner.document.id }, sequenceRef: { kind: 'video_edit.sequence', id: `${owner.document.id}:${sequence.id}` }, selector: { kind: 'fillers' } }
  expect(await handleVideoEditTextCapability('ripple_delete_video_edit_text', raw)).toMatchObject({ ranges: [{ from: 0, to: 15 }, { from: 90, to: 105 }], changed: true, verified: true })
  expect(asr).not.toHaveBeenCalled()
  undoVideoEdit(owner.document.id); const history = owner.past.length; failVideoEditSaves(true)
  await expect(handleVideoEditTextCapability('ripple_delete_video_edit_text', raw)).rejects.toMatchObject({ message: expect.stringContaining('不要重复剪辑') })
  expect(owner.past.length).toBe(history + 1); expect(asr).not.toHaveBeenCalled(); failVideoEditSaves(false)
})
