// @vitest-environment jsdom
import { canvasTestRegistry, createCanvasTestProject, readCanvasTestProject, seedCanvasTestProject, setCanvasTestProjectState } from '@/tests/canvasProjectFixture'
import { describe, expect, it, vi } from 'vitest'
import { useCanvasStore } from '@/stores/canvasStore'
import { useProjectStore, type Project } from '@/stores/projectStore'
import { CANVAS_NODE_TYPES } from '../domain/canvasNodes'
import { createDefaultGenerationOutputItems } from '../domain/generationOutputs'
import { canvasNodeFactory } from './canvasServices'
import { withCanvasProjectRuntime } from './canvasProjectRuntime'
import { findCanvasProjectInstance, getCanvasProjectInstance, leaveCanvasProject, releaseCanvasProjectInstance } from './canvasProjectInstances'
import { commitCanvasGenerationOutputs, commitCanvasGenerationOutputsInProject } from './generationOutputApplicationService'

/*
 * 画布实例接到文档会话（3.4）：同一份画布全局只有一个实例；自动保存、离开、撤销记录与视口的会话状态、
 * 后台租约与释放都经正式实例与会话，“磁盘”是内存文档仓库替身。
 */

function project(id: string): Project {
  const node = canvasNodeFactory.createNode(CANVAS_NODE_TYPES.cameraStage, { x: 10, y: 20 }, {})
  node.id = `${id}-source`
  return { id, name: id, createdAt: 1, updatedAt: 1, coverPath: null, nodeCount: 1,
    nodes: [node], edges: [], history: { past: [], future: [] }, viewport: { x: 0, y: 0, zoom: 1 } }
}

async function output(id: string, completionId: string) {
  return withCanvasProjectRuntime(id, (runtime) => commitCanvasGenerationOutputs({
    sourceNodeId: `${id}-source`, resultNodeType: CANVAS_NODE_TYPES.exportImage, completionId,
    contract: { version: 1, strategy: 'single', resultKind: 'image', expectedOutputCount: 1,
      outputs: createDefaultGenerationOutputItems({ sources: ['media/result.png'], mediaType: 'image', resultKind: 'image', semanticKind: 'camera-stage-render' }) },
    persistOutput: async () => ({ patch: { imageUrl: 'media/result.png' }, createdFilePaths: [] }),
  }, { projectId: id, runtime }))
}

