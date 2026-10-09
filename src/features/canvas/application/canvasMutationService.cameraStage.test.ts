// @vitest-environment jsdom
import { setCanvasTestProjectState, readCanvasTestProject, canvasSaveSpy } from '@/tests/canvasProjectFixture'
import { loadCameraStageTestProject, cameraStageTestDocuments } from '@/tests/cameraStageProjectFixture'
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as documentOperations from '@/features/documents/documentOperations'
import { createDefaultCameraStageSceneSnapshot } from '@/features/cameraStage/domain/defaultSceneSnapshot'
import { sceneFromDocumentContent, sceneToDocumentContent } from '@/features/cameraStage/domain/sceneSerialization'
import { cameraStageDocumentRegistry, cameraStageProjectStore } from '@/features/cameraStage/application/cameraStageProjectRuntime'
import { useCanvasStore } from '@/stores/canvasStore'
import { CANVAS_NODE_TYPES, type CanvasNode } from '../domain/canvasNodes'
import { getNodeDefinition } from '../domain/nodeRegistry'
import { useCanvasDuplication } from '../hooks/useCanvasDuplication'
import { commitCanvasNodeDuplication, duplicateCanvasNode } from './canvasMutationService'
import { redoCanvasChange, undoCanvasChange } from './canvasApplicationService'
import { findCanvasProjectInstance } from './canvasProjectInstances'
import { runCanvasTransaction } from './canvasBatchService'
import { CanvasPersistenceError } from './canvasPersistenceService'

const projectId = 'camera-copy-canvas'
const cameraId = 'camera-source'
const sourceId = 'camera-node'
let operations: documentOperations.DocumentOperations

beforeEach(async () => {
  const snapshot = sceneFromDocumentContent(sceneToDocumentContent(createDefaultCameraStageSceneSnapshot()))
  await loadCameraStageTestProject(snapshot, { id: cameraId, name: '来源镜头' })
  const commands = cameraStageTestDocuments()!
  operations = new documentOperations.DocumentOperations({ registry: cameraStageDocumentRegistry(), commands: {
    ...documentOperations.defaultDocumentOperationCommands,
    duplicateDocument: request => commands.duplicateDocument(request),
    trashDocument: target => commands.trashDocument(target),
  } })
  vi.spyOn(documentOperations, 'getDocumentOperations').mockReturnValue(operations)
  const source: CanvasNode = {
    id: sourceId, type: CANVAS_NODE_TYPES.cameraStage, position: { x: 100, y: 80 },
    data: { ...getNodeDefinition(CANVAS_NODE_TYPES.cameraStage).createDefaultData(), projectId: cameraId },
  } as CanvasNode
  setCanvasTestProjectState({ currentProjectId: projectId, currentProject: {
    id: projectId, name: '复制画布', createdAt: 1, updatedAt: 1, nodeCount: 1, coverPath: null,
    nodes: [source], edges: [], viewport: { x: 0, y: 0, zoom: 1 }, history: { past: [], future: [] },
  }, isOpeningProject: false })
})

afterEach(() => { cleanup(); vi.restoreAllMocks() })

function view() {
  const canvas = useCanvasStore.getState()
  const persist = vi.fn()
  const hook = renderHook(() => useCanvasDuplication({
    nodes: canvas.nodes, edges: canvas.edges, selectedNodeIds: [],
    addNode: canvas.addNode, applyNodesChange: canvas.onNodesChange,
    connectNodes: canvas.onConnect, setSelectedNode: canvas.setSelectedNode, scheduleCanvasPersist: persist,
  }))
  return { ...hook, persist }
}

const duplicate = () => duplicateCanvasNode({ projectId, nodeId: sourceId, placement: { mode: 'absolute', x: 500, y: 80 } })
const documents = () => cameraStageTestDocuments()!
const cameraDocuments = () => documents().listDocuments({ kind: 'camera_stage' })

function assertCopy(nodeId: string): string {
  const copy = findCanvasProjectInstance(projectId)!.store.getState().nodes.find(node => node.id === nodeId)!
  const id = copy.data.projectId as string
  expect(id).not.toBe(cameraId)
  expect(documents().stored(id)?.content).toEqual(documents().stored(cameraId)?.content)
  expect(documents().stored(id)?.content).not.toBe(documents().stored(cameraId)?.content)
  expect(findCanvasProjectInstance(projectId)!.store.getState().nodes.find(node => node.id === sourceId)?.data.projectId).toBe(cameraId)
  return id
}

