// @vitest-environment jsdom
import { it, expect, beforeEach, afterEach, vi } from 'vitest'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { getPlatform } from '@/platform/runtime'
import { createVideoEditProject, listVideoEditInstances, closeVideoEditProject, editVideoProject, appendVideoEditSequence, switchVideoEditSequence, saveVideoEdit, openVideoEditProject, undoVideoEdit, duplicateVideoEditSequence } from './videoEditService'
import { makeVideoEditItemClip } from '@/core/videoEdit/projectItems'
import { createVideoEditCaption, createVideoEditMarker, importVideoEditCaptionFile, exportVideoEditSubtitles, updateVideoEditTimedContent } from './videoEditTimedContent'
import { executeVideoEditTimelineEdit } from './videoEditTimeline'
const files = new Map<string, string>()
beforeEach(() => {
  installHarnessNativeStorage(); files.clear()
  vi.spyOn(getPlatform().system.dialog, 'save').mockResolvedValue('D:/timed.henji-video')
  vi.spyOn(getPlatform().system.fs, 'writeTextFile').mockImplementation(async (path, value) => { files.set(path, value) })
  vi.spyOn(getPlatform().system.fs, 'readTextFile').mockImplementation(async path => files.get(path)!)
})
afterEach(async () => { for (const owner of listVideoEditInstances()) await closeVideoEditProject(owner.document.id); vi.restoreAllMocks(); uninstallHarnessNativeStorage() })
async function fixture() {
  const owner = (await createVideoEditProject())!; const projectId = owner.document.id; const sequenceId = owner.activeSequenceId
  editVideoProject(projectId, document => {
    document.items.push({ id: 'text-item', name: '真实项目项', kind: 'text' })
    document.sequences[0].clips.push({ ...makeVideoEditItemClip(document, 'text-item', sequenceId, { frame: 0, track: 1 }), id: 'text-clip', duration: 90 })
    return document
  })
  return { owner, projectId, sequenceId }
}

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
    const clipRef = { kind: 'video_edit.clip', id: `${projectId}:text-clip` }
    const moved = await app.change(clipRef, { 'video_edit.clip.start': 60 })
    expect(moved, JSON.stringify(moved)).toMatchObject({ ok: true })
    expect(owner.document.sequences[0].captions![0].start).toBe(75); expect(owner.document.sequences[0].markers![0].frame).toBe(90)
    expect(await app.read({ kind: 'video_edit.caption', id: `${projectId}:${caption.id}` }, ['video_edit.caption.start', 'video_edit.caption.text'])).toMatchObject({ properties: { 'video_edit.caption.start': 75, 'video_edit.caption.text': '真实字幕' } })
    undoVideoEdit(projectId); expect(owner.document.sequences[0].captions![0].start).toBe(15)
    const detached = await app.change({ kind: 'video_edit.marker', id: `${projectId}:${marker.id}` }, { 'video_edit.marker.clip_id': '' })
    expect(detached, JSON.stringify(detached)).toMatchObject({ ok: true }); expect(owner.document.sequences[0].markers![0].clipId).toBeUndefined()
    await saveVideoEdit(projectId); const snapshot = structuredClone(owner.document); await closeVideoEditProject(projectId)
    const reopened = (await openVideoEditProject('D:/timed.henji-video'))!; expect(reopened.document).toEqual(snapshot)
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
    const output = await app.call('export_video_edit', { projectRef: { kind: 'video_edit.project', id: projectId }, format: 'vtt' })
    expect(output, JSON.stringify(output)).toMatchObject({ ok: true, data: { verification: { verified: true } } })
    expect(files.get('D:/subtitle.vtt')).toContain('00:00:00.500 --> 00:00:01.500'); expect(files.get('D:/subtitle.vtt')).toContain('中&lt;文&amp;字幕')
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
  const pending = exportVideoEditSubtitles(projectId, 'srt'); const rejected = expect(pending).rejects.toThrow('原工程会话已关闭')
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
  await closeVideoEditProject(projectId); const reopened = (await openVideoEditProject(owner.path))!
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
