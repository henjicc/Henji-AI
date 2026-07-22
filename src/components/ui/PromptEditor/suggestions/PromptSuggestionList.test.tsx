/** @vitest-environment jsdom */

import { createRef } from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import type { EditorView } from '@tiptap/pm/view'
import type { SuggestionKeyDownProps, SuggestionProps } from '@tiptap/suggestion'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  PromptSuggestionList,
  type PromptSuggestionItem,
  type PromptSuggestionListHandle,
} from './PromptSuggestionList'

afterEach(cleanup)

function createKeyDownProps(key: string): SuggestionKeyDownProps {
  return {
    view: {} as EditorView,
    event: new KeyboardEvent('keydown', { key, cancelable: true }),
    range: { from: 0, to: 0 },
  }
}

function createSuggestionProps(
  items: PromptSuggestionItem[],
  command: (item: PromptSuggestionItem) => void,
): SuggestionProps<PromptSuggestionItem, PromptSuggestionItem> {
  return { items, command } as unknown as SuggestionProps<
    PromptSuggestionItem,
    PromptSuggestionItem
  >
}

describe('PromptSuggestionList', () => {
  it('方向键切换后 Enter 选择当前候选', () => {
    const command = vi.fn<[PromptSuggestionItem], void>()
    const ref = createRef<PromptSuggestionListHandle>()
    const items: PromptSuggestionItem[] = [
      {
        kind: 'reference',
        value: { resourceId: 'asset:a', mediaType: 'image', label: '图片1' },
      },
      {
        kind: 'reference',
        value: { resourceId: 'asset:b', mediaType: 'image', label: '图片2' },
      },
    ]
    const rendered = render(
      <PromptSuggestionList ref={ref} {...createSuggestionProps(items, command)} />,
    )

    expect(rendered.getByRole('listbox').className).toContain('w-max')
    expect(rendered.getByRole('listbox').getAttribute('data-prompt-suggestion-portal')).toBe('true')
    expect(rendered.getAllByRole('option')[1].className).toContain('!bg-transparent')

    act(() => {
      ref.current?.onKeyDown(createKeyDownProps('ArrowDown'))
    })
    act(() => {
      ref.current?.onKeyDown(createKeyDownProps('Enter'))
    })

    expect(command).toHaveBeenCalledWith(items[1])
  })

  it('媒体候选只显示单行标签，不暴露资源 ID', () => {
    const resourceId = 'generation-upload:very-long-resource-id'
    const items: PromptSuggestionItem[] = [{
      kind: 'reference',
      value: { resourceId, mediaType: 'image', label: '图片1' },
    }]

    render(<PromptSuggestionList {...createSuggestionProps(items, vi.fn())} />)

    expect(screen.getByText('图片1')).toBeTruthy()
    expect(screen.queryByText(resourceId)).toBeNull()
  })

  it('变量候选保留分组和描述信息', () => {
    const items: PromptSuggestionItem[] = [{
      kind: 'variable',
      value: {
        key: 'target.model.name',
        label: '目标模型名称',
        group: '当前模型',
        description: '当前生成模型显示名称',
      },
    }]

    render(<PromptSuggestionList {...createSuggestionProps(items, vi.fn())} />)

    expect(screen.getByText('当前模型')).toBeTruthy()
    expect(screen.getByText('当前生成模型显示名称')).toBeTruthy()
  })

  it('空候选吞掉导航键且不执行 command', () => {
    const command = vi.fn<[PromptSuggestionItem], void>()
    const ref = createRef<PromptSuggestionListHandle>()
    render(<PromptSuggestionList ref={ref} {...createSuggestionProps([], command)} />)

    expect(ref.current?.onKeyDown(createKeyDownProps('Enter'))).toBe(true)
    expect(ref.current?.onKeyDown(createKeyDownProps('Escape'))).toBe(true)
    expect(command).not.toHaveBeenCalled()
  })
})
