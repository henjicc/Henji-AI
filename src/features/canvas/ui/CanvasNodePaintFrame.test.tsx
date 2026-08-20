/** @vitest-environment jsdom */

import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { useCanvasExecutionStateStore } from '@/stores/canvasExecutionStateStore'
import { CanvasNodePaintFrame } from './CanvasNodePaintFrame'

afterEach(() => {
  cleanup()
  useCanvasExecutionStateStore.getState().resetNodeExecutions()
})

describe('CanvasNodePaintFrame', () => {
  it('只给当前执行节点暴露忙碌态和运行光晕标记', () => {
    const rendered = render(
      <CanvasNodePaintFrame nodeId="node-1">
        <div>节点内容</div>
      </CanvasNodePaintFrame>,
    )
    const frame = rendered.container.firstElementChild
    expect(frame?.getAttribute('aria-busy')).toBeNull()

    act(() => useCanvasExecutionStateStore.getState().beginNodeExecution('node-1', {
      runId: 'run-1',
      phase: 'generating',
    }))

    expect(frame?.getAttribute('aria-busy')).toBe('true')
    expect(frame?.getAttribute('data-node-executing')).toBe('true')

    act(() => useCanvasExecutionStateStore.getState().endNodeExecution('node-1', 'stale-run'))
    expect(frame?.getAttribute('aria-busy')).toBe('true')

    act(() => useCanvasExecutionStateStore.getState().endNodeExecution('node-1', 'run-1'))
    expect(frame?.getAttribute('aria-busy')).toBeNull()
  })
})
