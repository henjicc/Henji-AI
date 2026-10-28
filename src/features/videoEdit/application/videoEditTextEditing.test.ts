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
import { bindVideoEditClipsToWords } from './videoEditContentAnchors'

const fileContent = { sizeBytes: 4096, fileModifiedAt: 1000, contentIdentity: 'a'.repeat(64) }
beforeEach(() => {
  installHarnessNativeStorage()
  vi.spyOn(getPlatform().assetLibrary, 'inspectFileContent').mockResolvedValue(fileContent)
})
afterEach(async () => { await closeAllVideoEdits(); vi.restoreAllMocks(); uninstallHarnessNativeStorage() })
async function fixture() {
  const owner = await createVideoEditProject()
  editVideoProject(owner.document.id, document => { document = structuredClone(document);
    document.media = [{ id: 'm', name: '口播', kind: 'video', path: 'D:/voice.mp4', width: 64, height: 64, durationSeconds: 10, hasAudio: true, assetContent: fileContent }]
    document.items = [{ id: 'item', name: '口播', kind: 'video', mediaId: 'm' }]
    const sequence = document.sequences[0]
    const base = makeVideoEditItemClip(document, 'item', sequence.id, { frame: 0, duration: 150 })
    sequence.clips = [{ ...base, id: 'v', sourceComponent: 'video', linkId: 'link' }, { ...base, id: 'a', kind: 'audio', track: sequence.tracks.find(track => track.kind === 'audio')!.index, sourceComponent: 'audio', linkId: 'link' }]
    sequence.textTranscription = buildVideoEditTextTranscription(videoEditComposition(document, sequence.id), [sequence.clips[1]], { id: 'audio', name: '口播', source: { mediaType: 'audio', sourcePath: 'D:/mix.wav', audioPath: 'D:/mix.wav', durationFrames: 5000, sampleRate: 1000, channels: 1 }, revision: 1, createdAt: 1, updatedAt: 1, referenceScript: '', suggestions: [], transcript: [
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
  await editVideoEditText(owner.document.id, sequence.id, { kind: 'fillers' }, 'delete', undefined, undefined, sequence)
  expect(owner.past.length).toBe(history + 1)
  expect(owner.document.sequences[0].clips.filter(clip => clip.kind === 'video').reduce((sum, clip) => sum + clip.duration, 0)).toBe(120)
  await expect(editVideoEditText(owner.document.id, sequence.id, { kind: 'words', ranges: [{ start: 0, end: 0 }] }, 'delete', undefined, undefined, sequence)).rejects.toThrow('已有修改')
  undoVideoEdit(owner.document.id); expect(owner.document.sequences).toEqual(before.sequences)
})
it('excerpt and insertion share a single undo step without touching the source sequence or media', async () => {
  const owner = await fixture(); const before = structuredClone(owner.document); const sequence = owner.document.sequences[0]
  const history = owner.past.length
  const result = await editVideoEditText(owner.document.id, sequence.id, { kind: 'text', text: '价格九元' }, 'extract')
  expect(owner.document.sequences).toHaveLength(2); expect(owner.past.length).toBe(history + 1)
  expect(owner.document.sequences[0]).toEqual(before.sequences[0]); expect(result.ranges).toEqual([{ from: 30, to: 60 }])
  undoVideoEdit(owner.document.id); expect(owner.document.sequences).toEqual(before.sequences)
  await editVideoEditText(owner.document.id, sequence.id, { kind: 'text', text: '价格九元' }, 'insert', 90)
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

it('文件替换使公共分页与旧精剪候选失效，直接界面服务也不能绕过核对', async () => {
  const owner = await fixture(); const sequence = owner.document.sequences[0]; const app = createApplicationHarness()
  const documentRef = { kind: 'video_edit.document', id: owner.document.id }; const sequenceRef = { kind: 'video_edit.sequence', id: `${owner.document.id}:${sequence.id}` }
  try {
    const first = queryVideoEditTranscriptCapability.outputSchema.parse(await app.requireResult('query_video_edit_transcript', { documentRef, sequenceRef, limit: 1 }))
    expect(first.matches[0].selector).toBeDefined(); expect(first.nextCursor).toBeTruthy()
    const before = owner.document; const history = owner.past.length
    vi.mocked(getPlatform().assetLibrary.inspectFileContent).mockResolvedValue({ ...fileContent, contentIdentity: 'b'.repeat(64) })
    expect(await app.call('query_video_edit_transcript', { documentRef, sequenceRef, limit: 1, cursor: first.nextCursor })).toMatchObject({ ok: false })
    expect(await app.call('extract_video_edit_text', { documentRef, sequenceRef, selector: first.matches[0].selector })).toMatchObject({ ok: false })
    await expect(editVideoEditText(owner.document.id, sequence.id, { kind: 'fillers' }, 'delete')).rejects.toThrow('重新定位')
    expect(owner.document).toBe(before); expect(owner.past.length).toBe(history)
  } finally { app.dispose() }
})

it('核对期间取消或编辑，不剪辑旧时间范围也不覆盖新编辑', async () => {
  const owner = await fixture(); const sequenceId = owner.document.sequences[0].id
  const before = owner.document; const history = owner.past.length; const controller = new AbortController()
  let finish!: (value: typeof fileContent) => void
  vi.mocked(getPlatform().assetLibrary.inspectFileContent).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const pending = editVideoEditText(owner.document.id, sequenceId, { kind: 'fillers' }, 'delete', undefined, undefined, undefined, controller.signal)
  await vi.waitFor(() => expect(finish).toBeTypeOf('function')); controller.abort(new Error('取消文字剪辑'))
  await expect(pending).rejects.toThrow('取消文字剪辑')
  finish(fileContent)
  expect(owner.document).toBe(before); expect(owner.past.length).toBe(history)
  vi.mocked(getPlatform().assetLibrary.inspectFileContent).mockImplementationOnce(async () => {
    editVideoProject(owner.document.id, document => { document = structuredClone(document); document.sequences[0].name = '新手动编辑'; return document })
    return fileContent
  })
  await expect(editVideoEditText(owner.document.id, sequenceId, { kind: 'fillers' }, 'delete')).rejects.toThrow('时间线已有修改')
  expect(owner.document.sequences[0].name).toBe('新手动编辑'); expect(owner.document.sequences[0].clips[0].duration).toBe(150)
  expect(owner.past.length).toBe(history + 1)
})

it('嵌套父层候选沿真实叶子声音核对；没有身份的词源必须先重新定位', async () => {
  const owner = await fixture(); const sequenceId = owner.document.sequences[0].id
  nestVideoEditSelection({ projectId: owner.document.id, sequenceId, clipIds: owner.document.sequences[0].clips.map(clip => clip.id) }, '嵌套词源')
  vi.mocked(getPlatform().assetLibrary.inspectFileContent).mockResolvedValueOnce({ ...fileContent, contentIdentity: 'b'.repeat(64) })
  const before = owner.document
  await expect(editVideoEditText(owner.document.id, sequenceId, { kind: 'text', text: '价格九元' }, 'extract')).rejects.toThrow('重新定位')
  expect(owner.document).toBe(before)
  expect(getPlatform().assetLibrary.inspectFileContent).toHaveBeenCalledWith(owner.document.media[0].path, 'video')
  const other = await fixture()
  editVideoProject(other.document.id, document => { document = structuredClone(document);
    document.media[0].assetContent = undefined
    const sequence = document.sequences[0]
    sequence.textTranscription!.sources[0].mediaIdentity = transcriptFunctions.videoEditTextMediaIdentity(videoEditComposition(document, sequence.id), 'item')
    return document
  })
  await expect(editVideoEditText(other.document.id, other.document.sequences[0].id, { kind: 'fillers' }, 'delete')).rejects.toThrow('尚未绑定原文件身份')
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
  await expect(editVideoEditText(owner.document.id, 'other-sequence', first.matches[0].selector!, 'delete')).rejects.toThrow()
  await expect(editVideoEditText(owner.document.id, sequence.id, { kind: 'match', matchId: 'made-up' }, 'delete')).rejects.toThrow('失效')
  editVideoProject(owner.document.id, document => { document = structuredClone(document); document.sequences[0].name = '已修改'; return document })
  expect(() => readVideoEditTranscriptQuery(owner.document.id, sequence.id, {}, { limit: 1, cursor: first.nextCursor! })).toThrow('失效')
  await expect(editVideoEditText(owner.document.id, sequence.id, first.matches[0].selector!, 'delete')).rejects.toThrow('失效')
  const fresh = readVideoEditTranscriptQuery(owner.document.id, sequence.id, {}, { limit: 1 })
  await reopenVideoEdit(owner.document.id)
  await expect(editVideoEditText(owner.document.id, sequence.id, fresh.matches[0].selector!, 'delete')).rejects.toThrow('失效')
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
  editVideoProject(owner.document.id, document => { document = structuredClone(document);
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
  editVideoProject(id, document => { document = structuredClone(document); document.sequences[0].captions![0].reviewReasons = ['translation']; return document })
  const app = createApplicationHarness(); const captionRef = { kind: 'video_edit.caption', id: `${id}:cue` }
  try {
    expect(await app.change(captionRef, { 'video_edit.caption.review_reasons': [] })).toMatchObject({ ok: true })
    editVideoProject(id, document => { document = structuredClone(document); document.sequences[0].tracks.find(track => track.kind === 'audio')!.locked = true; return document })
    expect(await app.change(captionRef, { 'video_edit.caption.text': '不能覆盖锁定声音的字幕' })).toMatchObject({ ok: false })
  } finally { app.dispose() }
})

it('公共片段属性直接用检索候选关联标签，源片段移动时同事务跟随并可撤销', async () => {
  const owner = await fixture(); const id = owner.document.id; const sequence = owner.document.sequences[0]
  editVideoProject(id, document => { document = structuredClone(document);
    document.items.push({ id: 'label-item', name: '强调标签', kind: 'text' })
    document.sequences[0].tracks.push({ ...document.sequences[0].tracks.find(track => track.kind === 'video')!, id: 'label-track', index: 2, name: '包装' })
    document.sequences[0].clips.push({ ...makeVideoEditItemClip(document, 'label-item', sequence.id, { frame: 0, duration: 30, track: 2 }), id: 'label', text: '九元' })
    return document
  })
  const app = createApplicationHarness()
  const documentRef = { kind: 'video_edit.document', id }; const sequenceRef = { kind: 'video_edit.sequence', id: `${id}:${sequence.id}` }; const ref = { kind: 'video_edit.clip', id: `${id}:label` }
  try {
    const query = queryVideoEditTranscriptCapability.outputSchema.parse(await app.requireResult('query_video_edit_transcript', { documentRef, sequenceRef, text: '价格九元', matchSource: 'asr' }))
    const bound = await app.change(ref, { 'video_edit.clip.content_anchor': { matchId: query.matches[0].matchId } })
    expect(bound, JSON.stringify(bound)).toMatchObject({ ok: true })
    expect(owner.document.sequences[0].clips.find(clip => clip.id === 'label')).toMatchObject({ start: 30, duration: 30, contentAnchor: { ranges: [{ clipId: 'a', itemId: 'item' }] } })
    const before = structuredClone(owner.document.sequences)
    const moved = await app.change({ kind: 'video_edit.clip', id: `${id}:a` }, { 'video_edit.clip.start': 90 })
    expect(moved, JSON.stringify(moved)).toMatchObject({ ok: true })
    expect(owner.document.sequences[0].clips.find(clip => clip.id === 'label')!.start).toBe(120)
    expect(savedVideoEdit(owner).sequences[0].clips.find(clip => clip.id === 'label')!.start).toBe(120)
    undoVideoEdit(id); expect(owner.document.sequences).toEqual(before)
    undoVideoEdit(id, true)
    const reopened = await reopenVideoEdit(id)
    expect(reopened.document.sequences[0].clips.find(clip => clip.id === 'label')).toMatchObject({ start: 120, contentAnchor: { ranges: [{ clipId: 'a', itemId: 'item' }] } })
    const detached = await app.change(ref, { 'video_edit.clip.content_anchor': null })
    expect(detached, JSON.stringify(detached)).toMatchObject({ ok: true })
    expect(reopened.document.sequences[0].clips.find(clip => clip.id === 'label')).toMatchObject({ start: 120, duration: 30 })
    expect(reopened.document.sequences[0].clips.find(clip => clip.id === 'label')!.contentAnchor).toBeUndefined()
    expect(await app.change(ref, { 'video_edit.clip.content_anchor': { matchId: query.matches[0].matchId } })).toMatchObject({ ok: false })
  } finally { app.dispose() }
})

it('同一候选可关联多个包装，正文改变后拒绝旧候选；公共创建能就地建立关联', async () => {
  const owner = await fixture(); const id = owner.document.id; const sequence = owner.document.sequences[0]
  editVideoProject(id, document => { document = structuredClone(document); document.items.push({ id: 'label-item', name: '强调', kind: 'text' }); return document })
  const app = createApplicationHarness()
  const documentRef = { kind: 'video_edit.document', id }; const sequenceRef = { kind: 'video_edit.sequence', id: `${id}:${sequence.id}` }
  try {
    const query = queryVideoEditTranscriptCapability.outputSchema.parse(await app.requireResult('query_video_edit_transcript', { documentRef, sequenceRef, text: '价格九元', matchSource: 'asr' }))
    const anchor = { matchId: query.matches[0].matchId, startOffsetSeconds: -.1, endOffsetSeconds: .2 }
    const create = async (name: string) => {
      const baseline = await app.read(sequenceRef, ['video_edit.sequence.name'])
      return app.call('change_application_entities', { summary: '添加随句包装', changes: [{ kind: 'create_items', entityType: 'video_edit.clip', parent: sequenceRef, items: [{ properties: {
        'video_edit.clip.item_id': 'label-item', 'video_edit.clip.kind': 'text', 'video_edit.clip.name': name, 'video_edit.clip.text': name, 'video_edit.clip.track': 1, 'video_edit.clip.content_anchor': anchor,
      } }] }] }, baseline.revisions as Record<string, number>)
    }
    const first = await create('价格'); expect(first, JSON.stringify(first)).toMatchObject({ ok: true })
    const second = await create('促销'); expect(second, JSON.stringify(second)).toMatchObject({ ok: true })
    expect(owner.document.sequences[0].clips.filter(clip => clip.contentAnchor).map(clip => [clip.start, clip.duration])).toEqual([[27, 39], [27, 39]])
    const oldHistory = owner.past.length
    editVideoProject(id, document => { document = structuredClone(document); document.sequences[0].textTranscription!.sources[0].blocks[1].text = '已改价'; return document })
    const stale = await create('不应插入'); expect(stale).toMatchObject({ ok: false })
    expect(owner.past.length).toBe(oldHistory + 1)
  } finally { app.dispose() }
})

it.each(['set', 'create', 'manual'] as const)('%s内容关联在文件替换后拒绝旧词源，不留下部分关联', async mode => {
  const owner = await fixture(); const id = owner.document.id; const sequenceId = owner.document.sequences[0].id
  editVideoProject(id, document => { document = structuredClone(document);
    document.items.push({ id: 'label-item', name: '重点', kind: 'text' })
    document.sequences[0].tracks.push({ ...document.sequences[0].tracks.find(track => track.kind === 'video')!, id: 'label-track', index: 2 })
    document.sequences[0].clips.push({ ...makeVideoEditItemClip(document, 'label-item', sequenceId, { frame: 0, duration: 30, track: 2 }), id: 'label', text: '重点' })
    return document
  })
  const app = createApplicationHarness()
  const documentRef = { kind: 'video_edit.document', id }; const sequenceRef = { kind: 'video_edit.sequence', id: `${id}:${sequenceId}` }
  try {
    const query = queryVideoEditTranscriptCapability.outputSchema.parse(await app.requireResult('query_video_edit_transcript', { documentRef, sequenceRef, text: '价格九元', matchSource: 'asr' }))
    const before = owner.document; const history = owner.past.length
    vi.mocked(getPlatform().assetLibrary.inspectFileContent).mockResolvedValue({ ...fileContent, contentIdentity: 'b'.repeat(64) })
    if (mode === 'set') expect(await app.change({ kind: 'video_edit.clip', id: `${id}:label` }, { 'video_edit.clip.content_anchor': { matchId: query.matches[0].matchId } })).toMatchObject({ ok: false })
    else if (mode === 'create') {
      const baseline = await app.read(sequenceRef, ['video_edit.sequence.name'])
      expect(await app.call('change_application_entities', { summary: '关联重点', changes: [{ kind: 'create_items', entityType: 'video_edit.clip', parent: sequenceRef, items: [{ properties: { 'video_edit.clip.item_id': 'label-item', 'video_edit.clip.kind': 'text', 'video_edit.clip.name': '新重点', 'video_edit.clip.text': '新重点', 'video_edit.clip.track': 2, 'video_edit.clip.content_anchor': { matchId: query.matches[0].matchId } } }] }] }, baseline.revisions as Record<string, number>)).toMatchObject({ ok: false })
    } else await expect(bindVideoEditClipsToWords(id, sequenceId, ['label'], [{ start: 1, end: 1 }], before.sequences[0])).rejects.toThrow('重新定位')
    expect(owner.document.sequences).toEqual(before.sequences); expect(owner.past.length).toBe(history)
  } finally { app.dispose() }
})

it('原文件失效也能解除已有内容关联，不再读取失效文件', async () => {
  const owner = await fixture(); const id = owner.document.id; const sequenceId = owner.document.sequences[0].id
  editVideoProject(id, document => { document = structuredClone(document);
    document.items.push({ id: 'label-item', name: '重点', kind: 'text' })
    document.sequences[0].tracks.push({ ...document.sequences[0].tracks.find(track => track.kind === 'video')!, id: 'label-track', index: 2 })
    document.sequences[0].clips.push({ ...makeVideoEditItemClip(document, 'label-item', sequenceId, { frame: 30, duration: 30, track: 2 }), id: 'label', text: '重点', contentAnchor: { ranges: [{ clipId: 'a', itemId: 'item', fromUs: 1000000, toUs: 2000000 }], startOffsetSeconds: 0, endOffsetSeconds: 0 } })
    return document
  })
  const inspect = vi.mocked(getPlatform().assetLibrary.inspectFileContent).mockRejectedValue(new Error('原文件丢失')); inspect.mockClear()
  const app = createApplicationHarness()
  try {
    expect(await app.change({ kind: 'video_edit.clip', id: `${id}:label` }, { 'video_edit.clip.content_anchor': null })).toMatchObject({ ok: true })
    expect(owner.document.sequences[0].clips.find(clip => clip.id === 'label')!.contentAnchor).toBeUndefined()
    expect(inspect).not.toHaveBeenCalled()
  } finally { app.dispose() }
})

it('公共关联等待核对时的人工编辑保留，旧属性事务不覆盖新内容', async () => {
  const owner = await fixture(); const id = owner.document.id; const sequenceId = owner.document.sequences[0].id
  editVideoProject(id, document => { document = structuredClone(document);
    document.items.push({ id: 'label-item', name: '重点', kind: 'text' })
    document.sequences[0].tracks.push({ ...document.sequences[0].tracks.find(track => track.kind === 'video')!, id: 'label-track', index: 2 })
    document.sequences[0].clips.push({ ...makeVideoEditItemClip(document, 'label-item', sequenceId, { frame: 0, duration: 30, track: 2 }), id: 'label', text: '重点' })
    return document
  })
  const history = owner.past.length; const app = createApplicationHarness()
  vi.mocked(getPlatform().assetLibrary.inspectFileContent).mockImplementationOnce(async () => {
    editVideoProject(id, document => { document = structuredClone(document); document.sequences[0].name = '核对期间人工编辑'; return document })
    return fileContent
  })
  try {
    expect(await app.change({ kind: 'video_edit.clip', id: `${id}:label` }, { 'video_edit.clip.content_anchor': { ranges: [{ clipId: 'a', itemId: 'item', fromUs: 1000000, toUs: 2000000 }] } })).toMatchObject({ ok: false })
    expect(owner.document.sequences[0].name).toBe('核对期间人工编辑')
    expect(owner.document.sequences[0].clips.find(clip => clip.id === 'label')!.contentAnchor).toBeUndefined()
    expect(owner.past.length).toBe(history + 1)
  } finally { app.dispose() }
})
