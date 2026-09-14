import { describe, expect, it, vi } from 'vitest'
import { createDefaultCameraStageSceneSnapshot } from '../domain/defaultSceneSnapshot'
import { useCameraStageStore } from '../store/cameraStageStore'
import { readCameraStagePlaybackRuntime } from '../scene/playbackRuntime'
import { deserializeScene, serializeScene } from '../domain/sceneSerialization'

const storage = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn() }))
vi.mock('../projects/cameraStageProjectService', () => ({ readProjectSnapshot: storage.read, saveProjectDraft: storage.save, saveCurrentProject: vi.fn() }))
import { cameraStageProjectStore, ensureCameraStageProjectRuntime, saveCameraStageProjectRuntime, leaseCameraStageProjectRuntime } from './cameraStageProjectRuntime'
import { captureCameraStageUndo, restoreCameraStageUndo } from './cameraStageUndo'

describe('三维后台工程复用原 actions', () => {
  it('改 B 与失败补偿 B 不改变 A 的场景、选择或播放运行时', async () => {
    const a = deserializeScene(serializeScene(createDefaultCameraStageSceneSnapshot()))
    useCameraStageStore.getState().loadSnapshot(a, { id: 'active-a', name: 'A' })
    useCameraStageStore.getState().seek(2)
    const before = useCameraStageStore.getState()
    const playback = readCameraStagePlaybackRuntime()
    const b = createDefaultCameraStageSceneSnapshot()
    storage.read.mockResolvedValue({ ...b, id: 'background-b', name: 'B', createdAt: 1, updatedAt: 1 })
    storage.save.mockResolvedValue({ id: 'background-b', name: 'B' })
    await ensureCameraStageProjectRuntime('background-b')
    const store = cameraStageProjectStore('background-b')
    const token = captureCameraStageUndo('background-b')
    store.getState().seek(3)
    store.getState().addPrimitive('box')
    await saveCameraStageProjectRuntime('background-b')
    const written = storage.save.mock.calls.at(-1)![0]
    expect(written.id).toBe('background-b')
    expect(deserializeScene(written.record.sceneJson).objects.length).toBe(b.objects.length + 1)
    expect(storage.save.mock.calls.at(-1)![1]).toBe(false)
    storage.save.mockRejectedValueOnce(new Error('disk-full'))
    store.getState().addPrimitive('sphere')
    await expect(saveCameraStageProjectRuntime('background-b')).rejects.toThrow('disk-full')
    expect(cameraStageProjectStore('background-b').getState().objects.length).toBe(b.objects.length + 2)
    await restoreCameraStageUndo(token)
    expect(cameraStageProjectStore('background-b').getState().objects.length).toBe(b.objects.length)
    expect(useCameraStageStore.getState()).toBe(before)
    expect(readCameraStagePlaybackRuntime()).toEqual(playback)
  })
  it('后台保存期间打开目标工程，不把原执行实例切换为新界面实例', async () => {
    useCameraStageStore.getState().loadSnapshot(deserializeScene(serializeScene(createDefaultCameraStageSceneSnapshot())), { id: 'switch-a', name: 'A' })
    storage.read.mockResolvedValue({ ...createDefaultCameraStageSceneSnapshot(), id: 'switch-b', name: 'B', createdAt: 1, updatedAt: 1 })
    const release = await leaseCameraStageProjectRuntime('switch-b')
    const original = cameraStageProjectStore('switch-b')
    original.getState().addPrimitive('box')
    let finish!: () => void
    storage.save.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve }))
    const saving = saveCameraStageProjectRuntime('switch-b')
    const assertion = expect(saving).rejects.toThrow('PROJECT_SESSION_CHANGED')
    useCameraStageStore.getState().loadSnapshot(deserializeScene(serializeScene(createDefaultCameraStageSceneSnapshot())), { id: 'switch-b', name: 'B' })
    const visible = useCameraStageStore.getState()
    finish()
    await assertion
    expect(useCameraStageStore.getState()).toBe(visible)
    expect(original.getState().objects.length).toBeGreaterThan(visible.objects.length)
    release()
  })
})