describe('画布文档实例', () => {
  it('内容变化自动保存进文档；拖动期间不标脏，松手后只写一次', async () => {
    const id = await createCanvasTestProject('自动保存')
    const { commands } = canvasTestRegistry()
    useCanvasStore.getState().addNode(CANVAS_NODE_TYPES.textAnnotation, { x: 0, y: 0 }, { content: '一' })
    await vi.waitFor(() => expect(readCanvasTestProject(id)?.nodes).toHaveLength(1))
    const writesBefore = commands.writes
    const nodeId = useCanvasStore.getState().nodes[0].id
    const move = (x: number, dragging: boolean) => useCanvasStore.getState().onNodesChange([{ type: 'position', id: nodeId, position: { x, y: 0 }, dragging }])
    for (let x = 1; x <= 4; x += 1) move(x * 10, true)
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(commands.writes).toBe(writesBefore)
    expect(findCanvasProjectInstance(id)!.session.dirty).toBe(false)
    move(50, false)
    await vi.waitFor(() => expect(readCanvasTestProject(id)?.nodes[0].position).toEqual({ x: 50, y: 0 }))
    expect(commands.writes).toBe(writesBefore + 1)
  })

  it('撤销记录与视口不写进文档；重新打开时按文档版本恢复撤销，视口照旧恢复', async () => {
    const id = await createCanvasTestProject('会话状态')
    const { commands } = canvasTestRegistry()
    useCanvasStore.getState().addNode(CANVAS_NODE_TYPES.textAnnotation, { x: 0, y: 0 }, { content: '可撤销' })
    useCanvasStore.getState().setViewportState({ x: 120, y: -40, zoom: 1.5 })
    expect(await leaveCanvasProject(id)).toBe('closed')
    const stored = commands.stored(id)!.content as Record<string, unknown>
    expect(Object.keys(stored).sort()).toEqual(['edges', 'nodes'])
    expect(await commands.readSessionState({ docId: id, key: 'canvas.viewport' })).toEqual({ x: 120, y: -40, zoom: 1.5 })
    const reopened = await getCanvasProjectInstance(id)
    expect(reopened.store.getState().currentViewport).toEqual({ x: 120, y: -40, zoom: 1.5 })
    expect(reopened.store.getState().history.past).toHaveLength(1)
    expect(reopened.store.getState().undo()).toBe(true)
    expect(reopened.store.getState().nodes).toHaveLength(0)
  })

  it('文件被别处改过（版本对不上）时不恢复旧撤销记录', async () => {
    const id = await createCanvasTestProject('版本不符')
    const { commands } = canvasTestRegistry()
    useCanvasStore.getState().addNode(CANVAS_NODE_TYPES.textAnnotation, { x: 0, y: 0 }, { content: '旧' })
    await leaveCanvasProject(id)
    const stored = commands.stored(id)!
    stored.meta = { ...stored.meta, revision: stored.meta.revision + 1 }
    const reopened = await getCanvasProjectInstance(id)
    expect(reopened.store.getState().history.past).toHaveLength(0)
    expect(reopened.store.getState().nodes).toHaveLength(1)
  })

  it('后台任务持有租约时不能释放；页面离开后后台继续写同一实例并保留撤销', async () => {
    const b = project('detached-work')
    seedCanvasTestProject(b)
    let continueTask!: () => void
    let entered = false
    const task = withCanvasProjectRuntime(b.id, async runtime => {
      entered = true
      await new Promise<void>(resolve => { continueTask = resolve })
      runtime.store.getState().updateNodeData(b.nodes[0].id, { displayName: '任务结果' })
      await runtime.persist()
    })
    await vi.waitFor(() => expect(entered).toBe(true))
    const instance = await getCanvasProjectInstance(b.id)
    expect(await releaseCanvasProjectInstance(b.id)).toBe(false)
    await withCanvasProjectRuntime(b.id, async runtime => {
      expect(runtime.store).toBe(instance.store)
      runtime.store.getState().updateNodePosition(b.nodes[0].id, { x: 200, y: 300 })
      await runtime.persist()
    })
    expect(await useProjectStore.getState().openCanvasDocument({ id: b.id })).toBe(true)
    expect(useCanvasStore.getState().nodes[0].position).toEqual({ x: 200, y: 300 })
    continueTask()
    await task
    expect(findCanvasProjectInstance(b.id)).toBe(instance)
    expect(useCanvasStore.getState().nodes[0].data.displayName).toBe('任务结果')
    expect(readCanvasTestProject(b.id)?.nodes[0].data.displayName).toBe('任务结果')
    expect(useCanvasStore.getState().undo()).toBe(true)
    expect(useCanvasStore.getState().nodes[0].data.displayName).not.toBe('任务结果')
  })

  it('离开不等后台租约：草稿决定照常处理、界面立即离开，任务写完后会话才关闭', async () => {
    const b = project('leave-work')
    seedCanvasTestProject(b)
    expect(await useProjectStore.getState().openCanvasDocument({ id: b.id })).toBe(true)
    let finish!: () => void
    const task = withCanvasProjectRuntime(b.id, async runtime => {
      await new Promise<void>(resolve => { finish = resolve })
      runtime.store.getState().updateNodeData(b.nodes[0].id, { displayName: '已提交任务' })
      await runtime.persist()
    })
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    expect(await useProjectStore.getState().closeProject()).toBe('closed')
    expect(useProjectStore.getState().currentProjectId).toBeNull()
    const instance = findCanvasProjectInstance(b.id)
    expect(instance?.session.isEnded).toBe(false)
    finish(); await task
    await vi.waitFor(() => expect(findCanvasProjectInstance(b.id)).toBeUndefined())
    expect(instance?.session.isEnded).toBe(true)
    expect(readCanvasTestProject(b.id)?.nodes[0].data.displayName).toBe('已提交任务')
  })


  it('打开画布发布时画布 store 已经同步，订阅者不会读到上一份的节点', async () => {
    const a = project('publish-a'); const b = project('publish-b')
    seedCanvasTestProject(b)
    setCanvasTestProjectState({ currentProjectId: a.id, currentProject: a })
    const observed: { id: string | null; nodeIds: string[] }[] = []
    const unsubscribe = useProjectStore.subscribe((state, previous) => {
      if (state.currentProjectId !== previous.currentProjectId) observed.push({ id: state.currentProjectId,
        nodeIds: useCanvasStore.getState().nodes.map(node => node.id) })
    })
    try {
      expect(await useProjectStore.getState().openCanvasDocument({ id: b.id })).toBe(true)
      // 先离开 A（已保存的直接关闭），再显示 B
      expect(observed.at(-1)).toEqual({ id: b.id, nodeIds: [b.nodes[0].id] })
      expect(findCanvasProjectInstance(a.id)).toBeUndefined()
    } finally { unsubscribe() }
  })

  it('当前在 A 时落图只写后台 B，不改当前画布；重试同完成键不重复节点', async () => {
    const a = project('active-a')
    const b = project('background-b')
    seedCanvasTestProject(b)
    setCanvasTestProjectState({ currentProjectId: a.id, currentProject: a })
    useCanvasStore.getState().setSelectedNode(a.nodes[0].id)
    const before = useCanvasStore.getState()
    await output(b.id, 'completion-b')
    expect(readCanvasTestProject(b.id)?.nodes).toHaveLength(2)
    const again = await output(b.id, 'completion-b')
    expect(again.idempotent).toBe(true)
    expect(readCanvasTestProject(b.id)?.nodes).toHaveLength(2)
    expect(useCanvasStore.getState()).toBe(before)
    expect(useProjectStore.getState().currentProjectId).toBe(a.id)
  })

  it('落图准备期间切走，原画布在后台只提交一次', async () => {
    const a = project('commit-a'); const b = project('commit-b')
    seedCanvasTestProject(b)
    setCanvasTestProjectState({ currentProjectId: a.id, currentProject: a })
    let release!: () => void
    const persistOutput = vi.fn(async () => {
      if (persistOutput.mock.calls.length === 1) await new Promise<void>(resolve => { release = resolve })
      return { patch: { imageUrl: 'media/result.png' }, createdFilePaths: [] }
    })
    const committing = commitCanvasGenerationOutputsInProject(a.id, { sourceNodeId: a.nodes[0].id,
      resultNodeType: CANVAS_NODE_TYPES.exportImage, completionId: 'origin-completion', persistOutput,
      contract: { version: 1, strategy: 'single', resultKind: 'image', expectedOutputCount: 1,
        outputs: createDefaultGenerationOutputItems({ sources: ['media/result.png'], mediaType: 'image', resultKind: 'image', semanticKind: 'generated-media' }) },
    })
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    setCanvasTestProjectState({ currentProjectId: b.id, currentProject: b })
    const active = useCanvasStore.getState()
    release()
    expect((await committing).resultNodeIds).toHaveLength(1)
    expect(persistOutput).toHaveBeenCalledTimes(1)
    expect(readCanvasTestProject(a.id)?.nodes).toHaveLength(2)
    expect(readCanvasTestProject(b.id)?.nodes).toHaveLength(1)
    expect(useCanvasStore.getState()).toBe(active)
  })

  it('保存失败保留修改并自动重试，确认保存成功后文件里才有新内容', async () => {
    const b = project('retry-b')
    seedCanvasTestProject(b)
    const { commands } = canvasTestRegistry()
    commands.failSaves = 1
    await expect(withCanvasProjectRuntime(b.id, async (runtime) => {
      runtime.store.getState().updateNodeData(b.nodes[0].id, { displayName: '待保存' })
      await runtime.persist()
    })).rejects.toThrow('保存未确认')
    expect(readCanvasTestProject(b.id)?.nodes[0].data.displayName).not.toBe('待保存')
    expect(findCanvasProjectInstance(b.id)!.store.getState().nodes[0].data.displayName).toBe('待保存')
    await vi.waitFor(() => expect(readCanvasTestProject(b.id)?.nodes[0].data.displayName).toBe('待保存'))
  })

  it('并发打开与后台执行共享一次加载', async () => {
    const b = project('slow-b')
    seedCanvasTestProject(b)
    const { commands } = canvasTestRegistry()
    const reads = commands.calls.filter((call) => call === 'readDocument').length
    const opening = useProjectStore.getState().openCanvasDocument({ id: b.id })
    const background = withCanvasProjectRuntime(b.id, async (runtime) => {
      runtime.store.getState().updateNodeData(b.nodes[0].id, { displayName: '新持久版本' })
      await runtime.persist()
    })
    await Promise.all([opening, background])
    expect(useCanvasStore.getState().nodes[0].data.displayName).toBe('新持久版本')
    expect(commands.calls.filter((call) => call === 'readDocument').length - reads).toBe(1)
  })

  it('草稿离开：空草稿直接删除；有内容时取消留在原处，不保存移到回收站', async () => {
    const { prompter, commands } = canvasTestRegistry()
    const empty = await useProjectStore.getState().createCanvasDraft()
    expect(commands.stored(empty!)?.meta.draft).toBe(true)
    expect(await useProjectStore.getState().closeProject()).toBe('discarded')
    expect(commands.stored(empty!)).toBeUndefined()

    const draft = await useProjectStore.getState().createCanvasDraft()
    useCanvasStore.getState().addNode(CANVAS_NODE_TYPES.textAnnotation, { x: 0, y: 0 }, { content: '有内容' })
    prompter.leaveChoices.push('cancel')
    expect(await useProjectStore.getState().closeProject()).toBe('cancelled')
    expect(useProjectStore.getState().currentProjectId).toBe(draft)
    prompter.leaveChoices.push('discard')
    expect(await useProjectStore.getState().closeProject()).toBe('discarded')
    expect(commands.trashed).toContain(draft)
    expect(useProjectStore.getState().currentProjectId).toBeNull()
  })
})
