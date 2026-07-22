/** @vitest-environment jsdom */

import { createRef } from 'react'
import { act, cleanup, render } from '@testing-library/react'
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
        value: { resourceId: 'asset:a', mediaType: 'image', label: '图1' },
      },
      {
        kind: 'reference',
        value: { resourceId: 'asset:b', mediaType: 'image', label: '图2' },
      },
    ]
    render(<PromptSuggestionList ref={ref} {...createSuggestionProps(items, command)} />)

    act(() => {
      ref.current?.onKeyDown(createKeyDownProps('ArrowDown'))
    })
    act(() => {
      ref.current?.onKeyDown(createKeyDownProps('Enter'))
    })

    expect(command).toHaveBeenCalledWith(items[1])
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
