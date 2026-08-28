// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  CANVAS_IMAGE_CAPABILITY_IDS,
  getCanvasImageCapability,
  type CanvasImageCapabilityDefinition,
} from '@/features/canvas/capabilities'
import {
  CANVAS_NODE_TYPES,
  type CanvasNode,
  type CanvasNodeType,
} from '@/features/canvas/domain/canvasNodes'
import { useCanvasStore } from '@/stores/canvasStore'
import { useProjectStore, type Project } from '@/stores/projectStore'

import { undoCanvasBatch, resetCanvasBatchStateForTests } from './canvasBatchService'
import { resetCanvasApplicationStateForTests } from './canvasApplicationService'
import { canvasEventBus } from './canvasServices'
import {
  createCanvasImageCapabilityExecutor,
  resetCanvasImageCapabilityApplicationStateForTests,
} from './canvasImageCapabilityApplicationService'

const projectId = 'image-capability-project'
const sourceNodeId = 'source-image'

function createSourceNode(): CanvasNode {
  return {
    id: sourceNodeId,
    type: CANVAS_NODE_TYPES.upload,
    position: { x: 80, y: 120 },
    measured: { width: 320, height: 260 },
    selected: true,
    data: { imageUrl: 'managed-source.png', aspectRatio: '1:1' },
  }
}

function createProject(node: CanvasNode): Project {
  return {
    id: projectId,
    name: '图片能力测试项目',
    createdAt: 1,
    updatedAt: 1,
    nodeCount: 1,
    coverPath: null,
    nodes: [node],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    history: { past: [], future: [] },
  }
}

function capabilityForNode(nodeType: CanvasNodeType): CanvasImageCapabilityDefinition {
  const base = getCanvasImageCapability(CANVAS_IMAGE_CAPABILITY_IDS.gridSplit)
  if (!base) throw new Error('缺少宫格切分能力测试基线')
  return {
    ...base,
    node: { kind: 'standard-generation', editor: 'standard' },
    implementation: {
      status: 'implemented',
      execution: { kind: 'canvas-node', nodeType },
    },
  }
}

describe('画布图片能力应用服务', () => {
  beforeEach(() => {
    resetCanvasApplicationStateForTests()
    resetCanvasBatchStateForTests()
    resetCanvasImageCapabilityApplicationStateForTests()
    const sourceNode = createSourceNode()
    const project = createProject(sourceNode)
    useCanvasStore.getState().setCanvasData([sourceNode], [], { past: [], future: [] })
    useCanvasStore.setState({
      currentViewport: { x: 0, y: 0, zoom: 1 },
      canvasViewportSize: { width: 1_200, height: 800 },
      selectedNodeId: sourceNodeId,
    })
    useProjectStore.setState({
      projects: [project],
      currentProjectId: projectId,
      currentProject: project,
      isHydrated: true,
      isOpeningProject: false,
      saveCurrentProject: vi.fn(),
    })
  })

  it('本地工具能力只打开现有对话框，不创建重复节点', async () => {
    const opened: Array<{ nodeId: string; toolType: string }> = []
    const unsubscribe = canvasEventBus.subscribe('tool-dialog/open', (payload) => opened.push(payload))
    const execute = createCanvasImageCapabilityExecutor()

    await execute(sourceNodeId, CANVAS_IMAGE_CAPABILITY_IDS.gridSplit)

    expect(opened).toEqual([{ nodeId: sourceNodeId, toolType: 'split-storyboard' }])
    expect(useCanvasStore.getState().nodes).toHaveLength(1)
    expect(useCanvasStore.getState().edges).toHaveLength(0)
    unsubscribe()
  })

  it('创建型能力原子完成相邻放置、连线、选中与单次撤销', async () => {
    const capability = capabilityForNode(CANVAS_NODE_TYPES.imageEdit)
    const execute = createCanvasImageCapabilityExecutor({
      getExecutableCapabilities: () => [capability],
    })

    const first = execute(sourceNodeId, capability.id)
    const duplicatedClick = execute(sourceNodeId, capability.id)
    expect(duplicatedClick).toBe(first)
    const result = await first

    expect(result).toMatchObject({ kind: 'canvas-node', sourceNodeId, capabilityId: capability.id })
    if (result.kind !== 'canvas-node') throw new Error('预期创建画布节点')
    const canvas = useCanvasStore.getState()
    expect(canvas.nodes).toHaveLength(2)
    expect(canvas.nodes.find((node) => node.id === result.nodeId)?.position.x).toBeGreaterThan(400)
    expect(canvas.edges).toEqual([
      expect.objectContaining({
        id: result.edgeId,
        source: sourceNodeId,
        target: result.nodeId,
        sourceHandle: 'source',
        targetHandle: 'param:__image',
      }),
    ])
    expect(canvas.selectedNodeId).toBe(result.nodeId)
    expect(canvas.nodes.find((node) => node.id === result.nodeId)?.selected).toBe(true)
    expect(canvas.history.past).toHaveLength(1)
    expect(useProjectStore.getState().saveCurrentProject).toHaveBeenCalled()

    expect(undoCanvasBatch(projectId, result.undoRef)).toMatchObject({ status: 'undone' })
    expect(useCanvasStore.getState().nodes).toHaveLength(1)
    expect(useCanvasStore.getState().edges).toHaveLength(0)
  })

  it('连线不兼容时回滚创建节点与历史，不留孤立节点', async () => {
    const incompatible = capabilityForNode(CANVAS_NODE_TYPES.intSource)
    const execute = createCanvasImageCapabilityExecutor({
      getExecutableCapabilities: () => [incompatible],
    })

    await expect(execute(sourceNodeId, incompatible.id)).rejects.toThrow('节点端口类型不兼容')
    expect(useCanvasStore.getState().nodes).toEqual([expect.objectContaining({ id: sourceNodeId })])
    expect(useCanvasStore.getState().edges).toEqual([])
    expect(useCanvasStore.getState().history).toEqual({ past: [], future: [] })
  })

  it('未实现的全景能力不能被强行执行', async () => {
    const execute = createCanvasImageCapabilityExecutor()
    await expect(execute(sourceNodeId, CANVAS_IMAGE_CAPABILITY_IDS.panorama)).rejects.toMatchObject({
      code: 'CAPABILITY_REJECTED',
    })
    expect(useCanvasStore.getState().nodes).toHaveLength(1)
  })
})
