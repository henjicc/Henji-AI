import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  openCanvasProjectWithSummaryFromAgent: vi.fn(),
  createCanvasProjectFromAgent: vi.fn(),
  focusCanvasNodeFromAgent: vi.fn(),
  downloadCanvasMediaFromAgent: vi.fn(),
  openApplicationSurface: vi.fn(),
  redoCanvasChangeFromAgent: vi.fn(),
  ungroupCanvasNodeFromAgent: vi.fn(),
  clearCanvasProjectFromAgent: vi.fn(),
  addGenerationResultToCanvas: vi.fn(),
  connectAssetGroupToTarget: vi.fn(),
  disconnectAssetGroupFromTarget: vi.fn(),
  executeCanvasImageCapabilityForProject: vi.fn(),
  exportMultiLayerDocumentTargetToCanvas: vi.fn(),
}))

vi.mock('@/features/canvas/domain/nodeControlRegistry', () => ({
  CANVAS_NODE_CONTROL_CATALOG_VERSION: 'test-catalog',
  getCanvasNodeSchema: vi.fn(),
  searchCanvasNodeTypes: vi.fn(() => []),
}))
vi.mock('@/features/canvas/application/canvasApplicationService', () => ({
  addCanvasNode: vi.fn(),
  connectCanvasNodes: vi.fn(),
  focusCanvasNode: mocks.focusCanvasNodeFromAgent,
  undoCanvasChange: vi.fn(),
  redoCanvasChange: mocks.redoCanvasChangeFromAgent,
}))
vi.mock('@/features/canvas/application/canvasBatchService', () => ({
  commitCanvasBatch: vi.fn(),
  planCanvasBatch: vi.fn(),
  previewCanvasBatch: vi.fn(),
}))
vi.mock('@/features/canvas/application/canvasProjectService', () => ({
  closeCanvasProject: vi.fn(),
  createCanvasProject: mocks.createCanvasProjectFromAgent,
  deleteCanvasProject: vi.fn(),
  openCanvasProjectWithSummary: mocks.openCanvasProjectWithSummaryFromAgent,
  renameCanvasProject: vi.fn(),
}))
vi.mock('@/features/canvas/application/canvasMutationService', () => ({
  deleteCanvasNodes: vi.fn(),
  disconnectCanvasEdge: vi.fn(),
  duplicateCanvasNode: vi.fn(),
  groupCanvasNodes: vi.fn(),
  ungroupCanvasNode: mocks.ungroupCanvasNodeFromAgent,
  clearCanvasProject: mocks.clearCanvasProjectFromAgent,
  connectAssetGroupToTarget: mocks.connectAssetGroupToTarget,
  disconnectAssetGroupFromTarget: mocks.disconnectAssetGroupFromTarget,
  selectCanvasNode: vi.fn(),
  updateCanvasNode: vi.fn(),
}))
vi.mock('@/features/canvas/application/canvasQueryService', () => ({
  getCanvasNode: vi.fn(),
  getCanvasProject: vi.fn(),
  listCanvasProjectSummaries: vi.fn(),
}))
vi.mock('@/features/assets/application/assetCanvasApplicationService', () => ({
  addAssetToCanvas: vi.fn(),
}))
vi.mock('./generationResultCanvasApplicationService', () => ({
  addGenerationResultToCanvas: mocks.addGenerationResultToCanvas,
}))
vi.mock('@/features/canvas/application/canvasDownloadService', () => ({
  downloadCanvasMedia: mocks.downloadCanvasMediaFromAgent,
}))
vi.mock('@/features/canvas/application/canvasImageCapabilityApplicationService', () => ({
  executeCanvasImageCapabilityForProject: mocks.executeCanvasImageCapabilityForProject,
}))
vi.mock('@/features/canvas/application/multiLayerDocumentNodeGenerationAdapter', () => ({
  exportMultiLayerDocumentTargetToCanvas: mocks.exportMultiLayerDocumentTargetToCanvas,
}))
vi.mock('../hostContext/hostContext', () => ({
  createHostContextSnapshot: vi.fn(() => ({ scopeRevisions: { canvas: 0 } })),
}))
vi.mock('./surfaceRegistry', () => ({ openApplicationSurface: mocks.openApplicationSurface }))

import type { CapabilityHandler } from './handlerTypes'
import { registerCanvasCapabilityHandlers } from './registerCanvasCapabilityHandlers'

const context = { signal: new AbortController().signal }

function registeredHandlers(): Map<string, CapabilityHandler> {
  const handlers = new Map<string, CapabilityHandler>()
  registerCanvasCapabilityHandlers({
    registerHandler: (id, handler) => handlers.set(id, handler),
  })
  return handlers
}

