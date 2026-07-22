/** @vitest-environment jsdom */

import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPlainTextPromptDocument } from '@/core/inputs/promptDocument'

import { CanvasPromptEditor } from './CanvasPromptEditor'

const editorMocks = vi.hoisted(() => ({
  focus: vi.fn(),
  focusAtPoint: vi.fn(),
}))

vi.mock('@/components/ui', async () => {
  const React = await import('react')
  const PromptEditor = React.forwardRef<unknown, Record<string, unknown>>(
    function MockPromptEditor(props, ref) {
      React.useImperativeHandle(ref, () => ({
        focus: editorMocks.focus,
        focusAtPoint: editorMocks.focusAtPoint,
        getDocument: () => props.value,
        replaceDocument: vi.fn(),
      }), [props.value])
      React.useEffect(() => {
        if (props.mode === 'edit') (props.onReady as (() => void) | undefined)?.()
      }, [props.mode, props.onReady])
      return React.createElement('div', {
        role: 'textbox',
        'data-mode': props.mode,
        onClick: (event: { clientX: number; clientY: number }) => {
          const onActivate = props.onActivate as ((point: {
            clientX: number
            clientY: number
          }) => void) | undefined
          onActivate?.({ clientX: event.clientX, clientY: event.clientY })
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

    fireEvent.click(rendered.getByRole('textbox'), { clientX: 120, clientY: 80 })

    expect(rendered.getByRole('textbox').getAttribute('data-mode')).toBe('edit')
    expect(onSelectNode).toHaveBeenCalledTimes(1)
    expect(editorMocks.focusAtPoint).toHaveBeenCalledWith({ clientX: 120, clientY: 80 })
  })
})
