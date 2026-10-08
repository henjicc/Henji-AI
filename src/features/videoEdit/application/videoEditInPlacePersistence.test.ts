import { createVideoEditTestProject as createVideoEditProject } from './videoEditDocumentTestKit'
// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { getPlatform } from '@/platform/runtime'
import { videoEditContentSchema, videoEditDocumentKind } from '@/core/documents/kinds/videoEdit'
import { landVideoEditInPlaceResult, planVideoEditInPlaceGeneration } from '@/core/videoEdit/inPlaceGeneration'
import type { VideoEditInPlaceRecord } from '@/core/videoEdit/inPlacePersistence'
import { appendVideoEditClip, beginVideoEditGesture, editVideoProject, finishVideoEditGesture, saveVideoEdit, undoVideoEdit, updateVideoEditInPlaceMetadata, updateVideoEditPicturePosition } from './videoEditService'
import { closeAllVideoEdits, reopenVideoEdit, savedVideoEdit } from './videoEditDocumentTestKit'
import { readVideoEditInPlaceJob, resetVideoEditInPlaceJobsForTest, restoreVideoEditInPlaceJobs } from './videoEditInPlaceGeneration'
import { generationApplicationService } from '@/features/generation/application/generationApplicationService'
import { createApplicationHarness } from '@/tests/applicationHarness'

beforeEach(() => {
  installHarnessNativeStorage()
  vi.spyOn(getPlatform().system.paths, 'dirname').mockImplementation(async path => path.replace(/[\\/][^\\/]+$/, ''))
  vi.spyOn(getPlatform().media, 'allowRoot').mockResolvedValue(undefined)
})
it('公共查询在完成占位清理后重开仍从持久来源与镜头版本读回，撤销删除后不谎报已落位', async () => {
  const owner = await createVideoEditProject(); const id = owner.document.id
  editVideoProject(id, document => ({ ...document,
    media: [{ id: 'generated', name: '新镜头', path: 'D:/generated.mp4', kind: 'video', durationSeconds: 2, width: 1920, height: 1080 }],
    items: [{ id: 'generated-item', name: '新镜头', kind: 'video', mediaId: 'generated' }],
  }))
  const plan = planVideoEditInPlaceGeneration(owner.document, owner.activeSequenceId, { action: 'generate_shot', frame: 0, duration: 30 })
  editVideoProject(id, document => landVideoEditInPlaceResult(document, plan, 'generated-item', { type: 'generation', recordId: 'completed-task', outputIndex: 0 }).document)
  await saveVideoEdit(id)
  resetVideoEditInPlaceJobsForTest()
  let reopened = await reopenVideoEdit(id)
  const app = createApplicationHarness()
  const input = { documentRef: { kind: 'video_edit.document', id }, taskRef: { kind: 'generation.task', id: 'completed-task' } }
  try {
    expect(await app.call('get_video_edit_in_place_generation', input)).toMatchObject({ ok: true, data: { status: 'placed', clipRef: { id: `${id}:${reopened.document.sequences[0].clips[0].id}` } } })
    editVideoProject(id, document => landVideoEditInPlaceResult(document, planVideoEditInPlaceGeneration(document, reopened.activeSequenceId, { action: 'replace_shot', clipId: document.sequences[0].clips[0].id }), 'generated-item', { type: 'generation', recordId: 'second-task', outputIndex: 0 }).document)
    await saveVideoEdit(id); resetVideoEditInPlaceJobsForTest(); reopened = await reopenVideoEdit(id)
    expect(await app.call('get_video_edit_in_place_generation', input)).toMatchObject({ ok: true, data: { status: 'placed', takeIndex: 0 } })
    editVideoProject(id, document => ({ ...document, sequences: document.sequences.map(sequence => ({ ...sequence, clips: [] })) }))
    expect(await app.call('get_video_edit_in_place_generation', input)).toMatchObject({ ok: false })
  } finally { app.dispose() }
})
afterEach(async () => { resetVideoEditInPlaceJobsForTest(); await closeAllVideoEdits(); vi.restoreAllMocks(); uninstallHarnessNativeStorage() })

