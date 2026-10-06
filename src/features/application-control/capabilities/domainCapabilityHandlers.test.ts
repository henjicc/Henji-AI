// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { registerCameraStageCapabilityHandlers } from '@/features/cameraStage/application/registerCameraStageCapabilityHandlers'
import { registerImageEditCapabilityHandlers } from '@/features/imageEdit/application/registerImageEditCapabilityHandlers'

const mocks = vi.hoisted(() => ({
  commitImageEdit: vi.fn(),
  getToolboxState: vi.fn(),
  listToolboxTools: vi.fn(),
  cameraAdapter: {
    applyCameraStageCameraMove: vi.fn(),
    deleteCameraStageObject: vi.fn(),
    duplicateCameraStageObject: vi.fn(),
    observeCameraStagePreview: vi.fn(),
    observeCameraStageScene: vi.fn(),
    placeCameraStageObject: vi.fn(),
    updateCameraStageObject: vi.fn(),
    verifyCameraStage: vi.fn(),
  },
  cameraRenderAdapter: {
    cancelCameraStageRenderTask: vi.fn(),
    getCameraStageRenderTask: vi.fn(),
    waitCameraStageRenderTask: vi.fn(),
    recoverCameraStageRenderTask: vi.fn(),
    renderCameraStageOutput: vi.fn(),
  },
  selectToolboxTool: vi.fn(),
  openApplicationSurface: vi.fn(),
  openCameraStageDocument: vi.fn(),
  createImageEditPreviewFromRef: vi.fn(),
}))

vi.mock('@/features/imageEdit/application/imageEditApplicationService', () => ({
  commitImageEdit: mocks.commitImageEdit,
}))
vi.mock('@/features/toolbox/application/toolboxApplicationService', () => ({
  getToolboxState: mocks.getToolboxState,
  listToolboxTools: mocks.listToolboxTools,
}))
vi.mock('@/features/cameraStage/application/cameraStageCapabilityAdapter', () => mocks.cameraAdapter)
vi.mock('@/features/cameraStage/application/cameraStageRenderCapabilityAdapter', () => mocks.cameraRenderAdapter)
vi.mock('@/features/cameraStage/projects/cameraStageProjectService', () => ({ openCameraStageDocument: mocks.openCameraStageDocument }))
vi.mock('@/stores/navigationStore', () => ({ selectToolboxTool: mocks.selectToolboxTool }))
vi.mock('@/features/navigation/application/surfaceCapabilityService', () => ({ openApplicationSurface: mocks.openApplicationSurface }))
vi.mock('@/features/imageEdit/application/imageSourceCapabilityService', () => ({
  createImageEditPreviewFromRef: mocks.createImageEditPreviewFromRef,
}))

import type { CapabilityHandler } from '@/features/application-control/capabilities/handlerTypes'
import { registerToolboxCapabilityHandlers } from '@/features/toolbox/application/registerToolboxCapabilityHandlers'
import { getDocumentOperations } from '@/features/documents/documentOperations'
import type { DocumentSummary } from '@/core/documents/types'

const context = { signal: new AbortController().signal }

function registeredHandlers(): Map<string, CapabilityHandler> {
  const handlers = new Map<string, CapabilityHandler>()
  for (const register of [registerToolboxCapabilityHandlers, registerCameraStageCapabilityHandlers, registerImageEditCapabilityHandlers]) {
    register({ registerHandler: (id, handler) => handlers.set(id, handler) })
  }
  return handlers
}

