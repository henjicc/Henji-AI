// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CANVAS_NODE_TYPES } from '@/features/canvas/domain/canvasNodes'
import { useCanvasStore } from '@/stores/canvasStore'
import { useProjectStore, type Project } from '@/stores/projectStore'

import {
  addCanvasNodeFromAgent,
  connectCanvasNodesFromAgent,
  focusCanvasNodeFromAgent,
  registerCanvasNodeFocusHandler,
  resetAgentCanvasActionStateForTests,
  undoCanvasChangeFromAgent,
} from './agentCanvasActions'

const projectId = 'project-stage5'

function emptyProject(): Project {
  return {
    id: projectId,
    name: '第五阶段测试项目',
    createdAt: 1,
    updatedAt: 1,
    nodeCount: 0,
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    history: { past: [], future: [] },
  }
}

describe('agent canvas actions', () => {
  beforeEach(() => {
    resetAgentCanvasActionStateForTests()
    useCanvasStore.getState().setCanvasData([], [], { past: [], future: [] })
    useCanvasStore.setState({
      currentViewport: { x: 0, y: 0, zoom: 1 },
      canvasViewportSize: { width: 1_200, height: 800 },
    })
    const project = emptyProject()
    useProjectStore.setState({
      projects: [project],
      currentProjectId: projectId,
      currentProject: project,
      isHydrated: true,
      isOpeningProject: false,
      saveCurrentProject: vi.fn(),
    })
  })

  it('按目录 schema 添加、确定性布局、合法连接并逐步撤销', () => {
    const upload = addCanvasNodeFromAgent({
      projectId,
      nodeType: CANVAS_NODE_TYPES.upload,
      placement: { mode: 'viewport_center' },
      data: { displayName: '输入图' },
    })
    const uploadId = String(upload.nodeId)
    const generation = addCanvasNodeFromAgent({
      projectId,
      nodeType: CANVAS_NODE_TYPES.imageEdit,
      placement: { mode: 'right_of_node', anchorNodeId: uploadId },
      data: { prompt: '一只纸雕风格的猫' },
    })
    const generationId = String(generation.nodeId)
    const connection = connectCanvasNodesFromAgent({
      projectId,
      sourceNodeId: uploadId,
      targetNodeId: generationId,
    })

    expect(useCanvasStore.getState().nodes).toHaveLength(2)
    expect(useCanvasStore.getState().edges).toEqual([
      expect.objectContaining({
        id: connection.edgeId,
        source: uploadId,
        target: generationId,
        sourceHandle: 'source',
        targetHandle: 'param:__image',
      }),
    ])
    expect(useCanvasStore.getState().nodes[1].position.x).toBeGreaterThan(
      useCanvasStore.getState().nodes[0].position.x
    )

    expect(undoCanvasChangeFromAgent(projectId, String(connection.undoRef))).toMatchObject({ status: 'undone' })
    expect(useCanvasStore.getState().edges).toHaveLength(0)
    undoCanvasChangeFromAgent(projectId, String(generation.undoRef))
    expect(useCanvasStore.getState().nodes).toHaveLength(1)
    undoCanvasChangeFromAgent(projectId, String(upload.undoRef))
    expect(useCanvasStore.getState().nodes).toHaveLength(0)
  })

  it('拒绝目录外节点、任意媒体路径和非当前项目', () => {
    expect(() => addCanvasNodeFromAgent({
      projectId,
      nodeType: 'unknownNode',
      placement: { mode: 'viewport_center' },
    })).toThrow(/不支持节点类型/)
    expect(() => addCanvasNodeFromAgent({
      projectId,
      nodeType: CANVAS_NODE_TYPES.upload,
      placement: { mode: 'viewport_center' },
      data: { imageUrl: 'C:\\secret\\probe.png' },
    })).toThrow()
    expect(() => addCanvasNodeFromAgent({
      projectId: 'other-project',
      nodeType: CANVAS_NODE_TYPES.upload,
      placement: { mode: 'viewport_center' },
    })).toThrow(/项目与命令目标不一致/)
  })

  it('通过画布注册的窄处理器定位节点', async () => {
    const created = addCanvasNodeFromAgent({
      projectId,
      nodeType: CANVAS_NODE_TYPES.upload,
      placement: { mode: 'viewport_center' },
    })
    const focused: string[] = []
    const dispose = registerCanvasNodeFocusHandler((nodeId) => { focused.push(nodeId) })

    await expect(focusCanvasNodeFromAgent(
      projectId,
      String(created.nodeId),
      new AbortController().signal
    )).resolves.toMatchObject({ focused: true })
    expect(focused).toEqual([created.nodeId])
    dispose()
  })
})
