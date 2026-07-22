/** @vitest-environment jsdom */

import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPlainTextPromptDocument } from '@/core/inputs/promptDocument'

import { GenerationPromptEditor } from './GenerationPromptEditor'

const promptEditorMocks = vi.hoisted(() => ({
  focus: vi.fn(),
  focusAtPoint: vi.fn(),
}))

vi.mock('@xyflow/react', () => ({
  Handle: () => null,
  Position: { Left: 'left' },
}))

vi.mock('./useCanvasContentLod', () => ({
  useCanvasContentLod: () => false,
}))

vi.mock('@/components/ui', async () => {
  const React = await import('react')
  const PromptEditor = React.forwardRef<unknown, Record<string, unknown>>(
    function MockPromptEditor(props, ref) {
      React.useImperativeHandle(ref, () => ({
        focus: promptEditorMocks.focus,
        focusAtPoint: promptEditorMocks.focusAtPoint,
        getDocument: () => props.value,
        replaceDocument: vi.fn(),
      }), [props.value])

      React.useEffect(() => {
        if (props.mode !== 'edit') return
        const onReady = props.onReady as (() => void) | undefined
        onReady?.()
      }, [props.mode, props.onReady])

      return React.createElement('div', {
        role: 'textbox',
        'aria-label': props.ariaLabel,
        'data-mode': props.mode,
        'data-auto-focus': String(props.autoFocus ?? false),
        onClick: (event: { clientX: number; clientY: number }) => {
          const onActivate = props.onActivate as ((point: {
            clientX: number
            clientY: number
          }) => void) | undefined
          onActivate?.({ clientX: event.clientX, clientY: event.clientY })
        },
        onKeyDown: (event: { key: string; preventDefault: () => void }) => {
          if (event.key !== 'Enter' && event.key !== ' ') return
          event.preventDefault()
          const onActivate = props.onActivate as (() => void) | undefined
          onActivate?.()
        },
      })
    },
  )
  PromptEditor.displayName = 'MockPromptEditor'
  return { PromptEditor }
})

describe('GenerationPromptEditor', () => {
  beforeEach(() => {
    promptEditorMocks.focus.mockReset()
    promptEditorMocks.focusAtPoint.mockReset()
  })

  afterEach(() => {
    cleanup()
  })

  it('未选中节点的第一次点击会在编辑器稳定挂载后恢复点击位置', () => {
    const onSelectNode = vi.fn()
    const rendered = render(
      <GenerationPromptEditor
        nodeId="node-1"
        selected={false}
        value={createPlainTextPromptDocument('点击段落中间')}
        references={[]}
        readOnly={false}
        invalid={false}
        placeholder="提示词"
        onChange={vi.fn()}
        onSubmit={vi.fn()}
        onEditEnd={vi.fn()}
        onSelectNode={onSelectNode}
      />,
    )

    fireEvent.click(rendered.getByRole('textbox'), { clientX: 180, clientY: 96 })

    expect(onSelectNode).toHaveBeenCalledWith('node-1')
    expect(rendered.getByRole('textbox').getAttribute('data-mode')).toBe('edit')
    expect(rendered.getByRole('textbox').getAttribute('data-auto-focus')).toBe('false')

    expect(promptEditorMocks.focusAtPoint).toHaveBeenCalledWith({
      clientX: 180,
      clientY: 96,
    })
    expect(promptEditorMocks.focus).not.toHaveBeenCalled()
  })

  it('键盘激活在编辑器就绪后显式聚焦且不开启 Tiptap autoFocus', () => {
    const rendered = render(
      <GenerationPromptEditor
        nodeId="node-1"
        selected
        value={createPlainTextPromptDocument('键盘激活')}
        references={[]}
        readOnly={false}
        invalid={false}
        placeholder="提示词"
        onChange={vi.fn()}
        onSubmit={vi.fn()}
        onEditEnd={vi.fn()}
        onSelectNode={vi.fn()}
      />,
    )

    fireEvent.keyDown(rendered.getByRole('textbox'), { key: 'Enter' })

    expect(rendered.getByRole('textbox').getAttribute('data-auto-focus')).toBe('false')
    expect(promptEditorMocks.focus).toHaveBeenCalledTimes(1)
    expect(promptEditorMocks.focusAtPoint).not.toHaveBeenCalled()
  })
})
