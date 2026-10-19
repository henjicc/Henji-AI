// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { resolve, sep } from 'node:path'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { getPlatform } from '@/platform'
import { createRecordingDocument } from '@/core/screenRecording/document'
import { RECORDING_MOVIE_RECIPES } from '@/core/screenRecording/movie'
import { createVideoEditTestProject, closeAllVideoEdits, savedVideoEdit, failVideoEditSaves } from '@/features/videoEdit/application/videoEditDocumentTestKit'
import { editVideoProject, saveVideoEdit, undoVideoEdit } from '@/features/videoEdit/application/videoEditService'
import { generateRecordingMovie } from './recordingMovieService'

const fileContent = { sizeBytes: 4096, fileModifiedAt: 1000, contentIdentity: 'a'.repeat(64) }
beforeEach(() => {
  installHarnessNativeStorage()
  vi.spyOn(getPlatform().assetLibrary, 'inspectFileContent').mockResolvedValue(fileContent)
})
afterEach(async () => { await closeAllVideoEdits(); vi.restoreAllMocks(); uninstallHarnessNativeStorage() })
async function fixture() {
  const id = crypto.randomUUID(), content = createRecordingDocument(), path = resolve(sep, 'fixture', 'screen.mp4')
  content.sessionId = id; content.status = 'stopped'
  content.media = [{ id: 'screen', kind: 'screen', path, monoUs: 3000000, durationUs: 10000000 }]
  content.understanding.steps = [{ id: 'step', title: '打开编辑器', description: '', signal: 'start', startUs: 3000000, endUs: 13000000, eventIds: [] }]
  content.understanding.privacy.candidates = [{ id: 'private', mediaId: 'screen', kind: 'email', hint: '邮箱', fingerprint: 'a'.repeat(64), status: 'accepted', startUs: 4000000, endUs: 5000000, samples: [{ monoUs: 4000000, box: [.1, .2, .3, .1], confidence: 1 }] }]
  await getPlatform().documents.createDocument({ id, kind: 'screen_recording', name: '成片测试', container: { kind: 'user' }, content })
  const owner = await createVideoEditTestProject(), documentId = owner.document.id
  editVideoProject(documentId, draft => {
    draft.media.push({ id: 'screen', path, name: '原片', kind: 'video', width: 1920, height: 1080, durationSeconds: 10, hasAudio: false, assetContent: fileContent })
    draft.items.push({ id: 'screen-item', mediaId: 'screen', name: '原片', kind: 'video' }); return draft
  })
  const recipe = { ...RECORDING_MOVIE_RECIPES.original, normalizeAudio: false }
  const options = { documentId, recipe }
  return { id, owner, options, input: { sessionRef: { kind: 'screen_recording.session', id }, documentRef: { kind: 'video_edit.document', id: documentId }, recipe } }
}
it('正式公开能力生成并保存，返回序列可读；一次撤销恢复全部画幅与原媒体', async () => {
  const { id, owner, options, input } = await fixture(), api = createApplicationHarness()
  try {
    const before = structuredClone(owner.document), history = owner.past.length
    const result = await api.requireResult('generate_screen_recording_movie', { ...input, recipe: { ...input.recipe, formats: ['landscape', 'portrait'] } })
    expect(result).toMatchObject({ verified: true, sequenceRefs: expect.any(Array) })
    expect(owner.document.sequences.flatMap(s => s.clips).flatMap(c => c.effects ?? []).filter(e => e.builtin?.id === 'mosaic')).toMatchObject([{ enabled: true }, { enabled: true }])
    expect(owner.past).toHaveLength(history + 1)
    expect(owner.document.sequences).toHaveLength(before.sequences.length + 4)
    expect(savedVideoEdit(options.documentId).sequences).toEqual(owner.document.sequences)
    expect(owner.document.media[0].creativeSource).toMatchObject({ type: 'document', docRef: { docId: id } })
    const read = await api.read(result.resultRef as { kind: string; id: string })
    expect(read.ref).toEqual(result.resultRef)
    await api.requireResult('undo_video_edit', { documentRef: input.documentRef })
    expect(owner.document.sequences).toEqual(before.sequences)
    expect(owner.document.media).toEqual(before.media)
  } finally { api.dispose() }
})
it('取消和生成期间修改不落半份序列；保存失败仅恢复保存', async () => {
  const { id, owner, options } = await fixture(), history = owner.past.length
  const controller = new AbortController(); controller.abort(new Error('取消'))
  await expect(generateRecordingMovie(id, options, controller.signal)).rejects.toThrow('取消')
  expect(owner.past).toHaveLength(history)
  await expect(generateRecordingMovie(id, options, new AbortController().signal, phase => {
    if (phase === 'preparing') editVideoProject(options.documentId, draft => { draft.sequences[0].name = '用户编辑'; return draft })
  })).rejects.toThrow('已改变')
  expect(owner.document.sequences).toHaveLength(1)
  failVideoEditSaves(true)
  await expect(generateRecordingMovie(id, options, new AbortController().signal)).rejects.toMatchObject({ facts: { recovery: { capabilityId: 'save_video_edit', replayMutation: false } } })
  expect(owner.document.sequences).toHaveLength(3)
  failVideoEditSaves(false); await saveVideoEdit(options.documentId)
  expect(savedVideoEdit(options.documentId).sequences).toHaveLength(3)
  undoVideoEdit(options.documentId); expect(owner.document.sequences).toHaveLength(1)
})
