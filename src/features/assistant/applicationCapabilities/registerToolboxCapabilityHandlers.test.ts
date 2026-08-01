import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  hostActions: {
    commitImageEditFromAgent: vi.fn(),
    getStoryboardProjectFromAgent: vi.fn(),
    getToolboxStateFromAgent: vi.fn(),
    listStoryboardProjectsFromAgent: vi.fn(),
    listToolboxToolsFromAgent: vi.fn(),
  },
  cameraAdapter: {
    addCameraStageShot: vi.fn(),
    applyCameraStageCameraMove: vi.fn(),
    createCameraStageProject: vi.fn(),
    deleteCameraStageObject: vi.fn(),
    deleteCameraStageProject: vi.fn(),
    duplicateCameraStageObject: vi.fn(),
    getCameraStageProject: vi.fn(),
    listCameraStageProjects: vi.fn(),
    observeCameraStagePreview: vi.fn(),
    observeCameraStageScene: vi.fn(),
    openCameraStageProject: vi.fn(),
    placeCameraStageObject: vi.fn(),
    renameCameraStageProject: vi.fn(),
    updateCameraStageObject: vi.fn(),
    updateCameraStageShot: vi.fn(),
    verifyCameraStage: vi.fn(),
  },
  selectToolboxTool: vi.fn(),
  openApplicationSurface: vi.fn(),
  createImageEditPreviewFromRef: vi.fn(),
}))

vi.mock('@/features/assistant/hostActions', () => mocks.hostActions)
vi.mock('./cameraStageCapabilityAdapter', () => mocks.cameraAdapter)
vi.mock('@/stores/navigationStore', () => ({ selectToolboxTool: mocks.selectToolboxTool }))
vi.mock('./surfaceRegistry', () => ({ openApplicationSurface: mocks.openApplicationSurface }))
vi.mock('./generationCapabilities', () => ({
  createImageEditPreviewFromRef: mocks.createImageEditPreviewFromRef,
}))

import type { CapabilityHandler } from './handlerTypes'
import { registerToolboxCapabilityHandlers } from './registerToolboxCapabilityHandlers'

const context = { signal: new AbortController().signal }

function registeredHandlers(): Map<string, CapabilityHandler> {
  const handlers = new Map<string, CapabilityHandler>()
  registerToolboxCapabilityHandlers({
    registerHandler: (id, handler) => handlers.set(id, handler),
  })
  return handlers
}

describe('toolbox capability handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.openApplicationSurface.mockImplementation((surfaceId: string) => ({ surfaceId }))
  })

  it('打开 3D 工程成功后才进入已注册的 3D Surface', async () => {
    mocks.cameraAdapter.openCameraStageProject.mockResolvedValue({
      projectId: 'project-1',
      name: '镜头工程',
      objectCount: 2,
      shotCount: 1,
    })
    const handler = registeredHandlers().get('open_camera_stage_project')

    const result = await handler?.({ projectId: 'project-1' }, context)

    expect(mocks.cameraAdapter.openCameraStageProject).toHaveBeenCalledWith('project-1')
    expect(mocks.openApplicationSurface).toHaveBeenCalledWith('tool.camera_stage', context)
    expect(result).toMatchObject({ projectId: 'project-1', surfaceId: 'tool.camera_stage' })
    expect(
      mocks.cameraAdapter.openCameraStageProject.mock.invocationCallOrder[0]
    ).toBeLessThan(mocks.openApplicationSurface.mock.invocationCallOrder[0])
  })

  it('3D 工程加载失败时不提前切换界面', async () => {
    mocks.cameraAdapter.openCameraStageProject.mockRejectedValue(new Error('NOT_FOUND'))
    const handler = registeredHandlers().get('open_camera_stage_project')

    await expect(handler?.({ projectId: 'missing' }, context)).rejects.toThrow('NOT_FOUND')
    expect(mocks.openApplicationSurface).not.toHaveBeenCalled()
  })

  it('创建 3D 工程只返回稳定工程结果，不抢占当前界面', async () => {
    mocks.cameraAdapter.createCameraStageProject.mockResolvedValue({
      projectId: 'project-created',
      name: '后台工程',
      mode: 'simple',
    })
    const handler = registeredHandlers().get('create_camera_stage_project')

    const result = await handler?.({ name: '后台工程', mode: 'simple' }, context)

    expect(result).toMatchObject({ projectId: 'project-created', name: '后台工程' })
    expect(mocks.openApplicationSurface).not.toHaveBeenCalled()
  })

  it('选择工具通过统一 Surface 入口，关闭工具只清空选择', async () => {
    const handler = registeredHandlers().get('select_toolbox_tool')

    await handler?.({ toolId: 'cameraStage' }, context)
    expect(mocks.openApplicationSurface).toHaveBeenCalledWith('tool.camera_stage', context)

    const closed = await handler?.({ toolId: null }, context)
    expect(mocks.selectToolboxTool).toHaveBeenCalledWith(null)
    expect(closed).toEqual({ toolId: null, surfaceId: null })
  })
})
