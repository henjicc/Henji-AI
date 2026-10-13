/** @vitest-environment jsdom */
import React from 'react'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { createStateKeyframe } from '../../domain/stateKeyframeTypes'
import StaticClipBlock from './StaticClipBlock'
import TransitionClipBlock from './TransitionClipBlock'

const togglePanel = vi.hoisted(() => vi.fn())
vi.mock('@/components/ui', async () => {
  const primitives = await vi.importActual<typeof import('@/components/ui/primitives')>('@/components/ui/primitives')
  return { ...primitives, PanelTrigger: ({ children }: { children: (controls: { togglePanel: () => void }) => React.ReactNode }) => <>{children({ togglePanel })}</> }
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

it('关键帧使用正式按钮，保留拖动与结束后 click 抑制及键盘开面板', () => {
  const keyframe = createStateKeyframe([], '起点')
  const onSelect = vi.fn(), pointer = vi.fn(), suppress = vi.fn(() => true)
  const view = render(<StaticClipBlock stateKeyframe={keyframe} block={{ kind: 'static', stateKeyframeId: keyframe.id, index: 0, startTime: 0, endTime: 0, x: 30, width: 0 }}
    selected={false} isPlayhead={false} fps={30} onSelect={onSelect} onRename={vi.fn()} onRemove={vi.fn()}
    dragHandlers={{ onPointerDown: pointer, onPointerMove: vi.fn(), onPointerUp: vi.fn(), onPointerCancel: vi.fn() }} dragging={false} consumeClickSuppression={suppress}
    cameras={[]} onSelectCamera={vi.fn()} onUpdateContinuity={vi.fn()} />)
  const button = view.getByRole('button', { name: '关键帧 起点' })
  expect(button.tagName).toBe('BUTTON')
  fireEvent.pointerDown(button, { pointerId: 1, button: 0 }); expect(pointer).toHaveBeenCalledTimes(1)
  fireEvent.click(button); expect(onSelect).not.toHaveBeenCalled(); expect(togglePanel).not.toHaveBeenCalled()
  fireEvent.keyDown(button, { key: 'Enter' }); expect(onSelect).toHaveBeenCalledTimes(1); expect(togglePanel).toHaveBeenCalledTimes(1)
})

it.each([[0, null, null], [24, 'camera-a', 'camera-b'], [24, null, null]] as const)('过渡分支 %s 使用正式按钮并保留键盘/点击开面板', (width, camera, nextCamera) => {
  const keyframe = createStateKeyframe([], '起点', camera), next = createStateKeyframe([], '终点', nextCamera)
  const view = render(<TransitionClipBlock stateKeyframe={keyframe} nextStateKeyframe={next} stateKeyframeIndex={0}
    block={{ kind: 'transition', stateKeyframeId: keyframe.id, index: 0, startTime: 0, endTime: 1, x: 30, width }} objects={[]} fps={30}
    updateStateKeyframeTiming={vi.fn()} updateStateKeyframeTransition={vi.fn()} />)
  const button = view.getByRole('button', { name: /过渡参数/ })
  expect(button.tagName).toBe('BUTTON')
  fireEvent.keyDown(button, { key: ' ' }); expect(togglePanel).toHaveBeenCalledTimes(1)
  fireEvent.click(button); expect(togglePanel).toHaveBeenCalledTimes(2)
})
