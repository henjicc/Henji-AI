import '@/tests/cameraStageProjectFixture'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as documentOperations from '@/features/documents/documentOperations'
import { documentKindRegistry } from '@/core/documents/kinds'
import { DocumentSessionRegistry } from '@/features/documents/documentSessionRegistry'
import { createScriptedPrompter, FakeDocumentCommands, type ScriptedPrompter } from '@/features/documents/documentSessionTestKit'
import { setCameraStageDocumentRegistryForTests, findCameraStageProjectInstance } from '../application/cameraStageProjectRuntime'
import { createDefaultCameraStageSceneSnapshot } from '../domain/defaultSceneSnapshot'
import { sceneToDocumentContent } from '../domain/sceneSerialization'
import type { CameraStageSceneContent } from '../domain/sceneSerialization'
import { useCameraStageSessionStore } from '../store/cameraStageSessionStore'
import { useCameraStageStore } from '../store/cameraStageStore'
import {
  applyProjectEnvironmentImage,
  CameraStageLeaveCancelledError,
  createDraftCameraStageDocument,
  createNamedCameraStageDocument,
  duplicateCameraStageDocument,
  rollbackDuplicatedCameraStageDocument,
  leaveCameraStageEditor,
  openCameraStageDocument,
} from './cameraStageProjectService'

/*
 * 镜头参考文档的界面入口（3.2）：新建草稿、打开、离开、画布内嵌文档与全景输入同步。
 */

let commands: FakeDocumentCommands
let prompter: ScriptedPrompter

beforeEach(() => {
  commands = new FakeDocumentCommands()
  prompter = createScriptedPrompter()
  const registry = new DocumentSessionRegistry({ commands, prompter, kinds: documentKindRegistry })
  setCameraStageDocumentRegistryForTests(registry)
  const operations = new documentOperations.DocumentOperations({ registry, commands: {
    ...documentOperations.defaultDocumentOperationCommands,
    duplicateDocument: request => commands.duplicateDocument(request),
    trashDocument: target => commands.trashDocument(target),
  } })
  vi.spyOn(documentOperations, 'getDocumentOperations').mockReturnValue(operations)
  useCameraStageSessionStore.setState({ appView: 'list', lastDocumentId: null, stageViewMode: 'director' })
})
afterEach(() => { vi.restoreAllMocks() })

const stored = (id: string): CameraStageSceneContent => commands.stored(id)!.content as CameraStageSceneContent
const sceneContent = (): CameraStageSceneContent => structuredClone(sceneToDocumentContent(createDefaultCameraStageSceneSnapshot()))

describe('镜头参考文档入口', () => {
  it('独立复制当前尚未落盘的来源内容；补偿只撤回副本', async () => {
    commands.seed({ kind: 'camera_stage', id: 'source', name: '来源', content: sceneContent() })
    await openCameraStageDocument({ id: 'source' })
    useCameraStageStore.getState().addPrimitive('box')
    const copied = await duplicateCameraStageDocument('source')
    expect(copied?.id).not.toBe('source')
    expect(stored(copied!.id)).toEqual(stored('source'))
    expect(stored(copied!.id).objects.map(object => object.type)).toContain('primitive')
    expect(stored(copied!.id)).not.toBe(stored('source'))
    await rollbackDuplicatedCameraStageDocument(copied!.id)
    expect(commands.stored(copied!.id)).toBeUndefined()
    expect(commands.stored('source')).toBeDefined()
    expect(useCameraStageStore.getState().currentProjectId).toBe('source')
  })

  it('来源缺失返回空结果，复制写入失败明确拒绝且不产生副本', async () => {
    expect(await duplicateCameraStageDocument('missing')).toBeNull()
    commands.seed({ kind: 'camera_stage', id: 'source', name: '来源', content: sceneContent() })
    vi.spyOn(commands, 'duplicateDocument').mockRejectedValueOnce(new Error('disk unavailable'))
    await expect(duplicateCameraStageDocument('source')).rejects.toThrow('disk unavailable')
    expect((await commands.listDocuments({ kind: 'camera_stage' })).map(document => document.id)).toEqual(['source'])
  })
  it('把画布全景输入持久化到未打开的镜头参考文档', async () => {
    commands.seed({ kind: 'camera_stage', id: 'env', name: '环境', content: sceneContent() })
    await applyProjectEnvironmentImage('env', '/media/panorama.png')
    expect((stored('env').sceneSettings.sky as { environmentImageUrl: string }).environmentImageUrl).toBe('/media/panorama.png')
  })

  it('画布内嵌：后台新建已命名的文档（不是草稿），不改当前编辑会话；同名时改用自动名', async () => {
    useCameraStageStore.setState({ currentProjectId: 'active', currentProjectName: '正在编辑', selectedId: 'active-object' })
    const first = await createNamedCameraStageDocument('  节点镜头  ')
    expect(commands.stored(first.id)!.meta).toMatchObject({ name: '节点镜头', draft: false, kind: 'camera_stage' })
    const second = await createNamedCameraStageDocument('节点镜头')
    expect(second.name).toBe('未命名镜头参考 1')
    expect(commands.stored(second.id)!.meta.draft).toBe(false)
    // 新建的空文档补了默认摄像机；落盘后 ID 稳定
    await findCameraStageProjectInstance(first.id)!.session.flush()
    expect(stored(first.id).objects.map((object) => object.type)).toEqual(['camera'])
    expect(useCameraStageStore.getState()).toMatchObject({ currentProjectId: 'active', currentProjectName: '正在编辑', selectedId: 'active-object' })
    expect(useCameraStageSessionStore.getState()).toMatchObject({ appView: 'list', lastDocumentId: null })
  })

  it('新建草稿进入编辑器；打开另一份时先离开草稿，取消则留在原处；返回列表时空草稿直接删除', async () => {
    commands.seed({ kind: 'camera_stage', id: 'other', name: '另一份', content: sceneContent() })
    const draft = await createDraftCameraStageDocument()
    expect(useCameraStageSessionStore.getState()).toMatchObject({ appView: 'editor', lastDocumentId: draft.id })
    expect(useCameraStageStore.getState().currentProjectId).toBe(draft.id)

    useCameraStageStore.getState().addPrimitive('box')
    prompter.leaveChoices.push('cancel')
    await expect(openCameraStageDocument({ id: 'other' })).rejects.toBeInstanceOf(CameraStageLeaveCancelledError)
    expect(useCameraStageStore.getState().currentProjectId).toBe(draft.id)

    prompter.leaveChoices.push('discard')
    await openCameraStageDocument({ id: 'other' })
    expect(commands.trashed).toEqual([draft.id])
    expect(useCameraStageStore.getState().currentProjectId).toBe('other')
    expect(useCameraStageSessionStore.getState().lastDocumentId).toBe('other')

    const empty = await createDraftCameraStageDocument()
    expect(await leaveCameraStageEditor()).toBe('discarded')
    expect(commands.stored(empty.id)).toBeUndefined()
    expect(useCameraStageSessionStore.getState()).toMatchObject({ appView: 'list', lastDocumentId: null })
  })
})