describe('3D 节点统一来源复制生命周期', () => {
  it('UI 与能力路径均复制最新内容，来源独立且完成前不提交节点', async () => {
    cameraStageProjectStore(cameraId).getState().addPrimitive('box')
    const ui = view()
    const actual = operations.duplicateDocument.bind(operations)
    let finish!: () => void
    vi.spyOn(operations, 'duplicateDocument').mockImplementationOnce((...args) => new Promise((resolve, reject) => {
      finish = () => { void actual(...args).then(resolve, reject) }
    }))
    let pending!: ReturnType<typeof ui.result.current.duplicateNodes>
    act(() => { pending = ui.result.current.duplicateNodes([sourceId]) })
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    expect(useCanvasStore.getState().nodes).toHaveLength(1)
    let uiId!: string
    await act(async () => { finish(); uiId = (await pending)!.firstNodeId! })
    const uiDocument = assertCopy(uiId)
    const result = await duplicate()
    const capabilityDocument = assertCopy(String(result.nodeId))
    expect(uiDocument).not.toBe(capabilityDocument)
    expect(readCanvasTestProject(projectId)?.nodes.find(node => node.id === result.nodeId)?.data.projectId).toBe(capabilityDocument)
    const saved = documents().stored(cameraId)!.content as { objects: { type: string }[] }
    expect(saved.objects.map(object => object.type)).toContain('primitive')
  })

  it('能力副本一次撤销移除节点，重做继续指向同一新文档', async () => {
    const result = await duplicate()
    const newId = assertCopy(String(result.nodeId))
    await undoCanvasChange(projectId, String(result.undoRef))
    expect(useCanvasStore.getState().nodes.map(node => node.id)).toEqual([sourceId])
    await redoCanvasChange(projectId)
    expect(assertCopy(String(result.nodeId))).toBe(newId)
    expect(await cameraDocuments()).toHaveLength(2)
  })

  it('普通组中的 3D 子节点连同父子关系和内部连线复制，一次撤销并可重做', async () => {
    const canvas = useCanvasStore.getState()
    const uploadId = canvas.addNode(CANVAS_NODE_TYPES.upload, { x: 20, y: 10 }, { imageUrl: '/source.png' })
    canvas.onConnect({ source: uploadId, target: sourceId, sourceHandle: 'source', targetHandle: 'target' })
    const groupId = canvas.groupNodes([sourceId, uploadId])!
    const before = useCanvasStore.getState()
    expect(before.edges).toHaveLength(1)
    const ui = view()
    let result!: Awaited<ReturnType<typeof ui.result.current.duplicateNodes>>
    await act(async () => { result = await ui.result.current.duplicateNodes([groupId]) })
    const cameraCopy = result!.idMap.get(sourceId)!
    const newId = assertCopy(cameraCopy)
    const current = useCanvasStore.getState()
    expect(current.nodes.find(node => node.id === cameraCopy)?.parentId).toBe(result!.idMap.get(groupId))
    expect(current.edges.some(edge => edge.source === result!.idMap.get(uploadId) && edge.target === cameraCopy)).toBe(true)
    expect(current.history.past.length).toBe(before.history.past.length + 1)
    act(() => { useCanvasStore.getState().undo() })
    expect(useCanvasStore.getState().nodes.map(node => node.id)).toEqual(before.nodes.map(node => node.id))
    expect(useCanvasStore.getState().edges).toEqual(before.edges)
    act(() => { useCanvasStore.getState().redo() })
    expect(assertCopy(cameraCopy)).toBe(newId)
  })

  it('批内第二份来源失败时不提交任何节点，逆序撤回已复制来源', async () => {
    const extraId = useCanvasStore.getState().addNode(CANVAS_NODE_TYPES.cameraStage, { x: 0, y: 0 }, { projectId: cameraId })
    const before = useCanvasStore.getState()
    const actual = operations.duplicateDocument.bind(operations)
    vi.spyOn(operations, 'duplicateDocument').mockImplementationOnce(actual).mockRejectedValueOnce(new Error('copy failed'))
    const ui = view()
    await act(async () => { await expect(ui.result.current.duplicateNodes([sourceId, extraId])).rejects.toThrow('copy failed') })
    expect(useCanvasStore.getState().nodes).toBe(before.nodes)
    expect(useCanvasStore.getState().history).toBe(before.history)
    expect(await cameraDocuments()).toHaveLength(1)
    expect(ui.persist).not.toHaveBeenCalled()
  })

  it('Alt 拖拽副本的位移与来源复制合为一次撤销，重做保留最终位置', async () => {
    const before = useCanvasStore.getState()
    const ui = view()
    await act(async () => ui.result.current.handleNodeDragStart(new MouseEvent('mousedown', { altKey: true }), before.nodes[0]))
    await vi.waitFor(() => expect(useCanvasStore.getState().nodes).toHaveLength(2))
    const copied = useCanvasStore.getState().nodes.find(node => node.id !== sourceId)!
    act(() => {
      useCanvasStore.getState().onNodesChange(ui.result.current.routeDuplicationChanges([
        { id: sourceId, type: 'position', position: { x: 420, y: 170 }, dragging: true },
      ]))
      useCanvasStore.getState().onNodesChange(ui.result.current.routeDuplicationChanges([
        { id: sourceId, type: 'position', position: { x: 420, y: 170 }, dragging: false },
      ]))
      ui.result.current.handleNodeDragStop(new MouseEvent('mouseup'), before.nodes[0])
    })
    expect(useCanvasStore.getState().history.past.length).toBe(before.history.past.length + 1)
    const id = assertCopy(copied.id)
    act(() => { useCanvasStore.getState().undo() })
    expect(useCanvasStore.getState().nodes.map(node => node.id)).toEqual([sourceId])
    act(() => { useCanvasStore.getState().redo() })
    expect(assertCopy(copied.id)).toBe(id)
    expect(useCanvasStore.getState().nodes.find(node => node.id === copied.id)?.position).toEqual({ x: 420, y: 170 })
  })

  it('提交中途失败恢复节点和历史，并撤回来源；补偿失败明确上报', async () => {
    const before = useCanvasStore.getState()
    const input = { projectId, sourceNodeId: sourceId, data: { projectId: cameraId }, createNode: (data: Record<string, unknown>) => {
      useCanvasStore.getState().addNode(CANVAS_NODE_TYPES.cameraStage, { x: 0, y: 0 }, data)
      throw new Error('node failed')
    } }
    await expect(commitCanvasNodeDuplication(input)).rejects.toThrow('node failed')
    expect(useCanvasStore.getState().nodes).toBe(before.nodes)
    expect(useCanvasStore.getState().history).toBe(before.history)
    expect(await cameraDocuments()).toHaveLength(1)
    vi.spyOn(operations, 'trashDocument').mockRejectedValueOnce(new Error('trash failed'))
    await expect(commitCanvasNodeDuplication(input)).rejects.toThrow('补偿未完成')
    expect(useCanvasStore.getState().nodes).toBe(before.nodes)
  })

  it('来源不存在时能力复制明确失败，UI 切换画布也会撤回已准备的来源', async () => {
    useCanvasStore.getState().updateNodeData(sourceId, { projectId: 'missing' })
    await expect(duplicate()).rejects.toThrow('来源文档不存在')
    expect(useCanvasStore.getState().nodes).toHaveLength(1)
    useCanvasStore.getState().updateNodeData(sourceId, { projectId: cameraId })
    const ui = view()
    const actual = operations.duplicateDocument.bind(operations)
    vi.spyOn(operations, 'duplicateDocument').mockImplementationOnce(async (...args) => {
      const result = await actual(...args)
      setCanvasTestProjectState({ currentProjectId: null, currentProject: null })
      return result
    })
    await act(async () => { await expect(ui.result.current.duplicateNodes([sourceId])).rejects.toThrow('画布已切换') })
    expect(findCanvasProjectInstance(projectId)!.store.getState().nodes).toHaveLength(1)
    expect(await cameraDocuments()).toHaveLength(1)
  })

  it('离屏能力复制仍写入明确目标；保存失败保留副本供原保存重试', async () => {
    const instance = findCanvasProjectInstance(projectId)!
    setCanvasTestProjectState({ currentProjectId: null, currentProject: null })
    const result = await duplicate()
    assertCopy(String(result.nodeId))
    expect(instance.store.getState().nodes).toHaveLength(2)
    canvasSaveSpy().mockRejectedValueOnce(new Error('save failed'))
    await expect(duplicate()).rejects.toBeInstanceOf(CanvasPersistenceError)
    expect(instance.store.getState().nodes).toHaveLength(3)
    expect(await cameraDocuments()).toHaveLength(3)
  })

  it('外层批事务后续步骤失败，也撤回先前成功复制的来源', async () => {
    await expect(runCanvasTransaction(projectId, 2, async options => {
      await duplicateCanvasNode({ projectId, nodeId: sourceId, placement: { mode: 'absolute', x: 0, y: 0 } }, options)
      throw new Error('next step failed')
    })).rejects.toThrow('next step failed')
    expect(useCanvasStore.getState().nodes.map(node => node.id)).toEqual([sourceId])
    expect(readCanvasTestProject(projectId)?.nodes.map(node => node.id)).toEqual([sourceId])
    expect(await cameraDocuments()).toHaveLength(1)
  })
})
