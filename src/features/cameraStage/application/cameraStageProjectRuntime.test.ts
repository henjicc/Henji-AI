import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '@/tests/cameraStageProjectFixture'
import { cameraStageDocumentKind } from '@/core/documents/kinds/cameraStage'
import { documentKindRegistry } from '@/core/documents/kinds'
import { DocumentOperations } from '@/features/documents/documentOperations'
import { DocumentSessionRegistry } from '@/features/documents/documentSessionRegistry'
import { createScriptedPrompter, FakeDocumentCommands, type ScriptedPrompter } from '@/features/documents/documentSessionTestKit'
import { createDefaultCameraStageSceneSnapshot } from '../domain/defaultSceneSnapshot'
import { sceneToDocumentContent, type CameraStageSceneContent } from '../domain/sceneSerialization'
import { attachCameraStageStore, beginHistorySession, createCameraStageStore, endHistorySession, useCameraStageStore } from '../store/cameraStageStore'
import { readCameraStagePlaybackRuntime } from '../scene/playbackRuntime'
import { loadProjectIntoScene } from '../projects/cameraStageProjectService'
import {
  cameraStageProjectStore, createCameraStageDraftRuntime, ensureCameraStageProjectRuntime, findCameraStageProjectInstance,
  leaseCameraStageProjectRuntime, leaveCameraStageProject, releaseCameraStageProjectInstance, saveCameraStageProjectRuntime,
  setCameraStageDocumentRegistryForTests,
} from './cameraStageProjectRuntime'
import { captureCameraStageUndo, restoreCameraStageUndo } from './cameraStageUndo'
import { cameraStageApplicationService } from './cameraStageApplicationService'

/*
 * 镜头参考文档实例（3.2）：同一份文档全局一个实例、后台读写不影响界面、保存全部交给通用文档会话
 * （防抖自动保存、失败保留修改、离开时草稿询问），会话结束实例跟着拆掉。
 * 用内存文档仓库替身 + 正式会话登记表，不跑主进程。
 */

let commands: FakeDocumentCommands
let prompter: ScriptedPrompter
let registry: DocumentSessionRegistry

beforeEach(() => {
  commands = new FakeDocumentCommands()
  prompter = createScriptedPrompter()
  registry = new DocumentSessionRegistry({ commands, prompter, kinds: documentKindRegistry })
  setCameraStageDocumentRegistryForTests(registry)
})

afterEach(() => { vi.useRealTimers() })

function seed(id: string): number {
  const scene = createDefaultCameraStageSceneSnapshot()
  commands.seed({ kind: 'camera_stage', id, name: id, content: structuredClone(sceneToDocumentContent(scene)) })
  return scene.objects.length
}

function stored(id: string): CameraStageSceneContent {
  return commands.stored(id)!.content as CameraStageSceneContent
}

