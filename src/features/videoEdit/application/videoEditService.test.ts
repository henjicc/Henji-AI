// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { getPlatform } from '@/platform/runtime'
import { createVideoEditProject, appendVideoEditClip, closeVideoEditProject, editVideoProject, listVideoEditInstances, openVideoEditProject, saveVideoEdit, undoVideoEdit, videoEditDomainRevision, setVideoEditView } from './videoEditService'
import { splitVideoEditClip, clipSourceSeconds } from '@/core/videoEdit/document'

const files = new Map<string, string>()
let failSave = false
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
