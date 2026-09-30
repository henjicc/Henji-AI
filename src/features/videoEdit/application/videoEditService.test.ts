// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { getPlatform } from '@/platform/runtime'
import { createVideoEditProject, appendVideoEditClip, appendVideoEditMedia, closeVideoEditProject, editVideoProject, listVideoEditInstances, openVideoEditProject, saveVideoEdit, undoVideoEdit, videoEditDomainRevision, setVideoEditView, subscribeVideoEdit, subscribeVideoEditView } from './videoEditService'
import { splitVideoEditClip, clipSourceSeconds, adjustVideoEditClip } from '@/core/videoEdit/document'
import { dropVideoEditPaths, videoEditDropPaths } from './videoEditDrop'
import { importVideoEditPaths, sameVideoEditMediaPath } from './videoEditMedia'

const files = new Map<string, string>()
let failSave = false
it('素材库规范化的 Windows 路径与原引用是同一素材，拖放不增加导入历史', async () => {
  const instance = (await createVideoEditProject())!
  const media = { id: 'picture', name: 'Card.png', path: 'D:/Media/Card.png', kind: 'image' as const, width: 320, height: 180, durationSeconds: 0 }
  appendVideoEditMedia(instance.document.id, media)
  const before = instance.past.length
  await importVideoEditPaths(instance.document.id, ['d:\\media\\card.png'])
  await dropVideoEditPaths(instance.document.id, ['d:/media/card.png'], { frame: 12, track: 2 })
  expect(instance.document.media).toEqual([media])
  expect(instance.document.clips[0]).toMatchObject({ mediaId: media.id, start: 12, track: 2 })
  expect(instance.past.length).toBe(before + 1)
  undoVideoEdit(instance.document.id); expect(instance.document.clips).toHaveLength(0)
  expect(sameVideoEditMediaPath('/media/Card.png', '/media/card.png')).toBe(false)
})
beforeEach(() => {
  installHarnessNativeStorage(); files.clear(); failSave = false
  const platform = getPlatform()
  vi.spyOn(platform.system.dialog, 'save').mockResolvedValue('D:/fixture/test.henji-video')
  vi.spyOn(platform.system.fs, 'writeTextFile').mockImplementation(async (path, value) => { if (failSave) throw new Error('disk full'); files.set(path, value) })
  vi.spyOn(platform.system.fs, 'readTextFile').mockImplementation(async path => { const value = files.get(path); if (!value) throw new Error('missing'); return value })
})
afterEach(async () => { failSave = false; for (const instance of listVideoEditInstances()) await closeVideoEditProject(instance.document.id); vi.restoreAllMocks(); uninstallHarnessNativeStorage() })