describe('镜头参考文档唯一实例', () => {
  it('并发取得 B 只读取一次，后台读改、保存和补偿不改变界面上的 A', async () => {
    seed('a'); const count = seed('b')
    await loadProjectIntoScene('a')
    useCameraStageStore.getState().seek(2)
    const before = useCameraStageStore.getState()
    const playback = readCameraStagePlaybackRuntime()
    const reads = commands.calls.filter((call) => call === 'readDocument').length
    await Promise.all([ensureCameraStageProjectRuntime('b'), ensureCameraStageProjectRuntime('b')])
    expect(commands.calls.filter((call) => call === 'readDocument').length).toBe(reads + 1)
    const store = cameraStageProjectStore('b')
    const token = captureCameraStageUndo('b')
    store.getState().addPrimitive('box')
    // 公共读取必须包含未落盘的同一份状态。
    expect((await cameraStageApplicationService.readSnapshot('b')).objects).toHaveLength(count + 1)
    await saveCameraStageProjectRuntime('b')
    expect(stored('b').objects).toHaveLength(count + 1)
    await restoreCameraStageUndo(token)
    expect(store.getState().objects).toHaveLength(count)
    expect(useCameraStageStore.getState()).toBe(before)
    expect(readCameraStagePlaybackRuntime()).toEqual(playback)
  })

  it('后台保存期间打开 B 即时附着原实例，切换回来保留可用撤销', async () => {
    seed('a'); const count = seed('b')
    await loadProjectIntoScene('a')
    const release = await leaseCameraStageProjectRuntime('b')
    const original = cameraStageProjectStore('b')
    original.getState().addPrimitive('box')
    let finish!: () => void
    commands.saveGate = new Promise<void>((resolve) => { finish = resolve })
    const saving = saveCameraStageProjectRuntime('b')
    await vi.waitFor(() => expect(commands.activeSaves).toBe(1))
    expect(await loadProjectIntoScene('b')).toBe(true)
    expect(useCameraStageStore.getState()).toBe(original.getState())
    commands.saveGate = null
    finish()
    await saving
    release(); release()
    expect(findCameraStageProjectInstance('b')?.leases).toBe(0)
    await loadProjectIntoScene('a')
    await loadProjectIntoScene('b')
    useCameraStageStore.temporal.getState().undo()
    expect(original.getState().objects).toHaveLength(count)
  })

  it('A 的连续交互历史不会吞掉 B 的后台修改，播放采样不进入 B 历史', async () => {
    const count = seed('a'); seed('b')
    await loadProjectIntoScene('a')
    await ensureCameraStageProjectRuntime('b')
    beginHistorySession()
    useCameraStageStore.getState().addPrimitive('box')
    useCameraStageStore.getState().addPrimitive('sphere')
    const b = cameraStageProjectStore('b')
    b.getState().addPrimitive('box')
    const historyLength = b.temporal.getState().pastStates.length
    b.getState().seek(3)
    expect(b.temporal.getState().pastStates).toHaveLength(historyLength)
    endHistorySession()
    useCameraStageStore.temporal.getState().undo()
    expect(useCameraStageStore.getState().objects).toHaveLength(count)
    b.temporal.getState().undo()
    expect(b.getState().objects).toHaveLength(count)
  })
})

describe('保存交给通用文档会话', () => {
  it('页面解除附着后自动保存仍执行；被租用和正在展示的实例不可释放，释放时写完并关闭会话', async () => {
    vi.useFakeTimers()
    seed('autosave')
    await loadProjectIntoScene('autosave')
    const instance = findCameraStageProjectInstance('autosave')!
    expect(await releaseCameraStageProjectInstance('autosave')).toBe(false)
    instance.store.getState().addPrimitive('box')
    attachCameraStageStore(createCameraStageStore())
    await vi.advanceTimersByTimeAsync(900)
    expect(commands.writes).toBe(1)
    expect(instance.session.dirty).toBe(false)
    const release = await leaseCameraStageProjectRuntime('autosave')
    expect(await releaseCameraStageProjectInstance('autosave')).toBe(false)
    release()
    instance.store.getState().addPrimitive('sphere')
    expect(await releaseCameraStageProjectInstance('autosave')).toBe(true)
    expect(commands.writes).toBe(2)
    expect(instance.session.isEnded).toBe(true)
    expect(findCameraStageProjectInstance('autosave')).toBeUndefined()
    expect(registry.get('autosave')).toBeUndefined()
  })

  it('在途保存期间的新修改另行保存；失败保留修改并标为失败，重试只重写落盘', async () => {
    const count = seed('save-race')
    const instance = await ensureCameraStageProjectRuntime('save-race')
    instance.store.getState().addPrimitive('box')
    let finish!: () => void
    commands.saveGate = new Promise<void>((resolve) => { finish = resolve })
    const saving = saveCameraStageProjectRuntime('save-race')
    await vi.waitFor(() => expect(commands.activeSaves).toBe(1))
    instance.store.getState().addPrimitive('sphere')
    commands.saveGate = null
    finish(); await saving
    expect(commands.writes).toBe(2)
    expect(stored('save-race').objects).toHaveLength(count + 2)
    instance.store.getState().addPrimitive('box')
    commands.failSaves = 1
    await expect(saveCameraStageProjectRuntime('save-race')).rejects.toThrow('磁盘已满')
    expect(instance.session.dirty).toBe(true)
    expect(instance.session.getState().status).toBe('failed')
    await saveCameraStageProjectRuntime('save-race')
    expect(stored('save-race').objects).toHaveLength(count + 3)
    expect(instance.session.dirty).toBe(false)
  })

  it('空白文档（新建的空内容）打开时补默认摄像机与首关键帧并落盘；只有它时仍算空内容', async () => {
    commands.seed({ kind: 'camera_stage', id: 'blank', name: '空白', content: cameraStageDocumentKind.createEmptyContent() })
    const instance = await ensureCameraStageProjectRuntime('blank')
    const state = instance.store.getState()
    expect(state.objects.map((object) => object.type)).toEqual(['camera'])
    expect(state.stateKeyframes).toHaveLength(1)
    await saveCameraStageProjectRuntime('blank')
    expect(stored('blank').objects[0]).toMatchObject({ id: state.objects[0]!.id, type: 'camera' })
    expect(cameraStageDocumentKind.isEmptyContent(cameraStageDocumentKind.contentSchema.parse(stored('blank')))).toBe(true)
    expect(instance.session.isEmpty()).toBe(true)
  })

  it('文档名就是文件名：通用改名后实例名称跟着变，不进撤销、不标脏', async () => {
    seed('named')
    const instance = await ensureCameraStageProjectRuntime('named')
    const operations = new DocumentOperations({ commands, registry, kinds: documentKindRegistry })
    const history = instance.store.temporal.getState().pastStates.length
    await operations.renameDocument({ id: 'named' }, '新名字')
    expect(instance.store.getState().currentProjectName).toBe('新名字')
    expect(instance.store.temporal.getState().pastStates).toHaveLength(history)
    expect(instance.session.dirty).toBe(false)
    expect((await cameraStageApplicationService.readSnapshot('named')).name).toBe('新名字')
  })
})

