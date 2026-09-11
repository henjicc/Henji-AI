import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createStoredProject: vi.fn(),
  notifyHostScopeChanged: vi.fn(),
  configureDependencies: vi.fn(),
  setAppView: vi.fn(),
}))

vi.mock('@/features/cameraStage/application/cameraStageApplicationService', () => ({
  cameraStageApplicationService: {},
}))
vi.mock('@/features/cameraStage/application/cameraStageVerification', () => ({
  verifyCameraStageScene: vi.fn(),
}))
vi.mock('@/features/cameraStage/projects/cameraStageProjectService', () => ({
  createStoredCameraStageProject: mocks.createStoredProject,
}))
vi.mock('@/features/cameraStage/store/cameraStageSessionStore', () => ({
  useCameraStageSessionStore: { getState: () => ({ setAppView: mocks.setAppView }) },
}))
vi.mock('../hostContext/hostContext', () => ({
  getHostScopeRevisions: () => ({ toolbox: 7 }),
  notifyHostScopeChanged: mocks.notifyHostScopeChanged,
}))
vi.mock('./applicationControlRegistry', () => ({
  configureCameraStageControlDependencies: mocks.configureDependencies,
  getApplicationControlExecutionEngine: vi.fn(),
}))

import { createCameraStageProject } from './cameraStageCapabilityAdapter'

describe('cameraStageCapabilityAdapter 后台创建工程', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createStoredProject.mockResolvedValue({
      id: 'project-created',
      name: '后台工程',
      defaultCameraId: 'camera-default',
      defaultStateKeyframeId: 'state-default',
    })
  })

  it('只落库并返回稳定引用，不切换当前 3D 编辑会话', async () => {
    const context = { operationId: 'create-operation', signal: new AbortController().signal }
    await expect(createCameraStageProject('后台工程', context)).resolves.toMatchObject({
      projectId: 'project-created',
      name: '后台工程',
      defaultCameraId: 'camera-default',
      defaultStateKeyframeId: 'state-default',
      resultRefs: [
        { kind: 'camera_stage.project', id: 'project-created' },
        { kind: 'camera_stage.camera', id: 'project-created:camera-default' },
        { kind: 'camera_stage.state_keyframe', id: 'project-created:state-default' },
      ],
      baseRevision: 7,
    })
    expect(mocks.createStoredProject).toHaveBeenCalledWith('后台工程', context)
    expect(mocks.setAppView).not.toHaveBeenCalled()
    expect(mocks.notifyHostScopeChanged).toHaveBeenCalledWith('toolbox')
  })
})
