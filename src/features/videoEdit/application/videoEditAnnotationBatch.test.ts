// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { useNavigationStore } from '@/stores/navigationStore'
import { videoEditTranscriptWords } from '@/core/videoEdit/textTranscript'
import { createVideoEditTestProject } from './videoEditDocumentTestKit'
import { createVideoEditAnnotation, reviewVideoEditAnnotation, undoVideoEditAnnotationChange, updateVideoEditAnnotation } from './videoEditAnnotations'
import { clearHandledVideoEditAnnotations, VIDEO_EDIT_ANNOTATION_USER, updateVideoEditAnnotationStatuses } from './videoEditAnnotationBatch'
import { appendVideoEditClip, closeVideoEditProject, editVideoProject, getActiveVideoEditSequence, listVideoEditInstances, subscribeVideoEditCommandFacts, undoVideoEdit, type VideoEditInstance } from './videoEditService'

vi.mock('@/core/videoEdit/textTranscript', async original => {
  const actual = await original<typeof import('@/core/videoEdit/textTranscript')>()
  return { ...actual, videoEditTranscriptWords: vi.fn(actual.videoEditTranscriptWords) }
})

beforeEach(() => { installHarnessNativeStorage(); useNavigationStore.getState().setActiveWorkspace('videoEdit') })
afterEach(async () => { for (const owner of listVideoEditInstances()) await closeVideoEditProject(owner.document.id); vi.restoreAllMocks(); uninstallHarnessNativeStorage() })

const annotate = (owner: VideoEditInstance, frame: number, extra: { clipId?: string; status?: 'draft' | 'open' } = {}) => createVideoEditAnnotation(owner.document.id, owner.activeSequenceId, { frame, target: { kind: 'point', x: .5, y: .5 }, text: `第 ${frame} 帧的问题`, status: 'open', ...extra })
const ref = (owner: VideoEditInstance, id: string) => ({ kind: 'video_edit.annotation', id: `${owner.document.id}:${id}` })
const marks = (owner: VideoEditInstance) => getActiveVideoEditSequence(owner).annotations

it('按条件批量处理 20 条批注只提交一次、撤销栈只多一步，撤销后 20 条一起回到原状态', async () => {
  const owner = await createVideoEditTestProject(); Array.from({ length: 20 }, (_, index) => annotate(owner, index))
  const app = createApplicationHarness(); let commits = 0
  const stop = subscribeVideoEditCommandFacts((_owner, fact) => { if (fact.phase === 'committed') commits++ })
  try {
    const past = owner.past.length
    const result = await app.requireResult('update_video_edit_annotations', { documentRef: { kind: 'video_edit.document', id: owner.document.id }, where: { statuses: ['open'] }, status: 'addressed', reply: '已统一处理' })
    expect(result.resultRefs).toHaveLength(20)
    expect(commits).toBe(1); expect(owner.past).toHaveLength(past + 1)
    expect(marks(owner).every(mark => mark.status === 'addressed' && mark.thread.at(-1)?.author.kind === 'assistant' && mark.addressedBy)).toBe(true)
    // 同一批处理共用一个处理关联，按批注撤销处理时整批一起回到待处理
    expect(new Set(marks(owner).map(mark => mark.addressedBy!.transactionId)).size).toBe(1)
    undoVideoEdit(owner.document.id)
    expect(marks(owner).every(mark => mark.status === 'open' && !mark.thread.length)).toBe(true)
  } finally { stop(); app.dispose() }
})

it('助手只能把已改完的写成已确认且必须附回复；必须写明从哪些状态改起，任一条不合规则整批不写并点名引用', async () => {
  const owner = await createVideoEditTestProject(); const id = owner.document.id; const done = annotate(owner, 0); const pending = annotate(owner, 5)
  const app = createApplicationHarness(); const documentRef = { kind: 'video_edit.document', id }
  try {
    const unscoped = await app.call('update_video_edit_annotations', { documentRef, where: {}, status: 'addressed', reply: '已处理' })
    expect(unscoped.ok).toBe(false); expect(JSON.stringify(unscoped)).toContain('statuses')
    expect((await app.change(ref(owner, done), { 'video_edit.annotation.status': 'addressed', 'video_edit.annotation.thread': [{ id: 'reply', author: { kind: 'assistant', name: '助手' }, createdAt: '2026-10-28T00:00:00.000Z', text: '已调亮' }] })).ok).toBe(true)
    const before = owner.document
    const missingReply = await app.call('update_video_edit_annotations', { documentRef, where: { statuses: ['addressed'] }, status: 'resolved' })
    expect(missingReply.ok).toBe(false); expect(JSON.stringify(missingReply)).toContain('追加一条助手回复'); expect(JSON.stringify(missingReply)).toContain(`${id}:${done}`)
    const notAddressed = await app.call('update_video_edit_annotations', { documentRef, where: { statuses: ['addressed', 'open'] }, status: 'resolved', reply: '用户在对话里确认通过' })
    expect(notAddressed.ok).toBe(false); expect(JSON.stringify(notAddressed)).toContain('只有已改完'); expect(JSON.stringify(notAddressed)).toContain(`${id}:${pending}`)
    expect(owner.document).toBe(before)
    expect((await app.call('update_video_edit_annotations', { documentRef, where: { statuses: ['addressed'] }, status: 'resolved', reply: '用户在对话里确认通过' })).ok).toBe(true)
    expect(marks(owner).find(mark => mark.id === done)).toMatchObject({ status: 'resolved' })
    // 驳回回到待处理并清掉处理关联
    expect((await app.call('update_video_edit_annotations', { documentRef, where: { statuses: ['resolved'] }, status: 'open', reply: '用户说还要再亮一点，重开' })).ok).toBe(true)
    expect(marks(owner).find(mark => mark.id === done)).toMatchObject({ status: 'open' }); expect(marks(owner).find(mark => mark.id === done)!.addressedBy).toBeUndefined()
  } finally { app.dispose() }
})

