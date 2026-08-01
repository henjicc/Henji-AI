/** @vitest-environment jsdom */

import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPlainTextPromptDocument } from '@/core/inputs/promptDocument'

import { CanvasPromptEditor } from './CanvasPromptEditor'

const editorMocks = vi.hoisted(() => ({
  focus: vi.fn(),
  focusAtPoint: vi.fn(),
  selectRangeAtPoints: vi.fn(),
  getScrollTop: vi.fn(() => 0),
  setScrollTop: vi.fn(),
}))

vi.mock('@/components/ui', async () => {
  const React = await import('react')
  const PromptEditor = React.forwardRef<unknown, Record<string, unknown>>(
    function MockPromptEditor(props, ref) {
      const pointerStartRef = React.useRef<{ clientX: number; clientY: number } | null>(null)
      React.useImperativeHandle(ref, () => ({
        focus: editorMocks.focus,
        focusAtPoint: editorMocks.focusAtPoint,
        selectRangeAtPoints: editorMocks.selectRangeAtPoints,
        getScrollTop: editorMocks.getScrollTop,
        setScrollTop: editorMocks.setScrollTop,
        getDocument: () => props.value,
        replaceDocument: vi.fn(),
      }), [props.value])
      React.useEffect(() => {
        if (props.mode === 'edit') (props.onReady as (() => void) | undefined)?.()
      }, [props.mode, props.onReady])
      return React.createElement('div', {
        role: 'textbox',
        'data-mode': props.mode,
        onMouseDown: (event: { clientX: number; clientY: number }) => {
          pointerStartRef.current = { clientX: event.clientX, clientY: event.clientY }
        },
        onMouseUp: (event: { clientX: number; clientY: number }) => {
          const onActivate = props.onActivate as ((activation: unknown) => void) | undefined
          const anchor = pointerStartRef.current
          const head = { clientX: event.clientX, clientY: event.clientY }
          onActivate?.(anchor && (anchor.clientX !== head.clientX || anchor.clientY !== head.clientY)
            ? { anchor, head }
            : head)
        },
      })
    },
  )
  PromptEditor.displayName = 'MockPromptEditor'
  return { PromptEditor }
})

describe('CanvasPromptEditor', () => {
  beforeEach(() => {
    editorMocks.focus.mockReset()
    editorMocks.focusAtPoint.mockReset()
    editorMocks.selectRangeAtPoints.mockReset()
    editorMocks.getScrollTop.mockReset()
    editorMocks.getScrollTop.mockReturnValue(0)
    editorMocks.setScrollTop.mockReset()
  })
  afterEach(cleanup)

  it('静态项首次点击后仅挂载当前编辑器并恢复点击坐标', () => {
    const onSelectNode = vi.fn()
    const rendered = render(
      <CanvasPromptEditor
        selected={false}
        onSelectNode={onSelectNode}
        value={createPlainTextPromptDocument('分镜描述')}
        onChange={vi.fn()}
        ariaLabel="分镜描述"
      />,
    )

    fireEvent.mouseDown(rendered.getByRole('textbox'), { clientX: 120, clientY: 80 })
    fireEvent.mouseUp(rendered.getByRole('textbox'), { clientX: 120, clientY: 80 })

    expect(rendered.getByRole('textbox').getAttribute('data-mode')).toBe('edit')
    expect(onSelectNode).toHaveBeenCalledTimes(1)
    expect(editorMocks.focusAtPoint).toHaveBeenCalledWith({ clientX: 120, clientY: 80 })
  })

  it('静态项第一次拖动会把起止坐标恢复为编辑器选区', () => {
    const rendered = render(
      <CanvasPromptEditor
        selected={false}
        onSelectNode={vi.fn()}
        value={createPlainTextPromptDocument('分镜描述')}
        onChange={vi.fn()}
        ariaLabel="分镜描述"
      />,
    )

    fireEvent.mouseDown(rendered.getByRole('textbox'), { clientX: 60, clientY: 80 })
    fireEvent.mouseUp(rendered.getByRole('textbox'), { clientX: 150, clientY: 80 })

    expect(editorMocks.selectRangeAtPoints).toHaveBeenCalledWith(
      { clientX: 60, clientY: 80 },
      { clientX: 150, clientY: 80 },
    )
  })
})
