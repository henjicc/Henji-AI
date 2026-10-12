import { videoEditSubtitleStyleSchema } from '@/core/videoEdit/subtitleStyle'
import { createVideoEditTestProject as createVideoEditProject } from './videoEditDocumentTestKit'
// @vitest-environment jsdom
import { it, expect, beforeEach, afterEach, vi } from 'vitest'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { getPlatform } from '@/platform/runtime'
import { listVideoEditInstances, closeVideoEditProject, editVideoProject, appendVideoEditSequence, switchVideoEditSequence, saveVideoEdit, undoVideoEdit, duplicateVideoEditSequence } from './videoEditService'
import { makeVideoEditItemClip } from '@/core/videoEdit/projectItems'
import { createVideoEditCaption, createVideoEditMarker, appendVideoEditCaptionText, importVideoEditCaptionFile, exportVideoEditSubtitles, updateVideoEditTimedContent, updateVideoEditCaptionTrack, removeVideoEditTimedContent, moveVideoEditCaption } from './videoEditTimedContent'
import { videoEditCaptionClips } from '@/core/videoEdit/timedContent'
import { appendAutoSubtitles } from './videoEditAutoSubtitles'
import { executeVideoEditTimelineEdit } from './videoEditTimeline'
import { reopenVideoEdit } from './videoEditDocumentTestKit'
const files = new Map<string, string>()
beforeEach(() => {
  installHarnessNativeStorage(); files.clear()
  vi.spyOn(getPlatform().system.dialog, 'save').mockResolvedValue('D:/timed.henji-video')
  vi.spyOn(getPlatform().system.fs, 'writeTextFile').mockImplementation(async (path, value) => { files.set(path, value) })
  vi.spyOn(getPlatform().system.fs, 'readTextFile').mockImplementation(async path => files.get(path)!)
  vi.spyOn(getPlatform().system.fs, 'mkdir').mockResolvedValue(undefined)
  vi.spyOn(getPlatform().system.fs, 'exists').mockImplementation(async path => files.has(path))
})
afterEach(async () => { for (const owner of listVideoEditInstances()) await closeVideoEditProject(owner.document.id); vi.restoreAllMocks(); uninstallHarnessNativeStorage() })
async function fixture() {
  const owner = (await createVideoEditProject())!; const projectId = owner.document.id; const sequenceId = owner.activeSequenceId
  editVideoProject(projectId, document => {
    document.items.push({ id: 'text-item', name: '真实素材项', kind: 'text' })
    document.sequences[0].clips.push({ ...makeVideoEditItemClip(document, 'text-item', sequenceId, { frame: 0, track: 1 }), id: 'text-clip', duration: 90 })
    return document
  })
  return { owner, projectId, sequenceId }
}

it('字幕轨显示、锁定和编辑共用通用实体与撤销，锁轨拦截所有字幕写入', async () => {
  const { owner, projectId, sequenceId } = await fixture()
  const id = createVideoEditCaption(projectId, sequenceId, { start: 10, duration: 20, text: '字幕' })
  const app = createApplicationHarness()
  const target = { kind: 'video_edit.sequence', id: `${projectId}:${sequenceId}` }
  try {
    const baseline = await app.read(target)
    const result = await app.call('change_application_entities', { summary: '隐藏并锁定字幕', changes: [{ kind: 'set_properties', entityType: target.kind, target, properties: { 'video_edit.sequence.caption_track_enabled': false, 'video_edit.sequence.caption_track_locked': true } }] }, baseline.revisions as Record<string, number>)
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true })
    expect(videoEditCaptionClips(owner.document.sequences[0], 15)).toEqual([])
    expect(() => updateVideoEditTimedContent(projectId, sequenceId, 'caption', id, { text: '改字' })).toThrow('锁定')
    expect(() => removeVideoEditTimedContent(projectId, sequenceId, 'caption', [id])).toThrow('锁定')
    expect(() => createVideoEditCaption(projectId, sequenceId, { start: 50, duration: 10, text: '新增' })).toThrow('锁定')
    expect(() => moveVideoEditCaption(projectId, sequenceId, id, 'move', 2)).toThrow('锁定')
    const captionRef = { kind: 'video_edit.caption', id: `${projectId}:${id}` }
    const lockedBaseline = await app.read(captionRef)
    const rejected = await app.call('change_application_entities', { summary: '不能越过锁定', changes: [{ kind: 'set_properties', entityType: captionRef.kind, target: captionRef, properties: { 'video_edit.caption.text': '外部改字' } }] }, lockedBaseline.revisions as Record<string, number>)
    expect(rejected.ok).toBe(false)
    undoVideoEdit(projectId)
    expect(videoEditCaptionClips(owner.document.sequences[0], 15)).toHaveLength(1)
    const history = owner.past.length
    moveVideoEditCaption(projectId, sequenceId, id, 'move', 5)
    expect(owner.document.sequences[0].captions![0].start).toBe(15)
    expect(owner.past).toHaveLength(history + 1)
    undoVideoEdit(projectId)
    expect(owner.document.sequences[0].captions![0].start).toBe(10)
    updateVideoEditCaptionTrack(projectId, sequenceId, { captionTrackLocked: true })
    updateVideoEditCaptionTrack(projectId, sequenceId, { captionTrackLocked: false })
    removeVideoEditTimedContent(projectId, sequenceId, 'caption', [id])
    expect(owner.document.sequences[0].captions).toEqual([])
  } finally { app.dispose() }
})