it('分页游标绑定查询时的文档修订，剪辑内容变化或游标非法都要求重新查询', async () => {
  const owner = await createVideoEditTestProject(); const id = owner.document.id; for (let frame = 0; frame < 3; frame++) annotate(owner, frame)
  const app = createApplicationHarness(); const documentRef = { kind: 'video_edit.document', id }
  try {
    const first = await app.requireResult('query_video_edit_annotations', { documentRef, limit: 2 })
    expect(first.refs).toHaveLength(2); expect(first.nextCursor).toEqual(expect.any(String))
    expect((await app.requireResult('query_video_edit_annotations', { documentRef, limit: 2, cursor: first.nextCursor })).refs).toHaveLength(1)
    expect(JSON.stringify(await app.call('query_video_edit_annotations', { documentRef, cursor: 'abc' }))).toContain('cursor 无效')
    annotate(owner, 9)
    expect(JSON.stringify(await app.call('query_video_edit_annotations', { documentRef, limit: 2, cursor: first.nextCursor }))).toContain('剪辑内容已变化')
  } finally { app.dispose() }
})

it('界面驳回走同一条规则清掉处理关联；直接改完的待发送草稿也能按批注撤销处理', async () => {
  const owner = await createVideoEditTestProject(); const id = owner.document.id; const markId = annotate(owner, 0, { status: 'draft' })
  const app = createApplicationHarness()
  try {
    expect((await app.change(ref(owner, markId), { 'video_edit.annotation.status': 'addressed', 'video_edit.annotation.thread': [{ id: 'reply', author: { kind: 'assistant', name: '助手' }, createdAt: '2026-10-28T00:00:00.000Z', text: '已改' }] })).ok).toBe(true)
    expect(marks(owner)[0].addressedBy).toBeDefined()
    undoVideoEditAnnotationChange(id, markId)
    expect(marks(owner)[0]).toMatchObject({ status: 'draft' }); expect(marks(owner)[0].addressedBy).toBeUndefined()
    expect((await app.change(ref(owner, markId), { 'video_edit.annotation.status': 'addressed', 'video_edit.annotation.thread': [{ id: 'reply', author: { kind: 'assistant', name: '助手' }, createdAt: '2026-10-28T00:00:00.000Z', text: '已改' }, { id: 'reply-2', author: { kind: 'assistant', name: '助手' }, createdAt: '2026-10-28T00:00:01.000Z', text: '再改一次' }] })).ok).toBe(true)
    reviewVideoEditAnnotation(id, markId, false, '还不行')
    expect(marks(owner)[0]).toMatchObject({ status: 'open' }); expect(marks(owner)[0].addressedBy).toBeUndefined(); expect(marks(owner)[0].thread.at(-1)).toMatchObject({ author: { kind: 'user' }, text: '还不行' })
  } finally { app.dispose() }
})

it('锁定轨道上片段挂的批注，界面、通用修改与批量能力都能改', async () => {
  const owner = await createVideoEditTestProject(); const id = owner.document.id; appendVideoEditClip(id)
  const clip = getActiveVideoEditSequence(owner).clips[0]; const markId = annotate(owner, 0, { clipId: clip.id })
  editVideoProject(id, document => ({ ...document, sequences: document.sequences.map(sequence => ({ ...sequence, tracks: sequence.tracks.map(track => track.index === clip.track ? { ...track, locked: true } : track) })) }))
  const app = createApplicationHarness()
  try {
    updateVideoEditAnnotation(id, markId, mark => ({ ...mark, text: '用户改了说明' }))
    expect((await app.change(ref(owner, markId), { 'video_edit.annotation.text': '助手改了说明' })).ok).toBe(true)
    expect((await app.call('update_video_edit_annotations', { documentRef: { kind: 'video_edit.document', id }, where: { statuses: ['open'], clipRefs: [{ kind: 'video_edit.clip', id: `${id}:${clip.id}` }] }, status: 'addressed', reply: '已处理' })).ok).toBe(true)
    expect(marks(owner)[0]).toMatchObject({ text: '助手改了说明', status: 'addressed' })
    expect(() => editVideoProject(id, document => ({ ...document, sequences: document.sequences.map(sequence => ({ ...sequence, clips: sequence.clips.map(value => ({ ...value, x: .3 })) })) }))).toThrow('锁定')
  } finally { app.dispose() }
})

