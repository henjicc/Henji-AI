/** @vitest-environment jsdom */
import React from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { createDefaultAnimation } from './domain/animationTypes'
import { createDefaultCameraStageSceneSnapshot } from './domain/defaultSceneSnapshot'
import { useCameraStageSessionStore } from './store/cameraStageSessionStore'
import { useCameraStageStore } from './store/cameraStageStore'

const projectMocks = vi.hoisted(() => ({ loadProjectIntoScene: vi.fn() }))

vi.mock('@/core/applicationLifecycle/rendererRecovery', () => ({ isSafeRendererRecovery: () => true }))
vi.mock('./projects/cameraStageProjectService', () => ({
  loadProjectIntoScene: projectMocks.loadProjectIntoScene,
  CameraStageLeaveCancelledError: class extends Error {},
  createDraftCameraStageDocument: vi.fn(),
  leaveCameraStageEditor: vi.fn(),
  openCameraStageDocument: vi.fn(),
}))
vi.mock('./scene/directorViewState', () => ({ persistDirectorView: vi.fn() }))
vi.mock('./CameraStageErrorBoundary', () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }))
vi.mock('@/features/documents/DocumentLibraryPage', () => ({ DocumentLibraryPage: () => <div data-testid="project-list" /> }))
vi.mock('@/contexts/NotificationContext', () => ({ useNotification: () => ({ showNotification: vi.fn() }) }))
vi.mock('./CameraStageEditor', () => ({ default: () => <div data-testid="camera-stage-editor" /> }))

import CameraStageApp from './CameraStageApp'

afterEach(() => cleanup())

it('崩溃后的安全恢复里第一次进入不自动打开上次的舞台文档，之后手动打开照常', async () => {
  localStorage.clear()
  useCameraStageSessionStore.setState({ appView: 'editor', lastDocumentId: 'project-a', stageViewMode: 'director' })
  render(<CameraStageApp />)
  await screen.findByTestId('project-list')
  expect(projectMocks.loadProjectIntoScene).not.toHaveBeenCalled()
  expect(useCameraStageSessionStore.getState().lastDocumentId).toBe('project-a')

  const snapshot = createDefaultCameraStageSceneSnapshot()
  act(() => {
    useCameraStageStore.getState().loadSnapshot({ objects: snapshot.objects, activeCameraId: snapshot.activeCameraId, animation: createDefaultAnimation(),
      sceneSettings: snapshot.sceneSettings, stateKeyframes: snapshot.stateKeyframes }, { id: 'project-a', name: 'project-a' })
    useCameraStageSessionStore.setState({ appView: 'editor', lastDocumentId: 'project-a' })
  })
  await screen.findByTestId('camera-stage-editor')
})
