/** @vitest-environment jsdom */
import React from 'react'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createDefaultAnimation } from './domain/animationTypes'
import { createDefaultCameraStageSceneSnapshot } from './domain/defaultSceneSnapshot'
import { resetCameraStagePlaybackRuntimeForTest } from './scene/playbackRuntime'
import { useCameraStageSessionStore } from './store/cameraStageSessionStore'
import { useCameraStageStore } from './store/cameraStageStore'

const projectMocks = vi.hoisted(() => ({ loadProjectIntoScene: vi.fn() }))

vi.mock('./projects/cameraStageProjectService', () => ({
  loadProjectIntoScene: projectMocks.loadProjectIntoScene,
}))
vi.mock('./scene/directorViewState', () => ({ persistDirectorView: vi.fn() }))
vi.mock('./CameraStageErrorBoundary', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))
vi.mock('./projects/CameraStageProjectList', () => ({
  default: () => <div data-testid="project-list" />,
}))
vi.mock('./CameraStageEditor', async () => {
  const ReactModule = await import('react')
  const { useCameraStageSessionStore: useSession } = await import('./store/cameraStageSessionStore')
  const { useCameraStageStore: useStage } = await import('./store/cameraStageStore')
  const Editor = () => {
    const viewMode = useStage((state) => state.viewMode)
    const setSessionViewMode = useSession((state) => state.setStageViewMode)
    ReactModule.useEffect(() => setSessionViewMode(viewMode), [setSessionViewMode, viewMode])
    return <div data-testid="camera-stage-editor" />
  }
  return { default: Editor }
})

import CameraStageApp from './CameraStageApp'

function loadProject(projectId: string): void {
  const snapshot = createDefaultCameraStageSceneSnapshot()
  useCameraStageStore.getState().loadSnapshot({
    objects: snapshot.objects,
    activeCameraId: snapshot.activeCameraId,
    animation: createDefaultAnimation(),
    sceneSettings: snapshot.sceneSettings,
    stateKeyframes: snapshot.stateKeyframes,
  }, { id: projectId, name: projectId })
}

function startInCameraProject(projectId: string): void {
  loadProject(projectId)
  useCameraStageStore.getState().setViewMode('camera')
  useCameraStageSessionStore.setState({
    appView: 'editor',
    lastProjectId: projectId,
    stageViewMode: 'camera',
    coverRevision: 0,
  })
}

describe('CameraStageApp 会话恢复', () => {
  beforeEach(() => {
    localStorage.clear()
    resetCameraStagePlaybackRuntimeForTest()
    projectMocks.loadProjectIntoScene.mockReset()
    startInCameraProject('project-a')
  })

  afterEach(() => cleanup())

  it('隐藏挂载期间外部切换工程只恢复一次视角，随后用户选择不会被弹回', async () => {
    render(<CameraStageApp />)
    await screen.findByTestId('camera-stage-editor')

    act(() => {
      loadProject('project-b')
      useCameraStageSessionStore.getState().setLastProjectId('project-b')
    })
    await waitFor(() => {
      expect(useCameraStageStore.getState()).toMatchObject({
        currentProjectId: 'project-b',
        viewMode: 'camera',
      })
      expect(useCameraStageSessionStore.getState().stageViewMode).toBe('camera')
    })
    expect(projectMocks.loadProjectIntoScene).not.toHaveBeenCalled()

    act(() => useCameraStageStore.getState().setViewMode('director'))
    await waitFor(() => expect(useCameraStageSessionStore.getState().stageViewMode).toBe('director'))
    await act(async () => { await Promise.resolve() })
    expect(useCameraStageStore.getState().viewMode).toBe('director')
  })

  it.each([
    { label: '成功', staleNotFound: false },
    { label: 'NOT_FOUND', staleNotFound: true },
  ])('连续切换工程时串行撤回旧恢复，迟到工程$label不能覆盖最新身份', async ({ staleNotFound }) => {
    const resolvers = new Map<string, () => void>()
    projectMocks.loadProjectIntoScene.mockImplementation((
      projectId: string,
      options: { updateSession?: boolean } = {},
    ) => new Promise((resolve) => {
      resolvers.set(projectId, () => {
        if (projectId === 'project-b' && staleNotFound) {
          resolve(false)
          return
        }
        loadProject(projectId)
        if (options.updateSession !== false) {
          useCameraStageSessionStore.getState().setLastProjectId(projectId)
        }
        resolve(true)
      })
    }))
    render(<CameraStageApp />)
    await screen.findByTestId('camera-stage-editor')

    act(() => useCameraStageSessionStore.getState().setLastProjectId('project-b'))
    await waitFor(() => expect(projectMocks.loadProjectIntoScene)
      .toHaveBeenCalledWith('project-b', { updateSession: false }))
    act(() => useCameraStageSessionStore.getState().setLastProjectId('project-c'))
    expect(projectMocks.loadProjectIntoScene).toHaveBeenCalledTimes(1)

    await act(async () => resolvers.get('project-b')?.())
    await waitFor(() => expect(projectMocks.loadProjectIntoScene)
      .toHaveBeenCalledWith('project-c', { updateSession: false }))
    await act(async () => resolvers.get('project-c')?.())

    await waitFor(() => expect(useCameraStageStore.getState()).toMatchObject({
      currentProjectId: 'project-c',
      viewMode: 'camera',
    }))
    expect(useCameraStageSessionStore.getState().lastProjectId).toBe('project-c')
  })
})
