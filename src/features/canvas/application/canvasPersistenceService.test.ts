import { canvasSaveSpy, canvasTestRegistry, setCanvasTestProjectState, createCanvasTestProject, readCanvasTestProject } from '@/tests/canvasProjectFixture'
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useCanvasStore } from '@/stores/canvasStore'
import { useProjectStore } from '@/stores/projectStore'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { CANVAS_NODE_TYPES } from '../domain/canvasNodes'
import { addCanvasNode, undoCanvasChange } from './canvasApplicationService'
import { applyCanvasOperationsAtomically, runCanvasTransaction } from './canvasBatchService'
import { confirmCanvasPersistence, runPersistedCanvasUndo } from './canvasPersistenceService'
import { commitCanvasSpecialEditor, openCanvasSpecialEditor } from './specialEditorApplicationService'
import { useCanvasSpecialEditorController } from './specialEditorController'

describe('共享画布保存完成屏障', () => {
  let projectId: string
  beforeEach(async () => {
    installHarnessNativeStorage()
    useCanvasStore.getState().setCanvasData([], [], { past: [], future: [] })
    setCanvasTestProjectState({ currentProject: null, currentProjectId: null })
    projectId = await createCanvasTestProject('隔离保存测试')
  })
  afterEach(() => {
    vi.restoreAllMocks()
    setCanvasTestProjectState({ currentProjectId: null, currentProject: null })
    uninstallHarnessNativeStorage()
  })

  it('新增等待原生存储确认；拒绝后只重试保存，不重复创建与历史', async () => {
    const save = canvasSaveSpy()
    canvasTestRegistry().commands.failSaves = 1
    await expect(addCanvasNode({ projectId, nodeType: CANVAS_NODE_TYPES.upload,
      placement: { mode: 'viewport_center' } })).rejects.toMatchObject({
      code: 'PERSISTENCE_FAILED', memoryState: 'modified',
      recovery: { capabilityId: 'retry_canvas_project_save', replayMutation: false },
    })
    const before = useCanvasStore.getState()
    expect(before.nodes).toHaveLength(1)
    expect(readCanvasTestProject(projectId)!.nodes).toEqual([])
    await confirmCanvasPersistence(projectId)
    expect(useCanvasStore.getState().nodes).toBe(before.nodes)
    expect(useCanvasStore.getState().history).toBe(before.history)
    expect(readCanvasTestProject(projectId)!.nodes).toHaveLength(1)
    expect(save).toHaveBeenCalledTimes(2)
    expect(useProjectStore.getState().persistenceError).toBeNull()
  })

  it('同一批多项写入只保存最终节点与合并后的历史', async () => {
    const save = canvasSaveSpy()
    await applyCanvasOperationsAtomically(projectId, [
      { kind: 'add_node', nodeType: CANVAS_NODE_TYPES.upload, placement: { mode: 'viewport_center' } },
      { kind: 'add_node', nodeType: CANVAS_NODE_TYPES.upload, placement: { mode: 'viewport_center' } },
    ])
    expect(save).toHaveBeenCalledTimes(1)
    expect(readCanvasTestProject(projectId)!.nodes).toHaveLength(2)
    // 撤销记录不进文档（会话状态），内存里合并成一步
    expect(useCanvasStore.getState().history.past).toHaveLength(1)
  })

  it('旧工程迟到保存失败不误归属新工程，返回后恢复未保存快照再重试', async () => {
    let refuse!: () => void
    const blocked = new Promise<void>((_resolve, reject) => { refuse = () => reject(new Error('A readonly')) })
    canvasSaveSpy().mockImplementationOnce(async () => { await blocked; throw new Error('unreachable') })
    const creating = addCanvasNode({ projectId, nodeType: CANVAS_NODE_TYPES.upload,
      placement: { mode: 'viewport_center' } })
    const failure = expect(creating).rejects.toThrow('保存未确认')
    await Promise.resolve()
    const otherId = await createCanvasTestProject('工程 B')
    useCanvasStore.getState().setCanvasData([], [], { past: [], future: [] })
    refuse()
    await failure
    expect(useProjectStore.getState().persistenceError).toBeNull()
    expect(useProjectStore.getState().persistenceErrors[projectId]).toBe('project.persistenceFailed')
    await confirmCanvasPersistence(projectId)
    await confirmCanvasPersistence(otherId)
    expect(useProjectStore.getState().persistenceErrors[projectId]).toBeUndefined()
    expect(readCanvasTestProject(projectId)!.nodes).toHaveLength(1)
    useProjectStore.getState().openProject(projectId)
    await vi.waitFor(() => expect(useProjectStore.getState().currentProjectId).toBe(projectId))
    const restored = useProjectStore.getState().currentProject!
    expect(restored.nodes).toHaveLength(1)
    useCanvasStore.getState().setCanvasData(restored.nodes, restored.edges, restored.history)
    await confirmCanvasPersistence(projectId)
    expect(readCanvasTestProject(projectId)!.nodes).toHaveLength(1)
    expect(useProjectStore.getState().persistenceErrors[projectId]).toBeUndefined()
  })

  it('存储挂起时不能提前返回新增结果', async () => {
    let release!: () => void
    canvasTestRegistry().commands.saveGate = new Promise<void>((resolve) => { release = resolve })
    let completed = false
    const result = addCanvasNode({ projectId, nodeType: CANVAS_NODE_TYPES.upload,
      placement: { mode: 'viewport_center' } }).then(() => { completed = true })
    await Promise.resolve()
    expect(completed).toBe(false)
    expect(readCanvasTestProject(projectId)!.nodes).toHaveLength(0)
    release()
    await result
    expect(readCanvasTestProject(projectId)!.nodes).toHaveLength(1)
  })

  it('撤销保存失败后用同一 token 重试不再次撤销', async () => {
    const first = await addCanvasNode({ projectId, nodeType: CANVAS_NODE_TYPES.upload,
      placement: { mode: 'viewport_center' } })
    await addCanvasNode({ projectId, nodeType: CANVAS_NODE_TYPES.upload,
      placement: { mode: 'viewport_center' } })
    const second = await addCanvasNode({ projectId, nodeType: CANVAS_NODE_TYPES.upload,
      placement: { mode: 'viewport_center' } })
    canvasTestRegistry().commands.failSaves = 1
    await expect(undoCanvasChange(projectId, String(second.undoRef))).rejects.toThrow('保存未确认')
    const history = useCanvasStore.getState().history
    await undoCanvasChange(projectId, String(second.undoRef))
    expect(useCanvasStore.getState().history).toBe(history)
    expect(useCanvasStore.getState().nodes).toHaveLength(2)
    expect(readCanvasTestProject(projectId)!.nodes).toHaveLength(2)
    await expect(undoCanvasChange(projectId, String(first.undoRef))).rejects.toThrow('旧撤销引用失效')
  })

  it('异步事务发生外部编辑后失败不覆盖新内容', async () => {
    const operation = runCanvasTransaction(projectId, 1, async (options) => {
      const created = await addCanvasNode({ projectId, nodeType: CANVAS_NODE_TYPES.upload,
        placement: { mode: 'viewport_center' } }, options)
      useCanvasStore.getState().updateNodeData(String(created.nodeId), { displayName: '用户新编辑' })
      throw new Error('后续操作失败')
    })
    await expect(operation).rejects.toMatchObject({
      code: 'STALE_CONTEXT', memoryState: 'preserved', cause: new Error('后续操作失败'),
    })
    expect(useCanvasStore.getState().nodes[0].data.displayName).toBe('用户新编辑')
    await confirmCanvasPersistence(projectId)
    expect(readCanvasTestProject(projectId)!.nodes[0].data.displayName).toBe('用户新编辑')
  })

  it('新编辑、切换或删除项目使失败撤销的待重试快照失效', async () => {
    canvasTestRegistry().commands.failSaves = 1
    // 撤销真的改了画布（会话才有东西要写）
    const apply = vi.fn(() => { useCanvasStore.getState().addNode(CANVAS_NODE_TYPES.upload, { x: 0, y: 0 }) })
    const owner = {}
    await expect(runPersistedCanvasUndo(projectId, 'expired-after-delete', apply, owner)).rejects.toThrow('保存未确认')
    await useProjectStore.getState().closeProject()
    await canvasTestRegistry().commands.trashDocument({ id: projectId })
    await expect(runPersistedCanvasUndo(projectId, 'expired-after-delete', apply, owner)).rejects.toThrow('PROJECT_NOT_FOUND')
    expect(apply).toHaveBeenCalledTimes(1)
  })

  it('专用编辑确认拒绝时保留草稿，重试只保存不再次写入图与历史', async () => {
    const nodeId = useCanvasStore.getState().addNode(CANVAS_NODE_TYPES.imageEdit, { x: 0, y: 0 }, { prompt: '之前' })
    await confirmCanvasPersistence(projectId)
    const sessionId = openCanvasSpecialEditor({ projectId, nodeId, editorKey: 'relight', initialState: { prompt: '之前' } })
    useCanvasSpecialEditorController.getState().updateDraft({ prompt: '之后' })
    canvasTestRegistry().commands.failSaves = 1
    await expect(commitCanvasSpecialEditor(sessionId)).rejects.toThrow('保存未确认')
    expect(useCanvasSpecialEditorController.getState().session?.sessionId).toBe(sessionId)
    const before = useCanvasStore.getState()
    await commitCanvasSpecialEditor(sessionId)
    expect(useCanvasStore.getState().nodes).toBe(before.nodes)
    expect(useCanvasStore.getState().history).toBe(before.history)
    expect(useCanvasSpecialEditorController.getState().session).toBeNull()
    expect(readCanvasTestProject(projectId)!.nodes[0].data.prompt).toBe('之后')
  })

  it('旧专用编辑等待存储期间不提前关闭，也不会关闭新打开的会话', async () => {
    const nodeId = useCanvasStore.getState().addNode(CANVAS_NODE_TYPES.imageEdit, { x: 0, y: 0 }, { prompt: '之前' })
    await confirmCanvasPersistence(projectId)
    const sessionId = openCanvasSpecialEditor({ projectId, nodeId, editorKey: 'relight', initialState: { prompt: '之前' } })
    useCanvasSpecialEditorController.getState().updateDraft({ prompt: '之后' })
    let release!: () => void
    canvasTestRegistry().commands.saveGate = new Promise<void>((resolve) => { release = resolve })
    const completion = commitCanvasSpecialEditor(sessionId)
    await Promise.resolve()
    expect(useCanvasSpecialEditorController.getState().session?.sessionId).toBe(sessionId)
    const newSession = openCanvasSpecialEditor({ projectId, nodeId, editorKey: 'relight', initialState: { prompt: '之后' } })
    release()
    await completion
    expect(useCanvasSpecialEditorController.getState().session?.sessionId).toBe(newSession)
    useCanvasSpecialEditorController.getState().discard()
  })

  it('持续失败只保留有界撤销重试；被淘汰的 token 不重放业务', async () => {
    canvasTestRegistry().commands.failSaves = Number.MAX_SAFE_INTEGER
    const apply = vi.fn(() => { useCanvasStore.getState().addNode(CANVAS_NODE_TYPES.upload, { x: 0, y: 0 }) })
    const owners = Array.from({ length: 205 }, () => ({}))
    for (let index = 0; index < owners.length; index += 1) {
      await expect(runPersistedCanvasUndo(projectId, `bounded-${index}`, apply, owners[index])).rejects.toThrow('保存未确认')
    }
    await expect(runPersistedCanvasUndo(projectId, 'bounded-0', apply, owners[0])).rejects.toThrow('撤销引用已失效')
    expect(apply).toHaveBeenCalledTimes(205)
    canvasTestRegistry().commands.failSaves = 0
    await useProjectStore.getState().closeProject()
    await canvasTestRegistry().commands.trashDocument({ id: projectId })
    await expect(runPersistedCanvasUndo(projectId, 'bounded-204', apply, owners[204])).rejects.toThrow('PROJECT_NOT_FOUND')
    expect(apply).toHaveBeenCalledTimes(205)
  })
})
