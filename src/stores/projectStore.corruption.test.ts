// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { useProjectStore } from './projectStore'
import { useCanvasStore } from './canvasStore'
import { fromProjectRecord, toProjectRecord } from './projectStoreSerialization'

describe('损坏工程不得替换有效工程或未保存现场', () => {
  beforeEach(() => {
    installHarnessNativeStorage()
    useProjectStore.setState({ projects: [], currentProject: null, currentProjectId: null,
      openError: null, persistenceError: null, persistenceErrors: {}, isHydrated: true })
    useCanvasStore.getState().setCanvasData([], [], { past: [], future: [] })
  })
  afterEach(() => { vi.restoreAllMocks(); uninstallHarnessNativeStorage() })

  it('有效A打开损坏B不切换、不保存B；恢复原记录后可以再次打开', async () => {
    const store = useProjectStore.getState()
    const b = await store.createProject('B')
    const native = window.henjiNative!.storyboardProjects
    const original = (await native.getProjectRecord(b))!
    const a = await store.createProject('A')
    const before = useProjectStore.getState().currentProject
    const save = vi.spyOn(native, 'upsertProjectRecord')
    const get = vi.spyOn(native, 'getProjectRecord').mockResolvedValueOnce({ ...original, nodesJson: '[broken' })
    store.openProject(b)
    await vi.waitFor(() => expect(useProjectStore.getState().isOpeningProject).toBe(false))
    expect(useProjectStore.getState()).toMatchObject({ currentProjectId: a, currentProject: before,
      openError: 'project.openFailed' })
    expect(save).not.toHaveBeenCalled()
    get.mockRestore()
    store.openProject(b)
    await vi.waitFor(() => expect(useProjectStore.getState().currentProjectId).toBe(b))
    expect(useProjectStore.getState().openError).toBeNull()
  })

  it('保存拒绝后的合法dirty优先，不读坏DB、不丢内存、不宣称保存成功', async () => {
    const store = useProjectStore.getState()
    const id = await store.createProject('dirty')
    const native = window.henjiNative!.storyboardProjects
    const original = (await native.getProjectRecord(id))!
    const save = vi.spyOn(native, 'upsertProjectRecord').mockRejectedValue(new Error('protected corrupt record'))
    const nodes = [{ id: 'edited', type: 'uploadNode' as const, position: { x: 0, y: 0 },
      data: { mediaType: 'image' as const, imageUrl: '/kept.png' } }]
    useCanvasStore.getState().setCanvasData(nodes, [], { past: [], future: [] })
    const retained = useCanvasStore.getState().nodes
    await expect(store.closeProject()).rejects.toThrow('protected corrupt record')
    const get = vi.spyOn(native, 'getProjectRecord').mockResolvedValue({ ...original, nodesJson: '[broken' })
    store.openProject(id)
    await vi.waitFor(() => expect(useProjectStore.getState().isOpeningProject).toBe(false))
    expect(get).not.toHaveBeenCalled()
    expect(useProjectStore.getState().currentProject?.nodes).toBe(retained)
    expect(useProjectStore.getState().persistenceError).toBe('project.persistenceFailed')
    save.mockRestore(); get.mockRestore()
    await store.closeProject() // 显式解除拒写后清理本测试的dirty队列。
  })

  it('合法媒体池与大历史经正式renderer编码解码无丢失', async () => {
    await useProjectStore.getState().createProject('roundtrip')
    const base = useProjectStore.getState().currentProject!
    const n = { id: 'image', type: 'uploadNode' as const, position: { x: 0, y: 0 },
      data: { mediaType: 'image' as const, imageUrl: '/photo.png', prompt: '文'.repeat(1_600_000) } }
    const value = fromProjectRecord(toProjectRecord({ ...base, nodes: [n], nodeCount: 1,
      history: { past: [{ nodes: [n], edges: [] }], future: [] } }))
    expect(value.nodes[0].data.imageUrl).toBe('/photo.png')
    expect(value.history.past[0].nodes[0].data.prompt).toBe(n.data.prompt)
    expect(value.history.past[0].nodes[0].data.imageUrl).toBe('/photo.png')
  })

  it('成功新建或关闭后清除上次打开失败，不留下过期提示', async () => {
    useProjectStore.setState({ openError: 'project.openFailed' })
    await useProjectStore.getState().createProject('new')
    expect(useProjectStore.getState().openError).toBeNull()
    useProjectStore.setState({ openError: 'project.openFailed' })
    await useProjectStore.getState().closeProject()
    expect(useProjectStore.getState().openError).toBeNull()
  })
})