it('手工、通用实体、导入和生成共用邻近样式；显式空样式保留', async () => {
  const { owner, projectId, sequenceId } = await fixture()
  const style = videoEditSubtitleStyleSchema.parse({ fontSize: 72 })
  createVideoEditCaption(projectId, sequenceId, { start: 0, duration: 30, text: '片段样式', clipId: 'text-clip', style })
  createVideoEditCaption(projectId, sequenceId, { start: 35, duration: 5, text: '其他样式', style: videoEditSubtitleStyleSchema.parse({ fontSize: 20 }) })
  const manual = createVideoEditCaption(projectId, sequenceId, { start: 40, duration: 10, text: '手工', clipId: 'text-clip' })
  const imported = appendVideoEditCaptionText(projectId, sequenceId, '1\n00:00:01,400 --> 00:00:01,800\n导入', { clipId: 'text-clip' })[0]
  appendAutoSubtitles(projectId, sequenceId, [{ id: 'generated', start: 45, duration: 5, text: '生成', clipId: 'text-clip' }])
  const empty = createVideoEditCaption(projectId, sequenceId, { start: 50, duration: 5, text: '不设样式', style: '' })
  const app = createApplicationHarness()
  try {
    const parent = { kind: 'video_edit.sequence', id: `${projectId}:${sequenceId}` }
    const baseline = await app.read(parent)
    const result = await app.call('change_application_entities', { summary: '创建同样式字幕', changes: [{ kind: 'create_items', entityType: 'video_edit.caption', parent, items: [{ properties: { 'video_edit.caption.start': 55, 'video_edit.caption.duration': 5, 'video_edit.caption.text': '通用', 'video_edit.caption.clip_id': 'text-clip' } }] }] }, baseline.revisions as Record<string, number>)
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true })
    const captions = owner.document.sequences[0].captions!
    for (const id of [manual, imported, 'generated', captions.find(caption => caption.text === '通用')!.id]) expect(captions.find(caption => caption.id === id)?.style).toEqual(style)
    expect(captions.find(caption => caption.id === empty)?.style).toBe('')
  } finally { app.dispose() }
})

it('通用字幕/标记集合、修改、片段级联和手动撤销保存重开共用正式事务', async () => {
  const { owner, projectId, sequenceId } = await fixture(); const app = createApplicationHarness()
  try {
    const parent = { kind: 'video_edit.sequence', id: `${projectId}:${sequenceId}` }; const baseline = await app.read(parent)
    const history = owner.past.length
    const result = await app.call('change_application_entities', { summary: '写入真实字幕和标记', changes: [
      { kind: 'create_items', entityType: 'video_edit.caption', parent, items: [{ properties: { 'video_edit.caption.start': 15, 'video_edit.caption.duration': 30, 'video_edit.caption.text': '真实字幕', 'video_edit.caption.clip_id': 'text-clip' } }] },
      { kind: 'create_items', entityType: 'video_edit.marker', parent, items: [{ properties: { 'video_edit.marker.frame': 30, 'video_edit.marker.name': '段落', 'video_edit.marker.clip_id': 'text-clip' } }] },
    ] }, baseline.revisions as Record<string, number>)
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true }); expect(owner.past).toHaveLength(history + 1)
    const caption = owner.document.sequences[0].captions![0]; const marker = owner.document.sequences[0].markers![0]
    // 未传样式的新字幕得到默认字幕样式，而不是留空走另一套文字呈现。
    expect(caption.style).toEqual(videoEditSubtitleStyleSchema.parse({}))
    const clipRef = { kind: 'video_edit.clip', id: `${projectId}:text-clip` }
    const moved = await app.change(clipRef, { 'video_edit.clip.start': 60 })
    expect(moved, JSON.stringify(moved)).toMatchObject({ ok: true })
    expect(owner.document.sequences[0].captions![0].start).toBe(75); expect(owner.document.sequences[0].markers![0].frame).toBe(90)
    expect(await app.read({ kind: 'video_edit.caption', id: `${projectId}:${caption.id}` }, ['video_edit.caption.start', 'video_edit.caption.text'])).toMatchObject({ properties: { 'video_edit.caption.start': 75, 'video_edit.caption.text': '真实字幕' } })
    undoVideoEdit(projectId); expect(owner.document.sequences[0].captions![0].start).toBe(15)
    const detached = await app.change({ kind: 'video_edit.marker', id: `${projectId}:${marker.id}` }, { 'video_edit.marker.clip_id': '' })
    expect(detached, JSON.stringify(detached)).toMatchObject({ ok: true }); expect(owner.document.sequences[0].markers![0].clipId).toBeUndefined()
    await saveVideoEdit(projectId); const snapshot = structuredClone(owner.document)
    const reopened = await reopenVideoEdit(projectId); expect(reopened.document).toEqual({ ...snapshot, revision: 0 })
  } finally { app.dispose() }
})