describe('canvas capability handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.openApplicationSurface.mockImplementation((surfaceId: string) => ({ surfaceId }))
  })

  it('打开画布项目成功后才进入画布 Surface', async () => {
    mocks.openCanvasProjectWithSummaryFromAgent.mockResolvedValue({
      projectId: 'project-1',
      name: '项目一',
      nodeCount: 2,
    })
    const handler = registeredHandlers().get('open_canvas_project')

    const result = await handler?.({ projectId: 'project-1' }, context)

    expect(result).toMatchObject({ projectId: 'project-1', surfaceId: 'workspace.canvas' })
    expect(mocks.openApplicationSurface).toHaveBeenCalledWith('workspace.canvas', context)
    expect(
      mocks.openCanvasProjectWithSummaryFromAgent.mock.invocationCallOrder[0]
    ).toBeLessThan(mocks.openApplicationSurface.mock.invocationCallOrder[0])
  })

  it('创建画布项目不切换当前界面', async () => {
    mocks.createCanvasProjectFromAgent.mockResolvedValue({
      projectId: 'project-created',
      name: '后台画布',
    })
    const handler = registeredHandlers().get('create_canvas_project')

    const result = await handler?.({ name: '后台画布' }, context)

    expect(result).toMatchObject({ projectId: 'project-created' })
    expect(mocks.openApplicationSurface).not.toHaveBeenCalled()
  })

  it('生成结果桥梁把稳定引用和绝对坐标原样交给组合服务', async () => {
    mocks.addGenerationResultToCanvas.mockReturnValue({
      projectId: 'project-1', nodeId: 'node-1', nodeType: 'uploadNode',
      nodeRef: { kind: 'canvas.node', id: 'node-1' },
      resultRef: { kind: 'generation.result', id: 'task-1' }, undoRef: 'undo-1',
    })
    const handler = registeredHandlers().get('add_generation_result_to_canvas')
    const input = {
      projectId: 'project-1', resultRef: { kind: 'generation.result' as const, id: 'task-1' },
      placement: { mode: 'absolute' as const, x: 320, y: 180 },
    }

    const result = await handler?.(input, context)

    expect(mocks.addGenerationResultToCanvas).toHaveBeenCalledWith(input)
    expect(result).toMatchObject({ nodeId: 'node-1' })
  })

  it('图片能力处理器把稳定能力编号交给统一画布事务服务', async () => {
    mocks.executeCanvasImageCapabilityForProject.mockResolvedValue({
      projectId: 'project-1', kind: 'canvas-node',
      capabilityId: 'image.background-removal', sourceNodeId: 'source-1',
      nodeId: 'node-1', edgeId: 'edge-1', undoRef: 'undo-1',
    })
    const handler = registeredHandlers().get('apply_canvas_image_capability')
    const input = {
      projectId: 'project-1', sourceNodeId: 'source-1',
      capabilityId: 'image.background-removal' as const,
    }

    const result = await handler?.(input, context)

    expect(mocks.executeCanvasImageCapabilityForProject).toHaveBeenCalledWith(input)
    expect(result).toMatchObject({ nodeId: 'node-1', edgeId: 'edge-1' })
  })

  it('定位节点时自动载入目标项目、打开画布后再聚焦', async () => {
    mocks.openCanvasProjectWithSummaryFromAgent.mockResolvedValue({
      projectId: 'project-2',
      name: '项目二',
      nodeCount: 1,
    })
    mocks.focusCanvasNodeFromAgent.mockResolvedValue({
      projectId: 'project-2',
      nodeId: 'node-1',
      focused: true,
    })
    const handler = registeredHandlers().get('focus_canvas_node')

    const result = await handler?.({ projectId: 'project-2', nodeId: 'node-1' }, context)

    expect(result).toMatchObject({
      projectId: 'project-2',
      nodeId: 'node-1',
      focused: true,
      surfaceId: 'workspace.canvas',
    })
    expect(mocks.openApplicationSurface).toHaveBeenCalledWith('workspace.canvas', context)
    expect(
      mocks.openCanvasProjectWithSummaryFromAgent.mock.invocationCallOrder[0]
    ).toBeLessThan(mocks.focusCanvasNodeFromAgent.mock.invocationCallOrder[0])
    expect(
      mocks.openApplicationSurface.mock.invocationCallOrder[0]
    ).toBeLessThan(mocks.focusCanvasNodeFromAgent.mock.invocationCallOrder[0])
  })

  it('批量下载只把稳定节点 ID 和已配置目标模式交给正式服务', async () => {
    mocks.downloadCanvasMediaFromAgent.mockResolvedValue({
      projectId: 'project-3',
      requestedCount: 2,
      savedNodeIds: ['node-1', 'node-2'],
      failedNodeIds: [],
      destinationMode: 'quick',
    })
    const handler = registeredHandlers().get('download_canvas_media')
    const input = {
      projectId: 'project-3',
      nodeIds: ['node-1', 'node-2'],
      destination: { mode: 'quick' as const },
    }

    const result = await handler?.(input, context)

    expect(mocks.downloadCanvasMediaFromAgent).toHaveBeenCalledWith(input)
    expect(result).toMatchObject({ savedNodeIds: ['node-1', 'node-2'] })
  })

  it('重做只需要 projectId，转发给正式服务', async () => {
    mocks.redoCanvasChangeFromAgent.mockReturnValue({ projectId: 'project-1', status: 'redone' })
    const handler = registeredHandlers().get('redo_canvas_change')

    const result = await handler?.({ projectId: 'project-1' }, context)

    expect(mocks.redoCanvasChangeFromAgent).toHaveBeenCalledWith('project-1')
    expect(result).toMatchObject({ status: 'redone' })
  })

  it('解散分组把 projectId 和 groupNodeId 转发给正式服务', async () => {
    mocks.ungroupCanvasNodeFromAgent.mockReturnValue({ projectId: 'project-1', groupNodeId: 'group-1', undoRef: 'canvas-undo:1' })
    const handler = registeredHandlers().get('ungroup_canvas_node')

    const result = await handler?.({ projectId: 'project-1', groupNodeId: 'group-1' }, context)

    expect(mocks.ungroupCanvasNodeFromAgent).toHaveBeenCalledWith('project-1', 'group-1')
    expect(result).toMatchObject({ groupNodeId: 'group-1' })
  })

  it('素材组绑定与解绑转发到统一领域服务', async () => {
    mocks.connectAssetGroupToTarget.mockReturnValue({
      projectId: 'project-1', groupNodeId: 'group-1', targetNodeId: 'target-1',
      connected: 2, pending: 1, unsupported: 0, excluded: 0, undoRef: 'canvas-undo:2',
    })
    const connect = registeredHandlers().get('connect_asset_group_to_target')
    await connect?.({ projectId: 'project-1', groupNodeId: 'group-1', targetNodeId: 'target-1' }, context)
    expect(mocks.connectAssetGroupToTarget).toHaveBeenCalledWith('project-1', 'group-1', 'target-1')

    mocks.disconnectAssetGroupFromTarget.mockReturnValue({
      projectId: 'project-1', groupNodeId: 'group-1', targetNodeId: 'target-1', undoRef: 'canvas-undo:3',
    })
    const disconnect = registeredHandlers().get('disconnect_asset_group_from_target')
    await disconnect?.({ projectId: 'project-1', groupNodeId: 'group-1', targetNodeId: 'target-1' }, context)
    expect(mocks.disconnectAssetGroupFromTarget).toHaveBeenCalledWith('project-1', 'group-1', 'target-1')
  })

  it('清空画布只需要 projectId，转发给正式服务', async () => {
    mocks.clearCanvasProjectFromAgent.mockReturnValue({
      projectId: 'project-1', clearedNodeCount: 3, clearedEdgeCount: 1, undoRef: 'canvas-undo:2',
    })
    const handler = registeredHandlers().get('clear_canvas')

    const result = await handler?.({ projectId: 'project-1' }, context)

    expect(mocks.clearCanvasProjectFromAgent).toHaveBeenCalledWith('project-1')
    expect(result).toMatchObject({ clearedNodeCount: 3, clearedEdgeCount: 1 })
  })

  it('多图层目标导出处理器只委托 UI 共用的领域事务入口', async () => {
    const input = {
      projectRef: { kind: 'canvas.project', id: 'project-1' },
      sourceNodeRef: { kind: 'canvas.node', id: 'document-node' },
      targetRef: { kind: 'image_edit.layer', id: 'v3:document:raster' },
    }
    mocks.exportMultiLayerDocumentTargetToCanvas.mockResolvedValue({
      ...input,
      nodeRef: { kind: 'canvas.node', id: 'export-node' },
      edgeRef: { kind: 'canvas.edge', id: 'export-edge' },
      undoRef: 'undo-export', width: 400, height: 300, mediaType: 'image/png',
    })
    const handler = registeredHandlers().get('export_image_edit_target_to_canvas')

    const result = await handler?.(input, context)

    expect(mocks.exportMultiLayerDocumentTargetToCanvas).toHaveBeenCalledWith({
      ...input, signal: context.signal,
    })
    expect(result).toMatchObject({
      nodeRef: { kind: 'canvas.node', id: 'export-node' },
      edgeRef: { kind: 'canvas.edge', id: 'export-edge' },
    })
  })
})
