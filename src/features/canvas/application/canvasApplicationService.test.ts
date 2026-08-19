// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CANVAS_NODE_TYPES } from '@/features/canvas/domain/canvasNodes'
import { useCanvasStore } from '@/stores/canvasStore'
import { useProjectStore, type Project } from '@/stores/projectStore'

import {
  addCanvasNode,
  addTrustedMediaCanvasNode,
  connectCanvasNodes,
  focusCanvasNode,
  redoCanvasChange,
  registerCanvasNodeFocusHandler,
  resetCanvasApplicationStateForTests,
  undoCanvasChange,
} from './canvasApplicationService'

const projectId = 'project-stage5'

function emptyProject(): Project {
  return {
    id: projectId,
    name: '第五阶段测试项目',
    createdAt: 1,
    updatedAt: 1,
    nodeCount: 0,
    coverPath: null,
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    history: { past: [], future: [] },
  }
}

describe('canvas application service', () => {
  beforeEach(() => {
    resetCanvasApplicationStateForTests()
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
    const upload = addCanvasNode({
      projectId,
      nodeType: CANVAS_NODE_TYPES.upload,
      placement: { mode: 'viewport_center' },
      data: { displayName: '输入图' },
    })
    const uploadId = String(upload.nodeId)
    const generation = addCanvasNode({
      projectId,
      nodeType: CANVAS_NODE_TYPES.imageEdit,
      placement: { mode: 'right_of_node', anchorNodeId: uploadId },
      data: { prompt: '一只纸雕风格的猫' },
    })
    const generationId = String(generation.nodeId)
    const connection = connectCanvasNodes({
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

    expect(undoCanvasChange(projectId, String(connection.undoRef))).toMatchObject({ status: 'undone' })
    expect(useCanvasStore.getState().edges).toHaveLength(0)
    undoCanvasChange(projectId, String(generation.undoRef))
    expect(useCanvasStore.getState().nodes).toHaveLength(1)
    undoCanvasChange(projectId, String(upload.undoRef))
    expect(useCanvasStore.getState().nodes).toHaveLength(0)
  })

  it('把正式素材数据落成可读取的媒体源节点', () => {
    const created = addTrustedMediaCanvasNode({
      projectId,
      nodeType: CANVAS_NODE_TYPES.upload,
      placement: { mode: 'viewport_center' },
      data: {
        imageUrl: 'C:/managed-assets/result.png',
        previewImageUrl: 'henji-media://asset/result',
        aspectRatio: '4:3',
        sourceFileName: 'result.png',
        isSizeManuallyAdjusted: false,
      },
    })
    expect(useCanvasStore.getState().nodes.find((node) => node.id === created.nodeId)?.data)
      .toMatchObject({
        imageUrl: 'C:/managed-assets/result.png',
        previewImageUrl: 'henji-media://asset/result',
        aspectRatio: '4:3',
      })
  })

  it('绝对坐标布局不依赖当前视口，可精确复现脚本位置', () => {
    useCanvasStore.setState({ currentViewport: { x: 900, y: -400, zoom: 2 } })
    const created = addCanvasNode({
      projectId,
      nodeType: CANVAS_NODE_TYPES.stringSource,
      placement: { mode: 'absolute', x: 320, y: 180 },
      data: { value: '绝对坐标' },
    })
    expect(useCanvasStore.getState().nodes.find((node) => node.id === created.nodeId)?.position)
      .toEqual({ x: 320, y: 180 })
  })

  it('按明确参数端口连接文本值节点与图片生成节点', () => {
    const prompt = addCanvasNode({
      projectId,
      nodeType: CANVAS_NODE_TYPES.stringSource,
      placement: { mode: 'viewport_center' },
      data: { displayName: '提示词', value: '一只纸雕风格的猫' },
    })
    const generation = addCanvasNode({
      projectId,
      nodeType: CANVAS_NODE_TYPES.imageEdit,
      placement: { mode: 'right_of_node', anchorNodeId: String(prompt.nodeId) },
      data: { prompt: '' },
    })

    const connection = connectCanvasNodes({
      projectId,
      sourceNodeId: String(prompt.nodeId),
      targetNodeId: String(generation.nodeId),
      sourceHandle: 'source',
      targetHandle: 'param:__prompt',
    })

    expect(connection).toMatchObject({ sourceHandle: 'source', targetHandle: 'param:__prompt' })
    expect(useCanvasStore.getState().edges).toContainEqual(expect.objectContaining({
      source: prompt.nodeId,
      target: generation.nodeId,
      sourceHandle: 'source',
      targetHandle: 'param:__prompt',
    }))
  })

  it('撤销之后能重做，重做之后没有可重做操作时拒绝', () => {
    const upload = addCanvasNode({
      projectId,
      nodeType: CANVAS_NODE_TYPES.upload,
      placement: { mode: 'viewport_center' },
      data: { displayName: '输入图' },
    })
    expect(useCanvasStore.getState().nodes).toHaveLength(1)

    undoCanvasChange(projectId, String(upload.undoRef))
    expect(useCanvasStore.getState().nodes).toHaveLength(0)

    expect(redoCanvasChange(projectId)).toMatchObject({ projectId, status: 'redone' })
    expect(useCanvasStore.getState().nodes).toHaveLength(1)

    expect(() => redoCanvasChange(projectId)).toThrow('当前画布没有可重做操作')
  })

  it('撤销之后新的编辑会清空重做栈', () => {
    const upload = addCanvasNode({
      projectId,
      nodeType: CANVAS_NODE_TYPES.upload,
      placement: { mode: 'viewport_center' },
    })
    undoCanvasChange(projectId, String(upload.undoRef))
    addCanvasNode({
      projectId,
      nodeType: CANVAS_NODE_TYPES.upload,
      placement: { mode: 'viewport_center' },
    })

    expect(() => redoCanvasChange(projectId)).toThrow('当前画布没有可重做操作')
  })

  it('拒绝目录外节点、任意媒体路径和非当前项目', () => {
    expect(() => addCanvasNode({
      projectId,
      nodeType: 'unknownNode',
      placement: { mode: 'viewport_center' },
    })).toThrow(/不支持节点类型/)
    expect(() => addCanvasNode({
      projectId,
      nodeType: CANVAS_NODE_TYPES.upload,
      placement: { mode: 'viewport_center' },
      data: { imageUrl: 'C:\\secret\\probe.png' },
    })).toThrow()
    expect(() => addCanvasNode({
      projectId: 'other-project',
      nodeType: CANVAS_NODE_TYPES.upload,
      placement: { mode: 'viewport_center' },
    })).toThrow(/项目与命令目标不一致/)
  })

  it('通过画布注册的窄处理器定位节点', async () => {
    const created = addCanvasNode({
      projectId,
      nodeType: CANVAS_NODE_TYPES.upload,
      placement: { mode: 'viewport_center' },
    })
    const focused: string[] = []
    const dispose = registerCanvasNodeFocusHandler((nodeId) => { focused.push(nodeId) })

    await expect(focusCanvasNode(
      projectId,
      String(created.nodeId),
      new AbortController().signal
    )).resolves.toMatchObject({ focused: true })
    expect(focused).toEqual([created.nodeId])
    dispose()
  })
})