it('锁定字幕/标记编辑拒绝，复制序列建立唯一内容ID，拆分和撤销无悬挂引用', async () => {
  const { owner, projectId, sequenceId } = await fixture()
  const captionId = createVideoEditCaption(projectId, sequenceId, { clipId: 'text-clip', start: 15, duration: 45, text: '原片段字幕' })
  createVideoEditMarker(projectId, sequenceId, { clipId: 'text-clip', frame: 30, name: '边界' })
  executeVideoEditTimelineEdit(projectId, sequenceId, { kind: 'split', clipIds: ['text-clip'], frame: 30 })
  expect(owner.document.sequences[0].captions).toHaveLength(2); undoVideoEdit(projectId); expect(owner.document.sequences[0].captions).toHaveLength(1)
  const duplicate = duplicateVideoEditSequence(projectId, sequenceId)
  const copied = owner.document.sequences.find(sequence => sequence.id === duplicate)!
  expect(copied.captions![0].id).not.toBe(captionId); expect(copied.captions![0].clipId).toBe(copied.clips[0].id)
  editVideoProject(projectId, document => { document.sequences[0].tracks[1].locked = true; return document })
  expect(() => updateVideoEditTimedContent(projectId, sequenceId, 'caption', captionId, { text: '试图写入' })).toThrow('锁定')
  expect(owner.document.sequences[0].captions![0].text).toBe('原片段字幕')
})

it('公共静态片段入点裁剪与手动裁剪同样保留原内容时刻', async () => {
  const { owner, projectId, sequenceId } = await fixture()
  createVideoEditCaption(projectId, sequenceId, { clipId: 'text-clip', start: 15, duration: 45, text: '原源范围' })
  createVideoEditMarker(projectId, sequenceId, { clipId: 'text-clip', frame: 30, name: '起点' })
  const app = createApplicationHarness()
  try {
    const result = await app.change({ kind: 'video_edit.clip', id: `${projectId}:text-clip` }, { 'video_edit.clip.start': 30, 'video_edit.clip.duration': 60 })
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true })
    expect(owner.document.sequences[0].captions![0]).toMatchObject({ start: 30, duration: 30 }); expect(owner.document.sequences[0].markers![0].frame).toBe(30)
  } finally { app.dispose() }
})

it('异步文件导入绑定原序列，切序列不重定向，新修改或重新打开使结果失效', async () => {
  const { owner, projectId, sequenceId } = await fixture(); const second = appendVideoEditSequence(projectId)
  vi.spyOn(getPlatform().system.dialog, 'open').mockResolvedValue('D:/captions.srt')
  let resolve!: (value: string) => void
  vi.mocked(getPlatform().system.fs.readTextFile).mockImplementationOnce(() => new Promise<string>(done => { resolve = done }))
  const pending = importVideoEditCaptionFile(projectId, sequenceId)
  await vi.waitFor(() => expect(resolve).toBeTypeOf('function')); switchVideoEditSequence(projectId, second)
  resolve('1\n00:00:00,500 --> 00:00:01,500\n原序列')
  await pending; expect(owner.document.sequences[0].captions).toHaveLength(1); expect(owner.document.sequences[1].captions).toBeUndefined()
  vi.mocked(getPlatform().system.fs.readTextFile).mockImplementationOnce(() => new Promise<string>(done => { resolve = done }))
  const stale = importVideoEditCaptionFile(projectId, sequenceId); const rejection = expect(stale).rejects.toThrow('新修改')
  await vi.waitFor(() => expect(vi.mocked(getPlatform().system.fs.readTextFile)).toHaveBeenCalledTimes(2))
  createVideoEditMarker(projectId, sequenceId, { frame: 10, name: '后续编辑' }); resolve('1\n00:00:00,500 --> 00:00:01,500\n迟到')
  await rejection; expect(owner.document.sequences[0].captions).toHaveLength(1)
})

