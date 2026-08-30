/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'

import { useCanvasTextStreamStore } from '@/stores/canvasTextStreamStore'
import { TextAnnotationNode } from './TextAnnotationNode'

const storeMocks = vi.hoisted(() => ({
  endHistoryGroup: vi.fn(),
  setSelectedNode: vi.fn(),
  updateNodeData: vi.fn(),
  nodes: [] as Array<Record<string, unknown>>,
  edges: [] as Array<Record<string, unknown>>,
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
    nodes: storeMocks.nodes,
    edges: storeMocks.edges,
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
    storeMocks.nodes = []
    storeMocks.edges = []
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
    useCanvasTextStreamStore.getState().setPreview('text-result-1', {
      content: '# 实时标题',
      reasoning: '',
    })
    const rendered = render(<TextAnnotationNode {...createProps({ content: '', isGenerating: true })} />)

    expect(rendered.getByTestId('markdown').textContent).toBe('# 实时标题')
    expect(rendered.queryByRole('textbox')).toBeNull()
  })

  it('超长流式结果退回纯文本预览，避免持续解析 Markdown', () => {
    const longPreview = `# ${'长文本'.repeat(2_001)}`
    useCanvasTextStreamStore.getState().setPreview('text-result-1', {
      content: longPreview,
      reasoning: '',
    })
    const rendered = render(<TextAnnotationNode {...createProps({ content: '', isGenerating: true })} />)

    expect(rendered.queryByTestId('markdown')).toBeNull()
    expect(rendered.getByText(longPreview)).toBeTruthy()
  })

  it('生成期间展示思考过程，但正式内容仍保持独立', () => {
    useCanvasTextStreamStore.getState().setPreview('text-result-1', {
      content: '最终回答',
      reasoning: '先分析用户意图',
    })
    const rendered = render(<TextAnnotationNode {...createProps({ content: '', isGenerating: true })} />)

    expect(rendered.getByLabelText('node.textAnnotation.reasoning').textContent)
      .toContain('先分析用户意图')
    expect(rendered.getByTestId('markdown').textContent).toBe('最终回答')
  })

  it('生成失败后仍允许编辑已保留的部分结果', () => {
    const rendered = render(<TextAnnotationNode {...createProps({ generationError: '上游失败' })} />)

    fireEvent.click(rendered.getByTestId('markdown'))
    expect(rendered.getByRole('textbox', { name: 'text-editor' })).toBeTruthy()
  })

  it('普通字符串输入变化时同步内容与上游修订', async () => {
    storeMocks.nodes = [{
      id: 'string-source',
      type: 'stringSourceNode',
      position: { x: 0, y: 0 },
      data: { value: '来自连线的新内容' },
    }]
    storeMocks.edges = [{ id: 'edge-1', source: 'string-source', target: 'text-result-1' }]

    render(<TextAnnotationNode {...createProps({ content: '旧内容' })} />)

    await waitFor(() => expect(storeMocks.updateNodeData).toHaveBeenCalledWith(
      'text-result-1',
      { content: '来自连线的新内容', syncedInputRevision: 'string-source:来自连线的新内容' },
      { skipHistory: true },
    ))
  })

  it('旧图存在多条入边时只读取最后一条权威输入', async () => {
    storeMocks.nodes = [{
      id: 'string-source-a',
      type: 'stringSourceNode',
      position: { x: 0, y: 0 },
      data: { value: '旧输入' },
    }, {
      id: 'string-source-b',
      type: 'stringSourceNode',
      position: { x: 0, y: 0 },
      data: { value: '权威输入' },
    }]
    storeMocks.edges = [
      { id: 'edge-a', source: 'string-source-a', target: 'text-result-1' },
      { id: 'edge-b', source: 'string-source-b', target: 'text-result-1' },
    ]

    render(<TextAnnotationNode {...createProps({ content: '旧内容' })} />)

    await waitFor(() => expect(storeMocks.updateNodeData).toHaveBeenCalledWith(
      'text-result-1',
      { content: '权威输入', syncedInputRevision: 'string-source-b:权威输入' },
      { skipHistory: true },
    ))
  })

  it('上游修订未变化时保留用户手动编辑的展示内容', () => {
    storeMocks.nodes = [{
      id: 'text-source',
      type: 'textProcessingNode',
      position: { x: 0, y: 0 },
      data: { lastOutput: '机器结果', lastOutputRevision: 3 },
    }]
    storeMocks.edges = [{ id: 'edge-1', source: 'text-source', target: 'text-result-1' }]

    render(<TextAnnotationNode {...createProps({
      content: '用户编辑后的内容',
      syncedInputRevision: 'text-source:3',
    })} />)

    expect(storeMocks.updateNodeData).not.toHaveBeenCalled()
  })
})
