// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { createApplicationCallerGrant } from '@/core/application-control/callerContext'
import { createApplicationCapabilitySession } from '@/features/application-control/applicationCapabilityService'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { getPlatform } from '@/platform/runtime'
import { useNavigationStore } from '@/stores/navigationStore'
import { useAssistantUiStore } from '@/features/assistant/store/assistantUiStore'
import { createVideoEditTestProject } from './videoEditDocumentTestKit'
import { createVideoEditAnnotation, deleteVideoEditAnnotation, reviewVideoEditAnnotation, sendVideoEditAnnotations, undoVideoEditAnnotationChange, updateVideoEditAnnotation } from './videoEditAnnotations'
import { appendVideoEditClip, closeVideoEditProject, getActiveVideoEditSequence, listVideoEditInstances, undoVideoEdit } from './videoEditService'

beforeEach(() => { installHarnessNativeStorage(); vi.spyOn(getPlatform().system.dialog, 'save').mockResolvedValue('D:/annotations.henji-video'); vi.spyOn(getPlatform().system.fs, 'writeTextFile').mockResolvedValue(undefined) })
afterEach(async () => { for (const owner of listVideoEditInstances()) await closeVideoEditProject(owner.document.id); useAssistantUiStore.getState().setPendingGoal(null); vi.restoreAllMocks(); uninstallHarnessNativeStorage() })
it('外部公共入口发现/回读标注与thread，拒绝越权通过；内容+回复+addressed原子一步撤销回open', async () => {
  const owner = await createVideoEditTestProject(); const id = owner.document.id; appendVideoEditClip(id)
  const clip = getActiveVideoEditSequence(owner).clips[0]
  const markId = createVideoEditAnnotation(id, owner.activeSequenceId, { frame: 0, clipId: clip.id, target: { kind: 'region', x: .1, y: .2, width: .3, height: .4 }, text: '移到右侧', status: 'open' })
  useNavigationStore.getState().setActiveWorkspace('videoEdit')
  const app = createApplicationHarness(); const ref = { kind: 'video_edit.annotation', id: `${id}:${markId}` }
  try {
    const listed = await app.requireResult('list_application_entities', { entityType: 'video_edit.annotation' }); expect(JSON.stringify(listed)).toContain(markId)
    const context = await app.requireResult('get_current_application_context', {}); expect(JSON.stringify(context)).toContain(markId)
    const restricted = createApplicationCapabilitySession(createApplicationCallerGrant({ callerId: 'context-only', capabilityIds: ['get_current_application_context'], permissions: ['application:read'], allowWrites: false, allowDestructive: false }))
    const limited = await restricted.execute({ id: 'get_current_application_context', version: 1, input: {} }, { requestId: 'restricted-context', signal: new AbortController().signal }); expect(limited.ok).toBe(true); expect(JSON.stringify(limited)).not.toContain(markId)
    const past = owner.past.length
    const response = await app.call('change_application_entities', { summary: '处理标注', changes: [
      { kind: 'set_properties', entityType: 'video_edit.clip', target: { kind: 'video_edit.clip', id: `${id}:${clip.id}` }, properties: { 'video_edit.clip.x': .25 } },
      { kind: 'set_properties', entityType: 'video_edit.annotation', target: ref, properties: { 'video_edit.annotation.thread': [{ id: 'reply', author: { kind: 'external', name: 'Codex' }, createdAt: '2026-10-08T00:00:00.000Z', text: '把片段右移25%，可撤销这次修改。' }], 'video_edit.annotation.status': 'addressed' } },
    ] }, (await app.read(ref)).revisions as Record<string, number>)
    expect(response).toMatchObject({ ok: true }); expect(owner.past.length).toBe(past + 1)
    const read = await app.read(ref, ['video_edit.annotation.status', 'video_edit.annotation.thread']); expect(read.properties).toMatchObject({ 'video_edit.annotation.status': 'addressed', 'video_edit.annotation.thread': [{ author: { name: 'Codex' } }] })
    expect((await app.change(ref, { 'video_edit.annotation.status': 'resolved' })).ok).toBe(false)
    expect((await app.change(ref, { 'video_edit.annotation.thread': [] })).ok).toBe(false)
    reviewVideoEditAnnotation(id, markId, true)
    expect(getActiveVideoEditSequence(owner).annotations[0].status).toBe('resolved')
    reviewVideoEditAnnotation(id, markId, false, '右移太多，请减半。')
    expect(getActiveVideoEditSequence(owner).annotations[0].thread.at(-1)?.text).toContain('减半')
    undoVideoEdit(id); undoVideoEdit(id)
    undoVideoEditAnnotationChange(id, markId)
    expect(getActiveVideoEditSequence(owner).clips[0].x).toBe(clip.x); expect(getActiveVideoEditSequence(owner).annotations[0].status).toBe('open')
    expect(await app.change(ref, { 'video_edit.annotation.clip_id': null })).toMatchObject({ ok: true }); expect(getActiveVideoEditSequence(owner).annotations[0].clipId).toBeUndefined()
  } finally { app.dispose() }
})
it('草稿批量发内置助手只复用发送入口，发送前不运行；复制成功后开放，失败不丢草稿；增改删各一步撤销', async () => {
  const owner = await createVideoEditTestProject(); const id = owner.document.id
  const markId = createVideoEditAnnotation(id, owner.activeSequenceId, { frame: 0, target: { kind: 'point', x: .2, y: .3 }, text: '这里亮一点' })
  updateVideoEditAnnotation(id, markId, mark => ({ ...mark, text: '这里暗一点' })); undoVideoEdit(id); expect(getActiveVideoEditSequence(owner).annotations[0].text).toBe('这里亮一点')
  deleteVideoEditAnnotation(id, markId); undoVideoEdit(id); expect(getActiveVideoEditSequence(owner).annotations).toHaveLength(1)
  await sendVideoEditAnnotations(id, owner.activeSequenceId, '统一风格')
  const options = useAssistantUiStore.getState().pendingGoalOptions!
  expect(getActiveVideoEditSequence(owner).annotations[0].status).toBe('draft'); expect(useAssistantUiStore.getState().pendingGoal).toContain('统一风格')
  options.beforeSend!(); expect(getActiveVideoEditSequence(owner).annotations[0].status).toBe('open'); options.onRejected!(); expect(getActiveVideoEditSequence(owner).annotations[0].status).toBe('draft')
  const clipboard = vi.spyOn(getPlatform().clipboard, 'writeText').mockRejectedValueOnce(new Error('剪贴板不可用')).mockResolvedValue(undefined)
  await expect(sendVideoEditAnnotations(id, owner.activeSequenceId, '', true)).rejects.toThrow('剪贴板')
  expect(getActiveVideoEditSequence(owner).annotations[0].status).toBe('draft')
  await sendVideoEditAnnotations(id, owner.activeSequenceId, '', true); expect(clipboard.mock.calls.at(-1)![0]).toContain(`${id}:${markId}`); expect(getActiveVideoEditSequence(owner).annotations[0].status).toBe('open')
})