it('清除已处理只删已改完与已确认，待发送与待处理保留，一步撤销', async () => {
  const owner = await createVideoEditTestProject(); const id = owner.document.id
  const draft = annotate(owner, 0, { status: 'draft' }); const open = annotate(owner, 1); const addressed = annotate(owner, 2); const resolved = annotate(owner, 3)
  updateVideoEditAnnotationStatuses(id, [{ id: addressed, status: 'addressed', reply: '改好了' }, { id: resolved, status: 'addressed', reply: '改好了' }], VIDEO_EDIT_ANNOTATION_USER)
  updateVideoEditAnnotationStatuses(id, [{ id: resolved, status: 'resolved', reply: '确认' }], VIDEO_EDIT_ANNOTATION_USER)
  const past = owner.past.length
  expect(clearHandledVideoEditAnnotations(id, owner.activeSequenceId).sort()).toEqual([addressed, resolved].sort())
  expect(marks(owner).map(mark => mark.id)).toEqual([draft, open]); expect(owner.past).toHaveLength(past + 1)
  undoVideoEdit(id); expect(marks(owner)).toHaveLength(4)
})

it('按条件查询后用查询结果删除并合并重复，剪辑里只剩保留的那条并附合并说明', async () => {
  const owner = await createVideoEditTestProject(); const id = owner.document.id; appendVideoEditClip(id)
  const clip = getActiveVideoEditSequence(owner).clips[0]
  const keep = annotate(owner, 10, { clipId: clip.id }); const duplicates = [annotate(owner, 12, { clipId: clip.id }), annotate(owner, 14, { clipId: clip.id })]; const other = annotate(owner, 90)
  const app = createApplicationHarness(); const documentRef = { kind: 'video_edit.document', id }
  try {
    const query = await app.requireResult('query_video_edit_annotations', { documentRef, where: { range: { fromFrame: 0, toFrame: 20 }, statuses: ['open'] } })
    expect(query.refs).toEqual([keep, ...duplicates].map(value => ref(owner, value))); expect(query.revisions).toHaveProperty('video_edit')
    const past = owner.past.length
    const removed = await app.requireResult('remove_video_edit_annotations', { documentRef, annotationRefs: duplicates.map(value => ref(owner, value)), mergeInto: ref(owner, keep), mergeNote: '三条说的是同一处' }, query.revisions as Record<string, number>)
    expect(removed.removedRefs).toHaveLength(2); expect(owner.past).toHaveLength(past + 1)
    expect(marks(owner).map(mark => mark.id)).toEqual([keep, other])
    expect(marks(owner)[0].thread.at(-1)!.text).toContain('三条说的是同一处'); expect(marks(owner)[0].thread.at(-1)!.text).toContain('第 12 帧的问题')
    const read = await app.read(ref(owner, keep), ['video_edit.annotation.thread'])
    expect(read.properties).toMatchObject({ 'video_edit.annotation.thread': [{ author: { kind: 'assistant' } }] })
  } finally { app.dispose() }
})

it('读取与删除时 propertyIds 为空只核对实体存在，不计算序列转写', async () => {
  const owner = await createVideoEditTestProject(); const id = owner.document.id; const markId = annotate(owner, 0)
  const app = createApplicationHarness(); const sequenceRef = { kind: 'video_edit.sequence', id: `${id}:${owner.activeSequenceId}` }
  try {
    vi.mocked(videoEditTranscriptWords).mockClear()
    const baseline = await app.read(sequenceRef, [])
    expect(baseline.properties).toEqual({})
    const response = await app.call('change_application_entities', { summary: '删除批注', changes: [{ kind: 'remove_items', entityType: 'video_edit.annotation', parent: sequenceRef, targets: [ref(owner, markId)] }] }, (await app.read(ref(owner, markId), [])).revisions as Record<string, number>)
    expect(response, JSON.stringify(response)).toMatchObject({ ok: true }); expect(marks(owner)).toHaveLength(0)
    expect(videoEditTranscriptWords).not.toHaveBeenCalled()
    await expect(app.read(ref(owner, markId), [])).rejects.toThrow('ENTITY_NOT_FOUND')
    await app.read(sequenceRef, ['video_edit.sequence.transcript']); expect(videoEditTranscriptWords).toHaveBeenCalled()
  } finally { app.dispose() }
})
