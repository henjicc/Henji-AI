// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { openAssistantGenerationResult } from './openAssistantResult'
import { registerGenerationTaskReveal } from '@/workspaces/GenerationWorkspace/application/generationTaskNavigation'
import { getVisibleGenerationTask } from '@/workspaces/GenerationWorkspace/application/visibleGenerationTaskCommand'
import { switchWorkspace } from '@/stores/navigationStore'

vi.mock('@/core/logging', () => ({ createLogger: () => ({ warn: vi.fn(), info: vi.fn() }) }))
vi.mock('@/features/canvas/application/canvasApplicationService', () => ({ focusCanvasNode: vi.fn(), openCanvasProject: vi.fn() }))
vi.mock('@/stores/navigationStore', () => ({ switchWorkspace: vi.fn() }))
vi.mock('@/workspaces/GenerationWorkspace/application/visibleGenerationTaskCommand', () => ({ getVisibleGenerationTask: vi.fn() }))

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks() })

it('先请求列表挂载离屏目标，再沿原入口定位与聚焦', async () => {
  vi.mocked(getVisibleGenerationTask).mockReturnValue({ taskId: 'offscreen', status: 'success', progress: 1,
    modelId: 'fixture', mediaType: 'image', resultAvailable: true, errorCode: null, errorMessage: null })
  vi.stubGlobal('CSS', { escape: (value: string) => value })
  const target = document.createElement('div')
  target.dataset.generationTaskId = 'offscreen'
  target.tabIndex = -1
  target.scrollIntoView = vi.fn()
  const reveal = vi.fn(() => document.body.append(target))
  const unregister = registerGenerationTaskReveal(reveal)
  try {
    expect(await openAssistantGenerationResult('offscreen')).toBe(true)
    expect(switchWorkspace).toHaveBeenCalledWith('generation')
    expect(reveal).toHaveBeenCalledWith('offscreen')
    expect(target.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' })
    expect(document.activeElement).toBe(target)
  } finally { unregister() }
})

it('不存在的任务不滚动到其他记录，也不切换工作区', async () => {
  vi.mocked(getVisibleGenerationTask).mockReturnValue(null)
  expect(await openAssistantGenerationResult('missing')).toBe(false)
  expect(switchWorkspace).not.toHaveBeenCalled()
})