it('真实文档会话保存占位、旧文件兼容，重开恢复失败占位与设置；占位不使草稿被误丢弃', async () => {
  const owner = await createVideoEditProject(); const id = owner.document.id
  const plan = planVideoEditInPlaceGeneration(owner.document, owner.activeSequenceId, { action: 'generate_shot', frame: 0, duration: 30 })
  const record: VideoEditInPlaceRecord = { id: 'job-persist', taskId: 'task-persist', modelId: 'model', plan,
    request: { sequenceId: owner.activeSequenceId, intent: { action: 'generate_shot', frame: 0, duration: 30 }, prompt: '日落', params: { duration: 1 }, referenceRoles: [], referenceFrame: 15 }, status: 'failed', error: '审核未通过',
  }
  const empty = videoEditContentSchema.parse(videoEditDocumentKind.createEmptyContent())
  expect(empty.inPlaceGenerations).toBeUndefined()
  updateVideoEditInPlaceMetadata(id, [record])
  expect(owner.past).toHaveLength(0); expect(owner.document.revision).toBe(0)
  expect(videoEditDocumentKind.isEmptyContent(videoEditContentSchema.parse({ ...empty, inPlaceGenerations: [record] }))).toBe(false)
  await saveVideoEdit(id)
  expect(savedVideoEdit(id).inPlaceGenerations).toEqual([record])
  const reopened = await reopenVideoEdit(id)
  expect(reopened.document.inPlaceGenerations).toEqual([record])
  expect(readVideoEditInPlaceJob(record.id)).toMatchObject({ taskId: 'task-persist', status: 'failed', error: '审核未通过', request: { projectId: id, params: { duration: 1 }, referenceRoles: [], referenceFrame: 15 } })
})

it('公共恢复保存失败沿原身份只保存；公共移除失败占位不删除历史且落盘', async () => {
  const owner = await createVideoEditProject(); const id = owner.document.id
  appendVideoEditClip(id)
  const sequence = owner.document.sequences[0]; const clipId = sequence.clips[0].id
  const plan = planVideoEditInPlaceGeneration(owner.document, sequence.id, { action: 'generate_shot', frame: 200, duration: 30 })
  const record: VideoEditInPlaceRecord = { id: 'save-failed', taskId: 'save-failed-task', modelId: 'model', plan, request: { sequenceId: sequence.id, intent: { action: 'generate_shot', frame: 200 }, prompt: '镜头' }, status: 'failed', clipId, error: '保存失败' }
  updateVideoEditInPlaceMetadata(id, [record]); restoreVideoEditInPlaceJobs(id)
  const generation = vi.spyOn(generationApplicationService, 'submit')
  const app = createApplicationHarness()
  try {
    const input = { documentRef: { kind: 'video_edit.document', id }, taskRef: { kind: 'generation.task', id: record.taskId } }
    expect(await app.call('recover_video_edit_in_place_generation', input)).toMatchObject({ ok: true, data: { status: 'placing' } })
    await vi.waitFor(() => expect(readVideoEditInPlaceJob(record.id)?.status).toBe('placed'))
    expect(savedVideoEdit(id).sequences[0].clips).toHaveLength(1); expect(savedVideoEdit(id).inPlaceGenerations).toBeUndefined()
    expect(generation).not.toHaveBeenCalled()
    const discard = { ...record, id: 'discard-failed', taskId: 'discard-failed-task', clipId: undefined }
    updateVideoEditInPlaceMetadata(id, [discard]); restoreVideoEditInPlaceJobs(id)
    expect(await app.call('discard_video_edit_in_place_generation', { ...input, taskRef: { kind: 'generation.task', id: discard.taskId } })).toMatchObject({ ok: true, data: { status: 'removed', verified: true } })
    expect(savedVideoEdit(id).inPlaceGenerations).toBeUndefined(); expect(savedVideoEdit(id).sequences[0].clips).toHaveLength(1)
    expect(generation).not.toHaveBeenCalled()
  } finally { app.dispose() }
})

