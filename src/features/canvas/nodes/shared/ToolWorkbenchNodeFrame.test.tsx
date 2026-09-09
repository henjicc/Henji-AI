// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import type { Handle } from '@xyflow/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@xyflow/react', async (importOriginal) => ({
  ...await importOriginal<typeof import('@xyflow/react')>(),
  Handle: ({ id, type }: ComponentProps<typeof Handle>) => <div data-testid={`${type}:${id}`} />,
  NodeResizeControl: () => null,
  useUpdateNodeInternals: () => vi.fn(),
}))
vi.mock('@/features/canvas/ui/NodeHeader', () => ({
  NodeHeader: () => null,
  NODE_HEADER_FLOATING_POSITION_CLASS: '',
}))

import { ToolWorkbenchNodeFrame } from './ToolWorkbenchNodeFrame'

afterEach(cleanup)

describe('图片工作台的输入端口生命周期', () => {
  it('ReactFlow 尚未测量的零尺寸使用默认布局，不固化为最小尺寸', () => {
    const props = { nodeId: 'initial-size', title: '图片工具', icon: null,
      hasSourceConnections: false, onSelect: vi.fn(), onTitleChange: vi.fn(),
      defaultWidth: 720, defaultHeight: 420, minWidth: 600, minHeight: 300 }
    const view = render(<ToolWorkbenchNodeFrame {...props} width={0} height={0}><div /></ToolWorkbenchNodeFrame>)
    const root = view.container.querySelector<HTMLElement>('[data-tool-workbench-node-id]')!
    expect(root.style.width).toBe('720px')
    expect(root.style.height).toBe('420px')
    view.rerender(<ToolWorkbenchNodeFrame {...props} width={900} height={600}><div /></ToolWorkbenchNodeFrame>)
    expect(root.style.width).toBe('900px')
    expect(root.style.height).toBe('600px')
  })
  it('选中切换时工作面与原媒体端口都保持同一个实例', () => {
    const props = {
      nodeId: 'workbench', title: '图片工具', icon: null,
      hasSourceConnections: false, onSelect: vi.fn(), onTitleChange: vi.fn(),
    }
    const { rerender } = render(
      <ToolWorkbenchNodeFrame {...props} selected>
        <div data-testid="editor" />
      </ToolWorkbenchNodeFrame>,
    )
    const input = screen.getByTestId('target:param:__image')
    const editor = screen.getByTestId('editor')
    rerender(
      <ToolWorkbenchNodeFrame {...props} selected={false}>
        <div data-testid="editor" />
      </ToolWorkbenchNodeFrame>,
    )
    expect(screen.getByTestId('editor')).toBe(editor)
    expect(screen.getByTestId('target:param:__image')).toBe(input)

    rerender(
      <ToolWorkbenchNodeFrame {...props} selected>
        <div data-testid="editor" />
      </ToolWorkbenchNodeFrame>,
    )
    expect(screen.getByTestId('editor')).toBe(editor)
    expect(screen.getByTestId('target:param:__image')).toBe(input)
  })
})
