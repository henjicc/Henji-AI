// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CANVAS_NODE_TYPES } from '@/features/canvas/domain/canvasNodes'
import { useCanvasStore } from '@/stores/canvasStore'
import { useProjectStore, type Project } from '@/stores/projectStore'
import { useSettingsStore } from '@/stores/settingsStore'

import {
  addCanvasNode,
  addTrustedMediaCanvasNode,
  connectCanvasNodes,
  focusCanvasNode,
  isCanvasProjectContextCurrent,
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
    useSettingsStore.getState().setAutoInsertTextDisplayNode(false)
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

  it('异步执行上下文只允许写回发起项目', () => {
    expect(isCanvasProjectContextCurrent(projectId, projectId)).toBe(true)
    expect(isCanvasProjectContextCurrent(projectId, 'project-b')).toBe(false)
    expect(isCanvasProjectContextCurrent(projectId, null)).toBe(false)
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

  it('开启设置后原子插入一个共享文本展示节点并复用于多个目标', () => {
    const processing = addCanvasNode({
      projectId,
      nodeType: CANVAS_NODE_TYPES.textProcessing,
      placement: { mode: 'viewport_center' },
      data: { prompt: '优化提示词' },
    })
    const firstTarget = addCanvasNode({
      projectId,
      nodeType: CANVAS_NODE_TYPES.imageEdit,
      placement: { mode: 'right_of_node', anchorNodeId: String(processing.nodeId) },
      data: { prompt: '' },
    })
    const secondTarget = addCanvasNode({
      projectId,
      nodeType: CANVAS_NODE_TYPES.videoGen,
      placement: { mode: 'right_of_node', anchorNodeId: String(firstTarget.nodeId) },
      data: { prompt: '' },
    })
    useSettingsStore.getState().setAutoInsertTextDisplayNode(true)

    const first = connectCanvasNodes({
      projectId,
      sourceNodeId: String(processing.nodeId),
      targetNodeId: String(firstTarget.nodeId),
      targetHandle: 'param:__prompt',
    })
    const second = connectCanvasNodes({
      projectId,
      sourceNodeId: String(processing.nodeId),
      targetNodeId: String(secondTarget.nodeId),
      targetHandle: 'param:__prompt',
    })

    const displayNodes = useCanvasStore.getState().nodes.filter(
      (node) => node.type === CANVAS_NODE_TYPES.textAnnotation
    )
    expect(displayNodes).toHaveLength(1)
    expect(first).toMatchObject({
      effectiveSourceNodeId: displayNodes[0].id,
      createdNodeIds: [displayNodes[0].id],
    })
    expect(first.createdEdgeIds).toHaveLength(2)
    expect(second).toMatchObject({ effectiveSourceNodeId: displayNodes[0].id })
    expect(useCanvasStore.getState().edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: processing.nodeId, target: displayNodes[0].id }),
      expect.objectContaining({ source: displayNodes[0].id, target: firstTarget.nodeId }),
      expect.objectContaining({ source: displayNodes[0].id, target: secondTarget.nodeId }),
    ]))
  })

  it('自动插入节点与两条连线可用一次撤销完整恢复', () => {
    const processing = addCanvasNode({
      projectId,
      nodeType: CANVAS_NODE_TYPES.textProcessing,
      placement: { mode: 'viewport_center' },
      data: { prompt: '优化提示词' },
    })
    const target = addCanvasNode({
      projectId,
      nodeType: CANVAS_NODE_TYPES.imageEdit,
      placement: { mode: 'right_of_node', anchorNodeId: String(processing.nodeId) },
      data: { prompt: '' },
    })
    useSettingsStore.getState().setAutoInsertTextDisplayNode(true)

    const connection = connectCanvasNodes({
      projectId,
      sourceNodeId: String(processing.nodeId),
      targetNodeId: String(target.nodeId),
      targetHandle: 'param:__prompt',
    })
    expect(useCanvasStore.getState().nodes).toHaveLength(3)
    expect(useCanvasStore.getState().edges).toHaveLength(2)

    expect(undoCanvasChange(projectId, String(connection.undoRef))).toMatchObject({ status: 'undone' })
    expect(useCanvasStore.getState().nodes).toHaveLength(2)
    expect(useCanvasStore.getState().edges).toHaveLength(0)
  })

  it('自动插入连接被循环检测拒绝时不留下展示节点或悬空边', () => {
    const processing = addCanvasNode({
      projectId,
      nodeType: CANVAS_NODE_TYPES.textProcessing,
      placement: { mode: 'viewport_center' },
    })
    const target = addCanvasNode({
      projectId,
      nodeType: CANVAS_NODE_TYPES.imageEdit,
      placement: { mode: 'right_of_node', anchorNodeId: String(processing.nodeId) },
    })
    useCanvasStore.getState().onConnect({
      source: String(target.nodeId),
      target: String(processing.nodeId),
      sourceHandle: 'source',
      targetHandle: 'target',
    })
    const before = useCanvasStore.getState()
    useSettingsStore.getState().setAutoInsertTextDisplayNode(true)

    expect(() => connectCanvasNodes({
      projectId,
      sourceNodeId: String(processing.nodeId),
      targetNodeId: String(target.nodeId),
      targetHandle: 'param:__prompt',
    })).toThrow('循环依赖')
    expect(useCanvasStore.getState().nodes).toHaveLength(before.nodes.length)
    expect(useCanvasStore.getState().edges).toHaveLength(before.edges.length)
    expect(useCanvasStore.getState().nodes.some(
      (node) => node.type === CANVAS_NODE_TYPES.textAnnotation
    )).toBe(false)
  })

  it('文本处理无输出时只原子创建一次文本展示节点', () => {
    const processing = addCanvasNode({
      projectId,
      nodeType: CANVAS_NODE_TYPES.textProcessing,
      placement: { mode: 'viewport_center' },
    })
    const beforeHistory = useCanvasStore.getState().history.past.length
    const firstDisplayId = useCanvasStore.getState().ensureTextDisplayOutput(
      String(processing.nodeId),
      { content: '' },
    )
    const secondDisplayId = useCanvasStore.getState().ensureTextDisplayOutput(
      String(processing.nodeId),
      { content: '' },
    )

    expect(firstDisplayId).toBeTruthy()
    expect(secondDisplayId).toBeNull()
    expect(useCanvasStore.getState().nodes).toHaveLength(2)
    expect(useCanvasStore.getState().edges).toHaveLength(1)
    expect(useCanvasStore.getState().history.past).toHaveLength(beforeHistory + 1)
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
