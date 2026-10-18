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
import { nestVideoEditSelection } from './videoEditNesting'
import { queryVideoEditTranscriptCapability } from '@/core/application-control/domains/videoEdit/videoEditTextCapabilities'
import { readVideoEditTranscriptQuery } from './videoEditTranscriptQuery'
import * as transcriptFunctions from '@/core/videoEdit/textTranscript'
import { createApplicationCallerGrant } from '@/core/application-control/callerContext'
import { createApplicationCapabilitySession } from '@/features/application-control/applicationCapabilityService'
import { appendAutoSubtitles, splitVideoEditSubtitle, mergeVideoEditSubtitles } from './videoEditAutoSubtitles'

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

it('公共文本读写递归消费嵌套词源，摘选保存后重开仍有词级时刻', async () => {
  const owner = await fixture(); const id = owner.document.id; const sequence = owner.document.sequences[0]
  nestVideoEditSelection({ projectId: id, sequenceId: sequence.id, clipIds: sequence.clips.map(clip => clip.id) }, '嵌套口播')
  const app = createApplicationHarness()
  try {
    const sequenceRef = { kind: 'video_edit.sequence', id: `${id}:${sequence.id}` }; const documentRef = { kind: 'video_edit.document', id }
    expect((await app.read(sequenceRef, ['video_edit.sequence.transcript'])).properties).toMatchObject({ 'video_edit.sequence.transcript': [{ text: '嗯', from: 0, to: 15, editable: true }, { text: '价格九元。', from: 30, to: 60 }, { text: '那个' }] })
    expect(await app.call('extract_video_edit_text', { documentRef, sequenceRef, selector: { kind: 'text', text: '价格九元' }, name: '嵌套摘选' })).toMatchObject({ ok: true, data: { ranges: [{ from: 30, to: 60 }], changed: true, verified: true } })
    const reopened = await reopenVideoEdit(id); const excerpt = reopened.document.sequences.find(sequence => sequence.name === '嵌套摘选')!
    expect((await app.read({ kind: 'video_edit.sequence', id: `${id}:${excerpt.id}` }, ['video_edit.sequence.transcript'])).properties).toMatchObject({ 'video_edit.sequence.transcript': [{ text: '价格九元。', from: 0, to: 30, editable: true }] })
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

it('正式局部查询返回有界候选，直接摘选、保存并撤销；剪后旧候选拒绝重放', async () => {
  const owner = await fixture(); const app = createApplicationHarness(); const sequence = owner.document.sequences[0]
  const documentRef = { kind: 'video_edit.document', id: owner.document.id }; const sequenceRef = { kind: 'video_edit.sequence', id: `${owner.document.id}:${sequence.id}` }
  const recognize = vi.spyOn(getPlatform().audioEdit, 'transcribe'); const history = owner.past.length
  try {
    const query = queryVideoEditTranscriptCapability.outputSchema.parse(await app.requireResult('query_video_edit_transcript', { documentRef, sequenceRef, text: '价格，九元', matchSource: 'asr', limit: 1 }))
    expect(query).toMatchObject({ total: 1, nextCursor: null, matches: [{ text: '价格九元。', from: 30, to: 60, editable: true, sourceRange: { startUs: 1000000, endUs: 2000000 } }] })
    expect(owner.past.length).toBe(history)
    const selector = query.matches[0].selector
    expect(selector).toBeDefined()
    expect(await app.call('extract_video_edit_text', { documentRef, sequenceRef, selector, name: '查询摘选' })).toMatchObject({ ok: true, data: { ranges: [{ from: 30, to: 60 }], verified: true } })
    expect(savedVideoEdit(owner).sequences[1].name).toBe('查询摘选'); expect(owner.past.length).toBe(history + 1)
    expect(await app.call('extract_video_edit_text', { documentRef, sequenceRef, selector })).toMatchObject({ ok: false })
    undoVideoEdit(owner.document.id)
    expect(owner.document.sequences).toHaveLength(1); expect(recognize).not.toHaveBeenCalled()
  } finally { app.dispose() }
})

it('查询分页按原条件读回，跨序列、关闭重开、内容变化与未知候选均不能剪辑', async () => {
  const owner = await fixture(); const sequence = owner.document.sequences[0]
  const first = readVideoEditTranscriptQuery(owner.document.id, sequence.id, {}, { limit: 1 })
  expect(first.total).toBe(2); expect(first.nextCursor).toBeTruthy()
  const second = readVideoEditTranscriptQuery(owner.document.id, sequence.id, {}, { limit: 1, cursor: first.nextCursor! })
  expect(second.matches[0].text).not.toBe(first.matches[0].text)
  expect(() => readVideoEditTranscriptQuery(owner.document.id, sequence.id, { text: '改变条件' }, { limit: 1, cursor: first.nextCursor! })).toThrow('失效')
  expect(() => editVideoEditText(owner.document.id, 'other-sequence', first.matches[0].selector!, 'delete')).toThrow()
  expect(() => editVideoEditText(owner.document.id, sequence.id, { kind: 'match', matchId: 'made-up' }, 'delete')).toThrow('失效')
  editVideoProject(owner.document.id, document => { document.sequences[0].name = '已修改'; return document })
  expect(() => readVideoEditTranscriptQuery(owner.document.id, sequence.id, {}, { limit: 1, cursor: first.nextCursor! })).toThrow('失效')
  expect(() => editVideoEditText(owner.document.id, sequence.id, first.matches[0].selector!, 'delete')).toThrow('失效')
  const fresh = readVideoEditTranscriptQuery(owner.document.id, sequence.id, {}, { limit: 1 })
  await reopenVideoEdit(owner.document.id)
  expect(() => editVideoEditText(owner.document.id, sequence.id, fresh.matches[0].selector!, 'delete')).toThrow('失效')
})

it('读取序列名字不计算转录与静音；局部检索条件拒绝纯标点和错误范围', async () => {
  const owner = await fixture(); const app = createApplicationHarness(); const sequence = owner.document.sequences[0]
  const ref = { kind: 'video_edit.sequence', id: `${owner.document.id}:${sequence.id}` }
  const words = vi.spyOn(transcriptFunctions, 'videoEditTranscriptWords'); const ranges = vi.spyOn(transcriptFunctions, 'resolveVideoEditTextRanges')
  try {
    expect((await app.read(ref, ['video_edit.sequence.name'])).properties).toEqual({ 'video_edit.sequence.name': sequence.name })
    expect(words).not.toHaveBeenCalled(); expect(ranges).not.toHaveBeenCalled()
    const input = { documentRef: { kind: 'video_edit.document', id: owner.document.id }, sequenceRef: ref }
    expect(await app.call('query_video_edit_transcript', { ...input, text: '，。' })).toMatchObject({ ok: false })
    expect(await app.call('query_video_edit_transcript', { ...input, from: 60, to: 30 })).toMatchObject({ ok: false })
    expect(await app.call('query_video_edit_transcript', { ...input, clipRef: { kind: 'video_edit.clip', id: 'other-project:v' } })).toMatchObject({ ok: false })
    expect(await app.call('query_video_edit_transcript', { ...input, itemRef: { kind: 'video_edit.item', id: `${owner.document.id}:missing` } })).toMatchObject({ ok: false })
  } finally { app.dispose() }
})

it('长稿重复句分开分页，公共只读授权能查询且不能借候选写入', async () => {
  const owner = await fixture(); const sequence = owner.document.sequences[0]
  editVideoProject(owner.document.id, document => {
    document.media[0].durationSeconds = 200
    for (const clip of document.sequences[0].clips) clip.duration = 6000
    document.sequences[0].textTranscription!.sources[0].blocks = Array.from({ length: 1200 }, (_, index) => ({
      id: `word-${index}`, text: '打开后台。', startFrame: index * 100000, endFrame: (index + 1) * 100000, granularity: 'word' as const, included: true, locked: false,
    }))
    return document
  })
  const history = owner.past.length
  const session = createApplicationCapabilitySession(createApplicationCallerGrant({
    callerId: crypto.randomUUID(), capabilityIds: ['query_video_edit_transcript', 'extract_video_edit_text'], permissions: ['video_edit:read'], allowWrites: false, allowDestructive: false,
  }))
  const input = { documentRef: { kind: 'video_edit.document', id: owner.document.id }, sequenceRef: { kind: 'video_edit.sequence', id: `${owner.document.id}:${sequence.id}` }, text: '打开，后台', matchSource: 'asr', limit: 50 }
  const request = () => ({ requestId: crypto.randomUUID(), signal: new AbortController().signal })
  const first = await session.execute({ id: 'query_video_edit_transcript', version: 1, input }, request())
  expect(first.ok).toBe(true)
  if (!first.ok) throw new Error(JSON.stringify(first.error))
  const page = queryVideoEditTranscriptCapability.outputSchema.parse(first.data)
  expect(page.total).toBe(1200); expect(page.matches).toHaveLength(50)
  expect(new Set(page.matches.map(match => match.matchId)).size).toBe(50)
  expect(JSON.stringify(page).length).toBeLessThan(60000)
  const second = await session.execute({ id: 'query_video_edit_transcript', version: 1, input: { ...input, cursor: page.nextCursor } }, request())
  expect(second.ok).toBe(true)
  if (!second.ok) throw new Error(JSON.stringify(second.error))
  const next = queryVideoEditTranscriptCapability.outputSchema.parse(second.data)
  expect(next.matches[0].from).toBe(page.matches.at(-1)!.to)
  await expect(session.execute({ id: 'extract_video_edit_text', version: 1, input: { documentRef: input.documentRef, sequenceRef: input.sequenceRef, selector: page.matches[0].selector } }, request())).rejects.toThrow()
  expect(owner.past.length).toBe(history)
})

it('自动字幕词源经公共剪辑保存，撤销重做和重开保留正文及来源；来源不可伪写', async () => {
  const owner = await fixture(); const sequenceId = owner.document.sequences[0].id
  appendAutoSubtitles(owner.document.id, sequenceId, [{ id: 'speech-caption', text: '嗯价格九元那个', start: 0, duration: 105 }])
  const before = structuredClone(owner.document); const app = createApplicationHarness()
  const documentRef = { kind: 'video_edit.document', id: owner.document.id }; const sequenceRef = { kind: 'video_edit.sequence', id: `${owner.document.id}:${sequenceId}` }
  try {
    const captionRef = { kind: 'video_edit.caption', id: `${owner.document.id}:speech-caption` }
    const read = await app.read(captionRef, ['video_edit.caption.speech', 'video_edit.caption.review_reasons'])
    expect(read.properties).toMatchObject({ 'video_edit.caption.speech': { aligned: true, words: [{ clipId: 'a' }, { clipId: 'a' }, { clipId: 'a' }] }, 'video_edit.caption.review_reasons': [] })
    expect(await app.change(captionRef, { 'video_edit.caption.speech': null })).toMatchObject({ ok: false })
    const parentBaseline = await app.read(sequenceRef, ['video_edit.sequence.name'])
    const forged = await app.call('change_application_entities', { summary: '拒绝创建伪造词源', changes: [{ kind: 'create_items', entityType: 'video_edit.caption', parent: sequenceRef, items: [{ properties: {
      'video_edit.caption.start': 0, 'video_edit.caption.duration': 15, 'video_edit.caption.text': '伪造', 'video_edit.caption.speech': (read.properties as Record<string, unknown>)['video_edit.caption.speech'],
    } }] }] }, parentBaseline.revisions as Record<string, number>)
    expect(forged).toMatchObject({ ok: false, error: { message: expect.stringContaining('字幕来源') } })
    const query = queryVideoEditTranscriptCapability.outputSchema.parse(await app.requireResult('query_video_edit_transcript', { documentRef, sequenceRef, text: '价格九元', matchSource: 'asr' }))
    const baseline = await app.read(documentRef, ['video_edit.document.name'])
    const deleted = await app.call('ripple_delete_video_edit_text', { documentRef, sequenceRef, selector: query.matches[0].selector }, baseline.revisions as Record<string, number>)
    expect(deleted, JSON.stringify(deleted)).toMatchObject({ ok: true })
    expect(owner.document.sequences[0].captions!.map(caption => caption.text)).toEqual(['嗯', '那个'])
    const after = structuredClone(owner.document.sequences)
    expect(savedVideoEdit(owner).sequences).toEqual(after)
    undoVideoEdit(owner.document.id); expect(owner.document.sequences).toEqual(before.sequences)
    undoVideoEdit(owner.document.id, true); expect(owner.document.sequences).toEqual(after)
    const reopened = await reopenVideoEdit(owner.document.id)
    expect(reopened.document.sequences).toEqual(after)
  } finally { app.dispose() }
})

it('字幕拆并更新各自词源，锁定声音也保护未绑定单个片段的字幕与待复核确认', async () => {
  const owner = await fixture(); const id = owner.document.id; const sequenceId = owner.document.sequences[0].id
  appendAutoSubtitles(id, sequenceId, [{ id: 'cue', text: '嗯价格九元。那个', start: 0, duration: 105 }])
  splitVideoEditSubtitle(id, sequenceId, 'cue', 60, 6)
  expect(owner.document.sequences[0].captions!.map(caption => caption.speech!.words.length)).toEqual([2, 1])
  mergeVideoEditSubtitles(id, sequenceId, owner.document.sequences[0].captions!.map(caption => caption.id))
  expect(owner.document.sequences[0].captions![0].speech!.words).toHaveLength(3)
  editVideoProject(id, document => { document.sequences[0].captions![0].reviewReasons = ['translation']; return document })
  const app = createApplicationHarness(); const captionRef = { kind: 'video_edit.caption', id: `${id}:cue` }
  try {
    expect(await app.change(captionRef, { 'video_edit.caption.review_reasons': [] })).toMatchObject({ ok: true })
    editVideoProject(id, document => { document.sequences[0].tracks.find(track => track.kind === 'audio')!.locked = true; return document })
    expect(await app.change(captionRef, { 'video_edit.caption.text': '不能覆盖锁定声音的字幕' })).toMatchObject({ ok: false })
  } finally { app.dispose() }
})