it('公共修改与手动编辑共用历史并可保存重开', async () => {
  const instance = (await createVideoEditProject())!
  appendVideoEditClip(instance.document.id)
  const clip = instance.document.clips[0]
  const app = createApplicationHarness()
  try {
    const ref = { kind: 'video_edit.clip', id: `${instance.document.id}:${clip.id}` }
    const result = await app.change(ref, { 'video_edit.clip.text': '助手修改', 'video_edit.clip.brightness': 0.7 })
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true })
    expect((await app.read(ref, ['video_edit.clip.text', 'video_edit.clip.brightness'])).properties).toMatchObject({ 'video_edit.clip.text': '助手修改', 'video_edit.clip.brightness': 0.7 })
    expect(instance.past).toHaveLength(2)
    undoVideoEdit(instance.document.id)
    expect(instance.document.clips[0].text).toBe('输入文字')
    await saveVideoEdit(instance.document.id)
    await closeVideoEditProject(instance.document.id)
    const restored = (await openVideoEditProject('D:/fixture/test.henji-video'))!
    expect(restored.document.clips).toHaveLength(1)
    expect(restored.document.clips[0].text).toBe('输入文字')
  } finally { app.dispose() }
})
it('保存失败保留助手修改且恢复不会重放编辑', async () => {
  const instance = (await createVideoEditProject())!
  const app = createApplicationHarness()
  try {
    failSave = true
    const result = await app.change({ kind: 'video_edit.project', id: instance.document.id }, { 'video_edit.project.name': '保留修改' })
    expect(result.ok).toBe(false)
    expect(instance.document.name).toBe('保留修改'); expect(instance.dirty).toBe(true)
    const historyLength = instance.past.length
    failSave = false; await saveVideoEdit(instance.document.id)
    expect(instance.past).toHaveLength(historyLength)
    expect(JSON.parse(files.get(instance.path)!).name).toBe('保留修改')
  } finally { app.dispose() }
})
it('公共集合新增标注并拒绝跨工程引用', async () => {
  const instance = (await createVideoEditProject())!; appendVideoEditClip(instance.document.id)
  const app = createApplicationHarness()
  try {
    const ref = { kind: 'video_edit.project', id: instance.document.id }
    const baseline = await app.read(ref)
    const result = await app.call('change_application_entities', { summary: '添加时间标注', changes: [{ kind: 'create_items', entityType: 'video_edit.annotation', parent: ref, items: [{ properties: { 'video_edit.annotation.clip_id': instance.document.clips[0].id, 'video_edit.annotation.text': '检查此处' } }] }] }, baseline.revisions as Record<string, number>)
    expect(result).toMatchObject({ ok: true }); expect(instance.document.annotations[0].text).toBe('检查此处')
    const mark = instance.document.annotations[0]
    const rejected = await app.change({ kind: 'video_edit.annotation', id: `${instance.document.id}:${mark.id}` }, { 'video_edit.annotation.clip_id': 'another-project-clip' })
    expect(rejected.ok).toBe(false)
    expect(instance.document.annotations[0].clipId).toBe(instance.document.clips[0].id)
  } finally { app.dispose() }
})
it('保存中发生新修改时继续写入最新版本而不提前清除脏状态', async () => {
  const instance = (await createVideoEditProject())!
  editVideoProject(instance.document.id, document => ({ ...document, name: '第一版' }))
  let unblock!: () => void
  const blocked = new Promise<void>(resolve => { unblock = resolve })
  vi.mocked(getPlatform().system.fs.writeTextFile).mockImplementationOnce(async (path, value) => { await blocked; files.set(path, value) })
  const saving = saveVideoEdit(instance.document.id)
  editVideoProject(instance.document.id, document => ({ ...document, name: '保存期间的修改' }))
  expect(instance.dirty).toBe(true)
  unblock(); await saving
  expect(instance.dirty).toBe(false)
  expect(JSON.parse(files.get(instance.path)!).name).toBe('保存期间的修改')
})
it('播放位置不推进编辑并发版本，拆分保持源时间连续', async () => {
  const instance = (await createVideoEditProject())!; appendVideoEditClip(instance.document.id)
  const revision = videoEditDomainRevision()
  setVideoEditView(instance.document.id, { frame: 30 })
  expect(videoEditDomainRevision()).toBe(revision)
  const original = instance.document.clips[0]
  editVideoProject(instance.document.id, document => splitVideoEditClip(document, original.id, 30))
  const right = instance.document.clips[1]
  expect(clipSourceSeconds(right, right.start, 30)).toBe(clipSourceSeconds(original, 30, 30))
  expect(instance.document.clips.reduce((sum, clip) => sum + clip.duration, 0)).toBe(original.duration)
})
it('公共拆分从磁盘回读核实片段边界', async () => {
  const instance = (await createVideoEditProject())!; appendVideoEditClip(instance.document.id)
  const app = createApplicationHarness()
  try {
    const result = await app.requireResult('split_video_edit', { projectRef: { kind: 'video_edit.project', id: instance.document.id }, clipRef: { kind: 'video_edit.clip', id: `${instance.document.id}:${instance.document.clips[0].id}` }, frame: 30 })
    expect(result.verification).toMatchObject({ verified: true })
    const saved = JSON.parse(files.get(instance.path)!)
    expect(saved.clips.map((clip: { start: number; duration: number }) => [clip.start, clip.duration])).toEqual([[0, 30], [30, 60]])
  } finally { app.dispose() }
})