it('手动与公共导出复用原快照/原文件回读，取消和错误不假报成功', async () => {
  const { projectId, sequenceId } = await fixture(); createVideoEditCaption(projectId, sequenceId, { start: 15, duration: 30, text: '中<文&字幕' })
  vi.mocked(getPlatform().system.dialog.save).mockResolvedValue('D:/subtitle.vtt')
  const app = createApplicationHarness()
  try {
    const output = await app.call('export_video_edit', { documentRef: { kind: 'video_edit.document', id: projectId }, format: 'vtt' })
    expect(output, JSON.stringify(output)).toMatchObject({ ok: true, data: { verification: { verified: true } } })
    // 公共能力不弹保存对话框，写进项目“导出”文件夹。
    expect(getPlatform().system.dialog.save).not.toHaveBeenCalled()
    const vtt = [...files.keys()].find(path => /导出[\\/][^\\/]+\.vtt$/.test(path))!
    expect(files.get(vtt)).toContain('00:00:00.500 --> 00:00:01.500'); expect(files.get(vtt)).toContain('中&lt;文&amp;字幕')
    vi.mocked(getPlatform().system.dialog.save).mockResolvedValue(null)
    expect(await exportVideoEditSubtitles(projectId, 'srt')).toEqual({ saved: false, verified: false })
    vi.mocked(getPlatform().system.dialog.save).mockResolvedValue('D:/original.henji-video')
    await expect(exportVideoEditSubtitles(projectId, 'srt')).rejects.toThrow('.srt')
  } finally { app.dispose() }
})

it('字幕输出晚到时文件属于原快照，回执拒绝指认重新打开的会话', async () => {
  const { projectId, sequenceId, owner } = await fixture(); createVideoEditCaption(projectId, sequenceId, { start: 15, duration: 30, text: '原会话' })
  await saveVideoEdit(projectId)
  vi.mocked(getPlatform().system.dialog.save).mockResolvedValue('D:/late.srt')
  let finish!: () => void
  vi.mocked(getPlatform().system.fs.writeTextFile).mockImplementation(async (path, text) => {
    files.set(path, text)
    if (path.endsWith('.srt')) await new Promise<void>(resolve => { finish = resolve })
  })
  const pending = exportVideoEditSubtitles(projectId, 'srt'); const rejected = expect(pending).rejects.toThrow('原剪辑会话已关闭')
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
  await closeVideoEditProject(projectId); const reopened = await reopenVideoEdit(owner.document.id)
  finish(); await rejected
  expect(reopened.document.sequences[0].captions![0].text).toBe('原会话'); expect(files.get('D:/late.srt')).toContain('原会话')
})
it('字幕面板取消文件读取后不追加；取消保存对话框后不写输出', async () => {
  const { owner, projectId, sequenceId } = await fixture()
  vi.spyOn(getPlatform().system.dialog, 'open').mockResolvedValue('D:/cancel.srt')
  let read!: (text: string) => void; vi.mocked(getPlatform().system.fs.readTextFile).mockImplementationOnce(() => new Promise(resolve => { read = resolve }))
  const controller = new AbortController(); const pending = importVideoEditCaptionFile(projectId, sequenceId, {}, controller.signal); const rejected = expect(pending).rejects.toThrow('视图取消')
  await vi.waitFor(() => expect(read).toBeTypeOf('function')); controller.abort(new Error('视图取消')); read('1\n00:00:00,000 --> 00:00:01,000\n迟到')
  await rejected; expect(owner.document.sequences[0].captions).toBeUndefined()
  createVideoEditCaption(projectId, sequenceId, { start: 0, duration: 30, text: '真实字幕' })
  let choose!: (path: string) => void; vi.mocked(getPlatform().system.dialog.save).mockImplementationOnce(() => new Promise(resolve => { choose = resolve }))
  const cancel = new AbortController(); const output = exportVideoEditSubtitles(projectId, 'srt', sequenceId, cancel.signal); const failed = expect(output).rejects.toThrow('视图取消')
  cancel.abort(new Error('视图取消')); choose('D:/cancel.srt'); await failed; expect(files.has('D:/cancel.srt')).toBe(false)
})
