/** @vitest-environment jsdom */
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createNewProject: vi.fn(),
  serviceCreateProject: vi.fn(),
  listProjects: vi.fn(),
  onCreate: null as null | ((name: string) => void),
}))

vi.mock('./cameraStageProjectService', () => ({ createNewProject: mocks.createNewProject }))
vi.mock('../application/cameraStageApplicationService', () => ({
  cameraStageApplicationService: {
    listProjects: mocks.listProjects,
    createProject: mocks.serviceCreateProject,
  },
}))
vi.mock('@/components/ProjectLibraryPage', () => ({
  ProjectLibraryPage: ({ create }: { create: { kind: string; onCreate: (name: string) => void } }) => {
    if (create.kind === 'named') mocks.onCreate = create.onCreate
    return null
  },
}))

import CameraStageProjectList from './CameraStageProjectList'

describe('CameraStageProjectList 新建项目', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    mocks.onCreate = null
  })

  it('界面新建走附着实例的入口后再进入编辑器，不用后台建档', async () => {
    mocks.listProjects.mockResolvedValue([])
    const order: string[] = []
    mocks.createNewProject.mockImplementation(async () => {
      order.push('create')
      return { id: 'project-new', name: '新项目' }
    })
    const onEnterEditor = vi.fn(() => order.push('enter'))
    render(<CameraStageProjectList onEnterEditor={onEnterEditor} />)
    await waitFor(() => expect(mocks.onCreate).toBeTruthy())

    await act(async () => { mocks.onCreate?.('  雨巷夜景  ') })

    await waitFor(() => expect(onEnterEditor).toHaveBeenCalledTimes(1))
    expect(mocks.createNewProject).toHaveBeenCalledWith('雨巷夜景')
    expect(mocks.serviceCreateProject).not.toHaveBeenCalled()
    expect(order).toEqual(['create', 'enter'])
  })
})