describe('离开与回收站', () => {
  it('新建的空草稿离开时直接删除，不询问；会话结束实例拆掉', async () => {
    const instance = await createCameraStageDraftRuntime()
    expect(instance.session.documentMeta).toMatchObject({ draft: true, name: '未命名镜头参考 1' })
    expect(await leaveCameraStageProject(instance.id)).toBe('discarded')
    expect(prompter.log).toEqual([])
    expect(commands.stored(instance.id)).toBeUndefined()
    expect(findCameraStageProjectInstance(instance.id)).toBeUndefined()
  })

  it('有内容的草稿离开时询问：取消留在原处；保存时起名转正；离开等进行中的后台操作结束且期间拒绝新操作', async () => {
    const instance = await createCameraStageDraftRuntime()
    instance.store.getState().addPrimitive('box')
    prompter.leaveChoices.push('cancel')
    expect(await leaveCameraStageProject(instance.id)).toBe('cancelled')
    expect(findCameraStageProjectInstance(instance.id)).toBe(instance)

    const release = await leaseCameraStageProjectRuntime(instance.id)
    prompter.leaveChoices.push('save')
    prompter.saveName = async (info) => {
      expect(await info.check('镜头一', null)).toMatchObject({ status: 'available' })
      await info.submit('镜头一', null)
      return true
    }
    const leaving = leaveCameraStageProject(instance.id)
    await expect(leaseCameraStageProjectRuntime(instance.id)).rejects.toThrow('PROJECT_CLOSING')
    expect(prompter.log.filter((entry) => entry.startsWith('leave:'))).toHaveLength(1)
    release()
    expect(await leaving).toBe('saved')
    expect(commands.stored(instance.id)!.meta).toMatchObject({ name: '镜头一', draft: false })
    expect((commands.stored(instance.id)!.content as CameraStageSceneContent).objects.length).toBeGreaterThan(1)
    expect(findCameraStageProjectInstance(instance.id)).toBeUndefined()
  })

  it('移到回收站：只为后台持有的实例先释放（写完再删）；界面正在显示的拒绝', async () => {
    seed('shown'); seed('background')
    const operations = new DocumentOperations({ commands, registry, kinds: documentKindRegistry })
    operations.registerReleaser('camera_stage', releaseCameraStageProjectInstance)
    await loadProjectIntoScene('shown')
    await expect(operations.trashDocument({ id: 'shown' })).rejects.toMatchObject({ name: 'DocumentInUseError' })
    const background = await ensureCameraStageProjectRuntime('background')
    background.store.getState().addPrimitive('box')
    await operations.trashDocument({ id: 'background' })
    expect(commands.trashed).toEqual(['background'])
    expect(findCameraStageProjectInstance('background')).toBeUndefined()
    expect(commands.writes).toBe(1)
  })
})
