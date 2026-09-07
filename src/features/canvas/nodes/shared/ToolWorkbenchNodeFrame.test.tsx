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

import { ToolWorkbenchNodeFrame, ToolWorkbenchSourcePreview } from './ToolWorkbenchNodeFrame'

afterEach(cleanup)

describe('图片工作台的输入端口生命周期', () => {
  it('内部编辑器卸载和重新挂载时，原媒体端口持续存在', () => {
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
    rerender(
      <ToolWorkbenchNodeFrame {...props} selected={false}>
        <ToolWorkbenchSourcePreview source="source.png" alt="源图" icon={null} emptyText="请选择图片" />
      </ToolWorkbenchNodeFrame>,
    )
    expect(screen.queryByTestId('editor')).toBeNull()
    expect(screen.getByRole('img', { name: '源图' })).toBeTruthy()
    expect(screen.getByTestId('target:param:__image')).toBe(input)

    rerender(
      <ToolWorkbenchNodeFrame {...props} selected>
        <div data-testid="editor" />
      </ToolWorkbenchNodeFrame>,
    )
    expect(screen.getByTestId('editor')).toBeTruthy()
    expect(screen.getByTestId('target:param:__image')).toBe(input)
  })
})
