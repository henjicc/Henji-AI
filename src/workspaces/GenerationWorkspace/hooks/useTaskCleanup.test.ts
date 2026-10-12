// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { useState } from 'react'
import { expect, it, vi } from 'vitest'
import type { GenerationTask } from '../types'
import { useTaskCleanup } from './useTaskCleanup'

const mocks = vi.hoisted(() => ({ remove: vi.fn(), check: vi.fn(async () => [false]), deleteEditState: vi.fn() }))
vi.mock('@/platform/desktopApi', () => ({ remove: mocks.remove }))
vi.mock('@/commands/assetLibrary', () => ({ checkAssetPaths: mocks.check }))
vi.mock('@/utils/editStatePersistence', () => ({ deleteEditState: mocks.deleteEditState }))

it('单删、清失败、清空均只删目标记录，未知文档引用时保留结果、源文件和编辑状态', async () => {
  const shared = '/media/shared.png'
  const task: GenerationTask = {
    id: 'first', createdAt: new Date(), type: 'image', model: 'test', prompt: '', status: 'error',
    result: { id: 'result', prompt: '', createdAt: new Date(), type: 'image', filePaths: [shared], urls: [] },
    uploadedFilePaths: [shared], uploadedVideoFilePaths: ['/media/video.mp4'], uploadedAudioFilePaths: ['/media/audio.wav'],
    options: { editStateFile: '/media/edit.json' },
  }
  for (const action of ['deleteTask', 'clearFailedTasks', 'clearAllTasks'] as const) {
    const progress = vi.fn()
    const { result, unmount } = renderHook(() => {
      const [tasks, setTasks] = useState([task, { ...task, id: 'other', status: 'success' as const }])
      return { tasks, cleanup: useTaskCleanup({ tasks, setTasks, clearTaskProgress: progress }) }
    })
    await act(async () => {
      if (action === 'deleteTask') await result.current.cleanup.deleteTask('first')
      else await result.current.cleanup[action]()
    })
    expect(result.current.tasks.map(value => value.id)).toEqual(action === 'clearAllTasks' ? [] : ['other'])
    expect(progress).toHaveBeenCalledWith('first')
    expect(mocks.remove).not.toHaveBeenCalled()
    expect(mocks.deleteEditState).not.toHaveBeenCalled()
    unmount()
  }
})