it('编辑、撤销/重做、参数草稿取消保留最新占位；移除占位不清重做且撤销不会复活', async () => {
  const owner = await createVideoEditProject(); const id = owner.document.id
  const plan = planVideoEditInPlaceGeneration(owner.document, owner.activeSequenceId, { action: 'generate_shot', frame: 0, duration: 30 })
  const record: VideoEditInPlaceRecord = { id: 'job-undo', taskId: 'task-undo', modelId: 'model', plan,
    request: { sequenceId: owner.activeSequenceId, intent: { action: 'generate_shot', frame: 0 }, prompt: '空镜' }, status: 'failed', error: '错误',
  }
  appendVideoEditClip(id)
  const clipId = owner.document.sequences[0].clips[0].id
  const gesture = beginVideoEditGesture(id)
  updateVideoEditPicturePosition(gesture, owner.activeSequenceId, clipId, { x: .2, y: 0 })
  updateVideoEditInPlaceMetadata(id, [record])
  finishVideoEditGesture(gesture, false)
  expect(owner.document.inPlaceGenerations).toEqual([record]); expect(owner.document.sequences[0].clips[0].x).toBe(0)
  undoVideoEdit(id)
  expect(owner.document.sequences[0].clips).toHaveLength(0); expect(owner.document.inPlaceGenerations).toEqual([record])
  const future = owner.future
  updateVideoEditInPlaceMetadata(id, [])
  expect(owner.future).toBe(future)
  undoVideoEdit(id, true)
  expect(owner.document.sequences[0].clips).toHaveLength(1); expect(owner.document.inPlaceGenerations).toBeUndefined()
  undoVideoEdit(id)
  expect(owner.document.inPlaceGenerations).toBeUndefined()
  await saveVideoEdit(id); expect(savedVideoEdit(id).inPlaceGenerations).toBeUndefined()
})

it('链接音画落位在正式领域中只占一步撤销，撤销/重做都不会恢复已完成占位', async () => {
  const owner = await createVideoEditProject(); const id = owner.document.id
  editVideoProject(id, document => ({ ...document,
    media: [{ id: 'm-generated', name: '带声镜头', path: 'D:/generated.mp4', kind: 'video', hasAudio: true, durationSeconds: 2, width: 1920, height: 1080 }],
    items: [{ id: 'i-generated', name: '带声镜头', kind: 'video', mediaId: 'm-generated' }],
  }))
  const plan = planVideoEditInPlaceGeneration(owner.document, owner.activeSequenceId, { action: 'generate_shot', frame: 0, duration: 30 })
  updateVideoEditInPlaceMetadata(id, [{ id: 'job-landed', taskId: 'task-landed', modelId: 'model', plan, request: { sequenceId: owner.activeSequenceId, intent: { action: 'generate_shot', frame: 0 }, prompt: '空镜' }, status: 'placing' }])
  const history = owner.past.length
  editVideoProject(id, document => landVideoEditInPlaceResult(document, plan, 'i-generated').document)
  updateVideoEditInPlaceMetadata(id, [])
  expect(owner.past).toHaveLength(history + 1)
  expect(owner.document.sequences[0].clips).toHaveLength(2)
  undoVideoEdit(id)
  expect(owner.document.sequences[0].clips).toHaveLength(0); expect(owner.document.inPlaceGenerations).toBeUndefined()
  undoVideoEdit(id, true)
  const clips = owner.document.sequences[0].clips
  expect(clips).toHaveLength(2); expect(clips[0].linkId).toBe(clips[1].linkId)
  expect(owner.document.inPlaceGenerations).toBeUndefined()
})
