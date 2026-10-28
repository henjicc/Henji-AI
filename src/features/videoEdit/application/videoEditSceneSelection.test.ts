// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { goldenScene } from '@/core/videoEdit/scene/sceneTestFixtures'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { createVideoEditTestProject } from './videoEditDocumentTestKit'
import { selectedVideoEditSceneRecord, selectVideoEditSceneRecord, subscribeVideoEditSceneSelection, videoEditSelectedSceneRecordRef } from './videoEditSceneSelection'
import { closeVideoEditProject, editVideoProject, listVideoEditInstances, undoVideoEdit, type VideoEditInstance } from './videoEditService'

let owner: VideoEditInstance
beforeEach(async () => {
  installHarnessNativeStorage()
  owner = await createVideoEditTestProject()
  editVideoProject(owner.document.id, document => ({ ...document, scenes: [goldenScene('screen')] }))
})
afterEach(async () => { for (const instance of listVideoEditInstances()) await closeVideoEditProject(instance.document.id); uninstallHarnessNativeStorage() })

it('选中记录只通知一次，记录被删后读回为没有选择；不存在的记录拒绝选中', () => {
  const listener = vi.fn()
  const unsubscribe = subscribeVideoEditSceneSelection(listener)
  selectVideoEditSceneRecord(owner.document.id, { sceneId: 'golden-scene', recordId: 'sh-1' })
  selectVideoEditSceneRecord(owner.document.id, { sceneId: 'golden-scene', recordId: 'sh-1' })
  expect(listener).toHaveBeenCalledTimes(1)
  expect(selectedVideoEditSceneRecord(owner)).toEqual({ sceneId: 'golden-scene', recordId: 'sh-1' })
  expect(() => selectVideoEditSceneRecord(owner.document.id, { sceneId: 'golden-scene', recordId: 'missing' })).toThrow('原记录已删除')
  editVideoProject(owner.document.id, document => ({ ...document, scenes: [{ ...document.scenes![0], records: document.scenes![0].records.filter(record => record.id !== 'sh-1') }] }))
  expect(selectedVideoEditSceneRecord(owner)).toBeUndefined()
  // 撤销删除后同一条记录回来，选择随之恢复
  undoVideoEdit(owner.document.id)
  expect(selectedVideoEditSceneRecord(owner)?.recordId).toBe('sh-1')
  selectVideoEditSceneRecord(owner.document.id, null)
  expect(selectedVideoEditSceneRecord(owner)).toBeUndefined()
  expect(listener).toHaveBeenCalledTimes(2)
  unsubscribe()
})

it('选中记录的引用超过宿主上下文单项上限时不放进 selectedRefs', () => {
  selectVideoEditSceneRecord(owner.document.id, { sceneId: 'golden-scene', recordId: 'sh-1' })
  expect(videoEditSelectedSceneRecordRef(owner)).toBe(`video_edit.scene_record:${owner.document.id}:golden-scene/sh-1`)
  // 中文 ID 编码后每个字 9 个字符：60 个字的记录 ID 让引用超过 500 字符
  const longId = '记'.repeat(60)
  editVideoProject(owner.document.id, document => ({ ...document, scenes: [{ ...document.scenes![0], records: [...document.scenes![0].records, { id: longId, kind: 'segment', values: { name: '长', start: 3, end: 4 } }] }] }))
  selectVideoEditSceneRecord(owner.document.id, { sceneId: 'golden-scene', recordId: longId })
  expect(selectedVideoEditSceneRecord(owner)?.recordId).toBe(longId)
  expect(videoEditSelectedSceneRecordRef(owner)).toBeUndefined()
})
