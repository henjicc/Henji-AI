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
import { readVideoEditInPlaceJob, resetVideoEditInPlaceJobsForTest } from './videoEditInPlaceGeneration'

beforeEach(() => {
  installHarnessNativeStorage()
  vi.spyOn(getPlatform().system.paths, 'dirname').mockImplementation(async path => path.replace(/[\\/][^\\/]+$/, ''))
  vi.spyOn(getPlatform().media, 'allowRoot').mockResolvedValue(undefined)
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
