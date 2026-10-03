import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createStoredProject: vi.fn(),
  notifyHostScopeChanged: vi.fn(),
  configureDependencies: vi.fn(),
  setAppView: vi.fn(),
  getRecord: vi.fn(),
}))

vi.mock('@/commands/cameraStageProjects', () => ({ getCameraStageProjectRecord: mocks.getRecord }))

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
vi.mock('@/features/application-control/hostContext/hostContext', () => ({
  getHostScopeRevisions: () => ({ toolbox: 7 }),
  notifyHostScopeChanged: mocks.notifyHostScopeChanged,
}))
vi.mock('@/features/application-control/capabilities/applicationControlRegistry', () => ({
  configureCameraStageControlDependencies: mocks.configureDependencies,
  getApplicationControlExecutionEngine: vi.fn(),
}))

import { createCameraStageProject } from '@/features/cameraStage/application/cameraStageCapabilityAdapter'

describe('cameraStageCapabilityAdapter 后台创建工程', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createStoredProject.mockResolvedValue({
      id: 'project-created',
      name: '后台工程',
      defaultCameraId: 'camera-default',
      defaultStateKeyframeId: 'state-default',
    })
    mocks.getRecord.mockResolvedValue({
      id: 'project-created', name: '后台工程',
      sceneJson: JSON.stringify({
        objects: [{ id: 'camera-default', type: 'camera' }],
        stateKeyframes: [{ id: 'state-default', time: 0, cameraId: 'camera-default' }],
      }),
    })
  })

  it('只落库并返回稳定引用，不切换当前 3D 编辑会话', async () => {
    await expect(createCameraStageProject('后台工程')).resolves.toMatchObject({
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
      verification: { verified: true, target: { kind: 'camera_stage.project', id: 'project-created' } },
    })
    expect(mocks.createStoredProject).toHaveBeenCalledWith('后台工程')
    expect(mocks.setAppView).not.toHaveBeenCalled()
    expect(mocks.notifyHostScopeChanged).toHaveBeenCalledWith('toolbox')
  })

  it('持久存储回读不到工程或缺默认摄像机/0 秒关键帧时如实报告未验证（外部连接据此不判成功）', async () => {
    mocks.getRecord.mockResolvedValueOnce(null)
    await expect(createCameraStageProject('后台工程')).resolves.toMatchObject({ verification: { verified: false } })
    mocks.getRecord.mockResolvedValueOnce({
      id: 'project-created', name: '后台工程',
      sceneJson: JSON.stringify({ objects: [{ id: 'camera-default', type: 'camera' }], stateKeyframes: [] }),
    })
    await expect(createCameraStageProject('后台工程')).resolves.toMatchObject({ verification: { verified: false } })
  })
})
