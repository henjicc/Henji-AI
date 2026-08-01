import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  openCanvasProjectWithSummaryFromAgent: vi.fn(),
  createCanvasProjectFromAgent: vi.fn(),
  focusCanvasNodeFromAgent: vi.fn(),
  downloadCanvasMediaFromAgent: vi.fn(),
  openApplicationSurface: vi.fn(),
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
vi.mock('@/features/canvas/application/canvasDownloadService', () => ({
  downloadCanvasMedia: mocks.downloadCanvasMediaFromAgent,
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
})
