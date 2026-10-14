// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { screenAttentionFixture } from '@/tests/screenAttentionFixture'
import { makeVideoEditItemClip } from '@/core/videoEdit/projectItems'
import { screenAttentionSettingsSchema } from '@/core/videoEdit/screenAttention'
import { screenAttentionVideoEditCapability } from '@/core/application-control/domains/videoEdit/videoEditScreenAttentionCapability'
import { isVideoEditMotionKeyframe } from '@/core/videoEdit/keyframes'
import { createVideoEditTestProject, closeAllVideoEdits, savedVideoEdit, failVideoEditSaves, reopenVideoEdit } from './videoEditDocumentTestKit'
import { editVideoProject, saveVideoEdit, undoVideoEdit } from './videoEditService'
import { generateVideoEditScreenAttention } from './videoEditScreenAttention'
import { executeVideoEditScreenAttentionCapability } from './videoEditScreenAttentionCapability'
import { analyzeVideoEditScreenAttentionOffThread } from './videoEditScreenAttentionWorkerClient'
import { analyzeVideoEditScreenAttention } from '../engine/videoEditScreenAttentionAnalysis'
vi.mock('../engine/videoEditRenderSession', () => ({ VideoEditRenderSession: class { setTracks() {} async updateDocument() {} async present() { return { presented: true, bitmap: { close() {} } } } async dispose() {} } }))
vi.mock('./videoEditScreenAttentionWorkerClient', () => ({ analyzeVideoEditScreenAttentionOffThread: vi.fn() }))
const settings = screenAttentionSettingsSchema.parse({})
beforeEach(() => { installHarnessNativeStorage() })
afterEach(async () => { await closeAllVideoEdits(); vi.restoreAllMocks(); vi.clearAllMocks(); uninstallHarnessNativeStorage() })
async function fixture() {
  const log = await screenAttentionFixture(); const owner = await createVideoEditTestProject(); const id = owner.document.id
  vi.mocked(analyzeVideoEditScreenAttentionOffThread).mockImplementation((request, signal) => analyzeVideoEditScreenAttention(request, signal, async page => log.bytes.get(page.path)!))
  editVideoProject(id, document => {
    document.media.push({ id: 'screen', path: '/fixture/screen.mp4', name: '原片', kind: 'video', width: 1920, height: 1080, durationSeconds: 10, hasAudio: true, recordingCursor: log.source })
    document.items.push({ id: 'item', mediaId: 'screen', name: '原片', kind: 'video' })
    const sequence = document.sequences[0]; const base = makeVideoEditItemClip(document, 'item', sequence.id, { frame: 30, duration: 300 })
    sequence.clips = [{ ...base, id: 'clip', linkId: 'pair', groupId: 'group' }, { ...base, id: 'sound', kind: 'audio', sourceComponent: 'audio', track: sequence.tracks.find(t => t.kind === 'audio')!.index, linkId: 'pair' }]
    sequence.captions = [{ id: 'caption', clipId: 'clip', start: 50, duration: 20, text: '字幕' }]
    return document
  })
  const target = { projectId: id, sequenceId: owner.activeSequenceId, clipId: 'clip' }
  const input = screenAttentionVideoEditCapability.inputSchema.parse({ documentRef: { kind: 'video_edit.document', id }, clipRef: { kind: 'video_edit.clip', id: `${id}:clip` } })
  return { owner, id, target, input, log }
}
it('公共能力生成、通用读改读、重算保留手改与来源，保存重开和一步撤销', async () => {
  const { owner, id, input } = await fixture(); const app = createApplicationHarness()
  try {
    const history = owner.past.length
    expect(await app.requireResult(screenAttentionVideoEditCapability.id, input)).toMatchObject({ verified: true, created: false })
    expect(owner.past).toHaveLength(history + 1)
    const ref = input.clipRef!; const property = 'video_edit.clip.scale.keyframes'
    const read = await app.read(ref, [property]); const points = owner.document.sequences[0].clips[0].curves!.scale!
    expect(read).toMatchObject({ properties: { [property]: points } })
    const edited = points.map((value, i) => i === 2 ? { ...value, value: 1.65 } : value)
    const changed = await app.change(ref, { [property]: edited }); expect(changed, JSON.stringify(changed)).toMatchObject({ ok: true })
    const manual = owner.document.sequences[0].clips[0].curves!.scale![2]; expect(manual.source).toBeUndefined()
    const before = owner.document
    expect(await app.requireResult(screenAttentionVideoEditCapability.id, { ...input, settings: { ...settings, strength: 'light' } })).toMatchObject({ verified: true })
    expect(owner.document.sequences[0].clips[0].curves!.scale!.find(v => v.time === manual.time)).toEqual(manual)
    const expected = owner.document.sequences[0].clips[0].curves
    expect(savedVideoEdit(id).sequences[0].clips[0].curves).toEqual(expected)
    undoVideoEdit(id); expect(owner.document.sequences).toEqual(before.sequences)
    await saveVideoEdit(id); await reopenVideoEdit(id)
    expect(savedVideoEdit(id).sequences[0].clips[0].curves).toEqual(before.sequences[0].clips[0].curves)
  } finally { app.dispose() }
})
it('画幅复制保留原序列、音画链接、字幕与共用原片，既有导出可消费结果引用', async () => {
  const { owner, id, input } = await fixture(); const original = owner.document.sequences[0]
  const result = await executeVideoEditScreenAttentionCapability(screenAttentionVideoEditCapability.inputSchema.parse({ documentRef: input.documentRef, sequenceRef: { kind: 'video_edit.sequence', id: `${id}:${original.id}` }, targetSize: { width: 1080, height: 1920 } }))
  expect(result).toMatchObject({ created: true, verified: true }); expect(result.clipRefs).toHaveLength(1)
  expect(owner.document.sequences[0]).toEqual(original)
  const copy = owner.document.sequences[1]
  expect(copy.clips[0].linkId).toBe(copy.clips[1].linkId); expect(copy.captions![0].clipId).toBe(copy.clips[0].id)
  expect(copy.clips[0].itemId).toBe(original.clips[0].itemId)
  expect(copy.clips[1].curves).toEqual(original.clips[1].curves)
  undoVideoEdit(id); expect(owner.document.sequences).toHaveLength(1)
})
it('锁轨/运动停用、引用归属、缺日志与越界段落拒绝，不留下半成品', async () => {
  const { owner, id, input, target } = await fixture()
  await expect(executeVideoEditScreenAttentionCapability({ ...input, clipRef: { kind: 'video_edit.clip', id: 'foreign:clip' } })).rejects.toThrow('documentRef')
  editVideoProject(id, document => { document.sequences[0].tracks.forEach(t => { t.locked = true }); return document })
  await expect(generateVideoEditScreenAttention(target, { settings })).rejects.toThrow('锁定')
  editVideoProject(id, document => { document.sequences[0].tracks.forEach(t => { t.locked = false }); return document })
  editVideoProject(id, document => { document.sequences[0].clips[0].disabledIntrinsicSections = ['motion']; return document })
  await expect(generateVideoEditScreenAttention(target, { settings })).rejects.toThrow('启用')
  editVideoProject(id, document => { delete document.sequences[0].clips[0].disabledIntrinsicSections; return document })
  const history = owner.past.length
  await expect(generateVideoEditScreenAttention(target, { settings: { ...settings, sections: [{ startSeconds: 0, endSeconds: 11, strength: 'light' }] } })).rejects.toThrow('sections')
  expect(owner.past).toHaveLength(history)
  editVideoProject(id, document => { delete document.media[0].recordingCursor; return document })
  await expect(generateVideoEditScreenAttention(target, { settings })).rejects.toThrow('事件日志')
})
it('分析失败/取消/迟到修改不提交，保存失败只恢复保存；保留已有自动重构来源', async () => {
  const { owner, id, input, target } = await fixture(); const history = owner.past.length
  vi.mocked(analyzeVideoEditScreenAttentionOffThread).mockRejectedValueOnce(new Error('分析失败'))
  await expect(generateVideoEditScreenAttention(target, { settings })).rejects.toThrow('分析失败'); expect(owner.past).toHaveLength(history)
  const controller = new AbortController(); controller.abort(new Error('取消'))
  await expect(generateVideoEditScreenAttention(target, { settings }, controller.signal)).rejects.toThrow('取消'); expect(owner.past).toHaveLength(history)
  vi.mocked(analyzeVideoEditScreenAttentionOffThread).mockImplementationOnce(async request => {
    const result = { clip: request.composition.clips[0], quietFrames: 0, impreciseCapabilities: 0 }
    editVideoProject(id, document => { document.sequences[0].name = '用户修改'; return document }); return result
  })
  await expect(generateVideoEditScreenAttention(target, { settings })).rejects.toThrow('已改变')
  failVideoEditSaves(true)
  await expect(executeVideoEditScreenAttentionCapability(input)).rejects.toMatchObject({ facts: { recovery: { capabilityId: 'save_video_edit', replayMutation: false } } })
  expect(owner.document.sequences[0].clips[0].curves!.scale!.some(v => isVideoEditMotionKeyframe(v, 'screen_attention'))).toBe(true)
  const calls = vi.mocked(analyzeVideoEditScreenAttentionOffThread).mock.calls.length
  failVideoEditSaves(false); await saveVideoEdit(id)
  expect(analyzeVideoEditScreenAttentionOffThread).toHaveBeenCalledTimes(calls)
})
