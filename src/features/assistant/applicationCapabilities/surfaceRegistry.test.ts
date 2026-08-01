// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  focusCanvasNodeFromAgent: vi.fn(),
  openCanvasProjectFromAgent: vi.fn(),
  selectAssetFromAgent: vi.fn(),
  openCameraStageProject: vi.fn(),
}))

vi.mock('@/features/canvas/application/canvasApplicationService', () => ({
  focusCanvasNode: mocks.focusCanvasNodeFromAgent,
  openCanvasProject: mocks.openCanvasProjectFromAgent,
}))
vi.mock('../hostActions', () => ({ selectAssetFromAgent: mocks.selectAssetFromAgent }))
vi.mock('@/features/cameraStage/application/cameraStageApplicationService', () => ({
  cameraStageApplicationService: { openProject: mocks.openCameraStageProject },
}))

import { useNavigationStore } from '@/stores/navigationStore'

import { focusApplicationEntity, openApplicationSurface } from './surfaceRegistry'

describe('application surface registry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useNavigationStore.setState({
      activeWorkspace: 'generation',
      activeToolId: null,
      revision: 0,
    })
  })

  it('打开 3D Surface 时同步进入工具箱并选择 3D 编辑器', () => {
    const result = openApplicationSurface('tool.camera_stage')

    expect(result).toEqual({ surfaceId: 'tool.camera_stage' })
    expect(useNavigationStore.getState()).toMatchObject({
      activeWorkspace: 'tools',
      activeToolId: 'cameraStage',
    })
  })

  it('定位三维子实体时先按稳定引用载入工程，再打开 3D Surface', async () => {
    mocks.openCameraStageProject.mockResolvedValue({ projectId: 'project-3' })

    const result = await focusApplicationEntity(
      { kind: 'camera_stage.object', id: 'project-3:object-1' },
      new AbortController().signal
    )

    expect(mocks.openCameraStageProject).toHaveBeenCalledWith('project-3')
    expect(result).toMatchObject({ surfaceId: 'tool.camera_stage' })
    expect(useNavigationStore.getState()).toMatchObject({ activeWorkspace: 'tools', activeToolId: 'cameraStage' })
  })

  it('拒绝缺少工程前缀的三维子实体引用', async () => {
    await expect(focusApplicationEntity(
      { kind: 'camera_stage.camera', id: 'camera-only' },
      new AbortController().signal
    )).rejects.toThrow('INVALID_INPUT')
    expect(mocks.openCameraStageProject).not.toHaveBeenCalled()
  })

  it('定位画布项目时先载入项目，再打开并验证画布 Surface', async () => {
    mocks.openCanvasProjectFromAgent.mockResolvedValue({ projectId: 'project-1' })

    const result = await focusApplicationEntity(
      { kind: 'canvas.project', id: 'project-1' },
      new AbortController().signal
    )

    expect(mocks.openCanvasProjectFromAgent).toHaveBeenCalledWith(
      'project-1',
      expect.any(AbortSignal)
    )
    expect(result).toMatchObject({ surfaceId: 'workspace.canvas' })
    expect(useNavigationStore.getState().activeWorkspace).toBe('nodes')
  })

  it('定位画布节点时自动打开目标项目和工作区后再聚焦节点', async () => {
    mocks.openCanvasProjectFromAgent.mockResolvedValue({ projectId: 'project-2' })
    mocks.focusCanvasNodeFromAgent.mockResolvedValue({
      projectId: 'project-2',
      nodeId: 'node-1',
      focused: true,
    })

    const result = await focusApplicationEntity(
      { kind: 'canvas.node', id: 'project-2:node-1' },
      new AbortController().signal
    )

    expect(mocks.openCanvasProjectFromAgent).toHaveBeenCalledWith(
      'project-2',
      expect.any(AbortSignal)
    )
    expect(mocks.focusCanvasNodeFromAgent).toHaveBeenCalledWith(
      'project-2',
      'node-1',
      expect.any(AbortSignal)
    )
    expect(result).toMatchObject({ surfaceId: 'workspace.canvas' })
  })
})