describe('toolbox capability handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.openApplicationSurface.mockImplementation((surfaceId: string) => ({ surfaceId }))
  })

  it('镜头参考登记了通用打开方式：文档打开成功后才进入 3D Surface；失败时不切换界面', async () => {
    registeredHandlers()
    const document = { id: 'stage-1', kind: 'camera_stage', path: '/work/镜头参考/a.henji-stage' } as DocumentSummary
    expect(getDocumentOperations().canOpen('camera_stage')).toBe(true)
    mocks.openCameraStageDocument.mockResolvedValue(undefined)
    await getDocumentOperations().openDocument(document)
    expect(mocks.openCameraStageDocument).toHaveBeenCalledWith({ id: 'stage-1', path: '/work/镜头参考/a.henji-stage' })
    expect(mocks.openApplicationSurface).toHaveBeenCalledWith('tool.camera_stage')
    expect(mocks.openCameraStageDocument.mock.invocationCallOrder[0]).toBeLessThan(mocks.openApplicationSurface.mock.invocationCallOrder[0])

    mocks.openApplicationSurface.mockClear()
    mocks.openCameraStageDocument.mockRejectedValue(new Error('NOT_FOUND'))
    await expect(getDocumentOperations().openDocument(document)).rejects.toThrow('NOT_FOUND')
    expect(mocks.openApplicationSurface).not.toHaveBeenCalled()
  })

  it('镜头参考不再有自己的项目管理能力（列出、新建、打开、改名、删除走通用文档能力）', () => {
    const handlers = registeredHandlers()
    for (const id of ['list_camera_stage_projects', 'get_camera_stage_project', 'open_camera_stage_project', 'create_camera_stage_project', 'rename_camera_stage_project', 'delete_camera_stage_project']) {
      expect(handlers.has(id), id).toBe(false)
    }
  })

  it('3D 输出任务处理器委托共享服务并保持稳定任务引用', async () => {
    const taskRef = { kind: 'camera_stage.render_task' as const, id: 'task-ref-1' }
    mocks.cameraRenderAdapter.renderCameraStageOutput.mockResolvedValue({
      taskRef,
      status: 'submitted',
      resultRefs: [taskRef],
    })
    mocks.cameraRenderAdapter.getCameraStageRenderTask.mockResolvedValue({
      taskRef,
      status: 'running',
      phase: 'rendering',
      progress: 0.5,
      outputKind: 'image',
      message: null,
      resultRefs: [],
    })
    mocks.cameraRenderAdapter.cancelCameraStageRenderTask.mockResolvedValue({
      taskRef,
      status: 'cancellation_requested',
      resultRefs: [],
    })
    const handlers = registeredHandlers()
    const renderInput = {
      canvasRef: { kind: 'canvas.document' as const, id: 'canvas-1' },
      nodeRef: { kind: 'canvas.node' as const, id: 'canvas-1:stage-node' },
      outputKind: 'image' as const,
      resolutionPreset: '720p' as const,
    }

    await expect(handlers.get('render_camera_stage_output')?.(renderInput, context))
      .resolves.toMatchObject({ status: 'submitted', taskRef })
    await expect(handlers.get('get_camera_stage_render_task')?.({ taskRef }, context))
      .resolves.toMatchObject({ status: 'running', taskRef })
    await expect(handlers.get('cancel_camera_stage_render_task')?.({ taskRef }, context))
      .resolves.toMatchObject({ status: 'cancellation_requested', taskRef })
    expect(mocks.cameraRenderAdapter.renderCameraStageOutput).toHaveBeenCalledWith(renderInput, context)
    expect(mocks.cameraRenderAdapter.getCameraStageRenderTask).toHaveBeenCalledWith(taskRef)
    expect(mocks.cameraRenderAdapter.cancelCameraStageRenderTask).toHaveBeenCalledWith(taskRef)
  })

  it('选择工具通过统一 Surface 入口，关闭工具只清空选择', async () => {
    const handler = registeredHandlers().get('select_toolbox_tool')

    await handler?.({ toolId: 'cameraStage' }, context)
    expect(mocks.openApplicationSurface).toHaveBeenCalledWith('tool.camera_stage', context)

    const closed = await handler?.({ toolId: null }, context)
    expect(mocks.selectToolboxTool).toHaveBeenCalledWith(null)
    expect(closed).toEqual({ toolId: null, surfaceId: null })
  })

  it('后台创建图片预览不会顺带打开图片编辑器', async () => {
    mocks.createImageEditPreviewFromRef.mockResolvedValue({
      previewRef: 'preview-1',
      resultRefs: [{ kind: 'image_edit.preview', id: 'preview-1' }],
      operationCount: 1,
      hasEffect: true,
      width: 512,
      height: 512,
    })
    const handler = registeredHandlers().get('create_image_edit_preview')

    const result = await handler?.({
      sourceRef: { kind: 'asset', id: 'asset-1' },
      operations: [{ kind: 'rotate_cw' }],
    }, context)

    expect(mocks.createImageEditPreviewFromRef).toHaveBeenCalledWith({
      sourceRef: { kind: 'asset', id: 'asset-1' },
      operations: [{ kind: 'rotate_cw' }],
    })
    expect(mocks.openApplicationSurface).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      previewRef: 'preview-1',
      sourceRef: { kind: 'asset', id: 'asset-1' },
      resultRefs: [{ kind: 'image_edit.preview', id: 'preview-1' }],
    })
  })
})
