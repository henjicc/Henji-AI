// @vitest-environment jsdom

import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'


const { feedbackCleanup, attachCanvasGenerationFeedback } = vi.hoisted(() => {
  const cleanup = vi.fn()
  return {
    feedbackCleanup: cleanup,
    attachCanvasGenerationFeedback: vi.fn(() => cleanup),
  }
})

vi.mock('@/features/canvas/application/canvasDomainExecutors', () => ({
  attachCanvasGenerationFeedback,
}))
vi.mock('@/stores/projectStore', () => ({ useProjectStore: (select: (state: { currentProjectId: string }) => unknown) => select({ currentProjectId: 'project' }) }))

import { useGenerationNodeExecution } from './useGenerationNodeExecution'

describe('useGenerationNodeExecution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('页面重渲染与卸载只更新校验反馈订阅，不持有执行器', () => {
    const setPromptInvalid = vi.fn()
    const { rerender, unmount } = renderHook(({ invalidHandler }) => {
      useGenerationNodeExecution({
        nodeId: 'generation-node',
        setPromptInvalid: invalidHandler,
      })
    }, { initialProps: { invalidHandler: setPromptInvalid } })

    expect(attachCanvasGenerationFeedback).toHaveBeenCalledTimes(1)

    const nextHandler = vi.fn()
    rerender({ invalidHandler: nextHandler })

    expect(attachCanvasGenerationFeedback).toHaveBeenCalledTimes(1)
    expect(feedbackCleanup).not.toHaveBeenCalled()

    const feedback = (attachCanvasGenerationFeedback.mock.calls[0] as unknown as [string, string, (invalid: boolean) => void])[2]
    feedback(true)
    expect(nextHandler).toHaveBeenCalledWith(true)
    expect(setPromptInvalid).not.toHaveBeenCalled()
    unmount()
    expect(feedbackCleanup).toHaveBeenCalledTimes(1)
  })
})