it('播放与拖动只通知瞬态叶子，相等写入不通知，也不污染历史或保存', async () => {
  const instance = (await createVideoEditProject())!; const id = instance.document.id
  const editor = vi.fn(); const view = vi.fn(); const offEditor = subscribeVideoEdit(editor); const offView = subscribeVideoEditView(view)
  const revision = videoEditDomainRevision()
  try {
    setVideoEditView(id, { frame: 15, scrubbing: true }); setVideoEditView(id, { frame: 15, scrubbing: true }); setVideoEditView(id, { scrubbing: false })
    expect(editor).not.toHaveBeenCalled(); expect(view).toHaveBeenCalledTimes(2)
    expect(videoEditDomainRevision()).toBe(revision); expect(instance.dirty).toBe(false); expect(instance.past).toHaveLength(0)
    await saveVideoEdit(id); expect(JSON.parse(files.get(instance.path)!)).not.toHaveProperty('scrubbing')
    editor.mockClear(); setVideoEditView(id, { selection: 'selected' }); expect(editor).toHaveBeenCalledOnce()
  } finally { offEditor(); offView() }
})
it('拖放固定到原工程与轨道，直接引用源路径，并复用撤销和磁盘保存', async () => {
  const a = (await createVideoEditProject())!
  const media = { id: 'original', name: 'image.png', kind: 'image' as const, path: 'E:/outside/image.png', durationSeconds: 0, width: 800, height: 600 }
  appendVideoEditMedia(a.document.id, media)
  const b = (await createVideoEditProject())!
  await dropVideoEditPaths(a.document.id, [media.path], { frame: 90, track: 4 })
  expect(a.document.clips[0]).toMatchObject({ mediaId: media.id, start: 90, track: 4 })
  expect(b.document.clips).toHaveLength(0); expect(a.document.media).toHaveLength(1)
  await saveVideoEdit(a.document.id); expect(JSON.parse(files.get(a.path)!).media[0].path).toBe(media.path)
  undoVideoEdit(a.document.id); expect(a.document.clips).toHaveLength(0); expect(a.document.media[0]).toEqual(media)
})
it('磁盘文件拖入只取 PAL 原始路径，禁止没有本地路径的内存文件', () => {
  const file = new File(['test'], 'video.mp4', { type: 'video/mp4' })
  const path = vi.spyOn(getPlatform().media, 'getPathForFile').mockReturnValue('E:/outside/video.mp4')
  const transfer = { files: [file], getData: () => '' } as unknown as DataTransfer
  expect(videoEditDropPaths(transfer)).toEqual(['E:/outside/video.mp4']); expect(path).toHaveBeenCalledWith(file)
  path.mockReturnValue(''); expect(() => videoEditDropPaths(transfer)).toThrow('本地文件')
})
it('裁剪即时预览和提交限制在源范围内，保持源时间与工程时间换算', async () => {
  const instance = (await createVideoEditProject())!
  appendVideoEditMedia(instance.document.id, { id: 'v', kind: 'video', path: 'E:/v.mp4', name: 'video', durationSeconds: 4, width: 3840, height: 2160 })
  appendVideoEditClip(instance.document.id, 'v', { frame: 30, track: 2 })
  const clip = { ...instance.document.clips[0], duration: 60, sourceInUs: 1000000 }
  const trimmed = adjustVideoEditClip(instance.document, clip, { mode: 'in', delta: -100, track: 2 })
  expect(trimmed).toMatchObject({ start: 0, duration: 90, sourceInUs: 0 })
  const extended = adjustVideoEditClip(instance.document, clip, { mode: 'out', delta: 1000, track: 2 })
  expect(extended.duration).toBe(90)
  expect(clipSourceSeconds(clip, 40, 30)).toBeCloseTo(clipSourceSeconds(trimmed, 40, 30))
})
