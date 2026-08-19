/** @vitest-environment jsdom */

import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'

import { useCanvasTextStreamStore } from '@/stores/canvasTextStreamStore'
import { TextAnnotationNode } from './TextAnnotationNode'

const storeMocks = vi.hoisted(() => ({
  endHistoryGroup: vi.fn(),
  setSelectedNode: vi.fn(),
  updateNodeData: vi.fn(),
}))

vi.mock('@xyflow/react', () => ({
  Handle: () => null,
  Position: { Left: 'left', Right: 'right' },
}))

vi.mock('react-i18next', async (importOriginal) => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('react-markdown', () => ({
  default: ({ children }: { children: string }) => <div data-testid="markdown">{children}</div>,
}))

vi.mock('remark-gfm', () => ({ default: vi.fn() }))

vi.mock('@/components/ui', () => ({
  UiTextArea: ({ textHistory: _textHistory, ...props }: { textHistory?: unknown }) => (
    <textarea aria-label="text-editor" {...props} />
  ),
}))

vi.mock('@/stores/canvasStore', () => ({
  useCanvasStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
    edges: [],
    endHistoryGroup: storeMocks.endHistoryGroup,
    setSelectedNode: storeMocks.setSelectedNode,
    updateNodeData: storeMocks.updateNodeData,
  }),
}))

vi.mock('@/features/canvas/ui/NodeHeader', () => ({
  NODE_HEADER_FLOATING_POSITION_CLASS: '',
  NodeHeader: () => <button type="button">node-title</button>,
}))

vi.mock('@/features/canvas/ui/NodeResizeHandle', () => ({ NodeResizeHandle: () => null }))
vi.mock('@/features/canvas/nodes/shared/NodeGenerationError', () => ({
  NodeGenerationError: ({ message }: { message: string }) => <div>{message}</div>,
}))

function createProps(
  data: Record<string, unknown>,
): ComponentProps<typeof TextAnnotationNode> {
  return {
    id: 'text-result-1',
    type: 'textAnnotationNode',
    data: { content: '**正文**', ...data },
    selected: true,
  } as ComponentProps<typeof TextAnnotationNode>
}

describe('TextAnnotationNode', () => {
  beforeEach(() => {
    storeMocks.endHistoryGroup.mockReset()
    storeMocks.setSelectedNode.mockReset()
    storeMocks.updateNodeData.mockReset()
    useCanvasTextStreamStore.getState().clearAllPreviews()
  })

  afterEach(cleanup)

  it('选中或点击标题不会进入编辑，只有点击正文才激活文本框', () => {
    const rendered = render(<TextAnnotationNode {...createProps({})} />)

    expect(rendered.queryByRole('textbox')).toBeNull()
    fireEvent.click(rendered.getByText('node-title'))
    expect(rendered.queryByRole('textbox')).toBeNull()

    fireEvent.click(rendered.getByTestId('markdown'))
    expect(rendered.getByRole('textbox', { name: 'text-editor' })).toBeTruthy()
  })

  it('生成期间直接用瞬态预览做实时 Markdown 渲染', () => {
    useCanvasTextStreamStore.getState().setPreview('text-result-1', '# 实时标题')
    const rendered = render(<TextAnnotationNode {...createProps({ content: '', isGenerating: true })} />)

    expect(rendered.getByTestId('markdown').textContent).toBe('# 实时标题')
    expect(rendered.queryByRole('textbox')).toBeNull()
  })

  it('超长流式结果退回纯文本预览，避免持续解析 Markdown', () => {
    const longPreview = `# ${'长文本'.repeat(2_001)}`
    useCanvasTextStreamStore.getState().setPreview('text-result-1', longPreview)
    const rendered = render(<TextAnnotationNode {...createProps({ content: '', isGenerating: true })} />)

    expect(rendered.queryByTestId('markdown')).toBeNull()
    expect(rendered.getByText(longPreview)).toBeTruthy()
  })
})
