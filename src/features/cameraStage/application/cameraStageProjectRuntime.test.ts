import { beforeEach, describe, expect, it, vi } from 'vitest'
import '@/tests/cameraStageProjectFixture'
import type { CameraStageProjectPlatformWrite } from '@/platform/contracts/cameraStageProjects'
import { createDefaultCameraStageSceneSnapshot } from '../domain/defaultSceneSnapshot'
import { attachCameraStageStore, beginHistorySession, createCameraStageStore, endHistorySession, useCameraStageStore } from '../store/cameraStageStore'
import { readCameraStagePlaybackRuntime } from '../scene/playbackRuntime'
import { deserializeScene, serializeScene } from '../domain/sceneSerialization'
import { deleteProject, loadProjectIntoScene } from '../projects/cameraStageProjectService'
import {
  cameraStageProjectStore, ensureCameraStageProjectRuntime, saveCameraStageProjectRuntime,
  leaseCameraStageProjectRuntime, findCameraStageProjectInstance, releaseCameraStageProjectInstance,
} from './cameraStageProjectRuntime'
import { captureCameraStageUndo, restoreCameraStageUndo } from './cameraStageUndo'
import { cameraStageApplicationService } from './cameraStageApplicationService'

const storage = vi.hoisted(() => ({
  records: new Map<string, CameraStageProjectPlatformWrite>(), read: vi.fn(), save: vi.fn(), remove: vi.fn(),
}))
vi.mock('@/commands/cameraStageProjects', () => ({
  getCameraStageProjectRecord: storage.read, upsertCameraStageProjectRecord: storage.save, deleteCameraStageProjectRecord: storage.remove,
}))

function seed(id: string): number {
  const scene = createDefaultCameraStageSceneSnapshot()
  storage.records.set(id, { id, name: id, createdAt: 1, updatedAt: 1, objectCount: scene.objects.length, sceneJson: serializeScene(scene) })
  return scene.objects.length
}

beforeEach(() => {
  vi.clearAllMocks()
  storage.records.clear()
  storage.read.mockImplementation(async (id: string) => storage.records.get(id) ?? null)
  storage.save.mockImplementation(async (record: CameraStageProjectPlatformWrite) => { storage.records.set(record.id, record) })
  storage.remove.mockImplementation(async (id: string) => { storage.records.delete(id) })
})

describe('三维工程唯一实例与生命周期', () => {
  it('并发取得 B 只读取一次，后台读改、保存和补偿不改变 A', async () => {
    seed('a'); const count = seed('b')
    await loadProjectIntoScene('a')
    useCameraStageStore.getState().seek(2)
    const before = useCameraStageStore.getState()
    const playback = readCameraStagePlaybackRuntime()
    storage.read.mockClear()
    await Promise.all([ensureCameraStageProjectRuntime('b'), ensureCameraStageProjectRuntime('b')])
    expect(storage.read).toHaveBeenCalledTimes(1)
    const store = cameraStageProjectStore('b')
    const token = captureCameraStageUndo('b')
    store.getState().addPrimitive('box')
    // 公共读取必须包含未落盘的同一份状态。
    expect((await cameraStageApplicationService.readSnapshot('b')).objects).toHaveLength(count + 1)
    await saveCameraStageProjectRuntime('b')
    expect(deserializeScene(storage.records.get('b')!.sceneJson).objects).toHaveLength(count + 1)
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
    storage.save.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
    const saving = saveCameraStageProjectRuntime('b')
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    expect(await loadProjectIntoScene('b')).toBe(true)
    expect(useCameraStageStore.getState()).toBe(original.getState())
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

  it('页面解除附着后自动保存仍执行；未保存、被租用和正在展示的实例不可释放', async () => {
    vi.useFakeTimers()
    try {
      seed('autosave')
      await loadProjectIntoScene('autosave')
      const instance = findCameraStageProjectInstance('autosave')!
      expect(releaseCameraStageProjectInstance('autosave')).toBe(false)
      instance.store.getState().addPrimitive('box')
      attachCameraStageStore(createCameraStageStore())
      expect(releaseCameraStageProjectInstance('autosave')).toBe(false)
      await vi.advanceTimersByTimeAsync(710)
      expect(instance.dirty).toBe(false)
      expect(storage.save).toHaveBeenCalledTimes(1)
      const release = await leaseCameraStageProjectRuntime('autosave')
      expect(releaseCameraStageProjectInstance('autosave')).toBe(false)
      release()
      expect(releaseCameraStageProjectInstance('autosave')).toBe(true)
    } finally { vi.useRealTimers() }
  })

  it('在途保存期间的新修改另行保存，失败保留脏状态且只重试落盘', async () => {
    const count = seed('save-race')
    await ensureCameraStageProjectRuntime('save-race')
    const instance = findCameraStageProjectInstance('save-race')!
    instance.store.getState().addPrimitive('box')
    let finish!: () => void
    storage.save.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
    const saving = saveCameraStageProjectRuntime('save-race')
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    instance.store.getState().addPrimitive('sphere')
    finish(); await saving
    expect(storage.save).toHaveBeenCalledTimes(2)
    expect(deserializeScene(storage.records.get('save-race')!.sceneJson).objects).toHaveLength(count + 2)
    instance.store.getState().addPrimitive('box')
    storage.save.mockRejectedValueOnce(new Error('disk-full'))
    await expect(saveCameraStageProjectRuntime('save-race')).rejects.toThrow('disk-full')
    expect(instance.dirty).toBe(true)
    expect(instance.status.getState().state).toBe('error')
    await saveCameraStageProjectRuntime('save-race')
    expect(instance.store.getState().objects).toHaveLength(count + 3)
    expect(instance.dirty).toBe(false)
  })

  it('删除等待在途租用与最终保存，并拒绝新操作；保存失败时保留工程', async () => {
    seed('delete-pending')
    const release = await leaseCameraStageProjectRuntime('delete-pending')
    const instance = findCameraStageProjectInstance('delete-pending')!
    const deleting = deleteProject('delete-pending')
    await expect(leaseCameraStageProjectRuntime('delete-pending')).rejects.toThrow('PROJECT_CLOSING')
    expect(storage.remove).not.toHaveBeenCalled()
    instance.store.getState().addPrimitive('box')
    release(); await deleting
    expect(storage.save).toHaveBeenCalledTimes(1)
    expect(findCameraStageProjectInstance('delete-pending')).toBeUndefined()
    seed('delete-failed')
    await ensureCameraStageProjectRuntime('delete-failed')
    const failed = findCameraStageProjectInstance('delete-failed')!
    failed.store.getState().addPrimitive('box')
    storage.save.mockRejectedValueOnce(new Error('disk-full'))
    await expect(deleteProject('delete-failed')).rejects.toThrow('disk-full')
    expect(failed.dirty).toBe(true)
    expect(failed.closing).toBe(false)
    expect(storage.records.has('delete-failed')).toBe(true)
  })
})
