/** @vitest-environment jsdom */

import { createRef } from 'react'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createPlainTextPromptDocument,
  type PromptDocumentV1,
} from '@/core/inputs/promptDocument'

import { PromptEditor } from './PromptEditor'
import { PromptEditor as PublicPromptEditor } from './PromptEditorFacade'
import type { PromptEditorHandle } from './types'

afterEach(cleanup)

describe('PromptEditor', () => {
  it('静态模式不创建 contenteditable 或 Tiptap 实例', () => {
    const value = createPlainTextPromptDocument('静态提示词')
    const rendered = render(
      <PublicPromptEditor
        mode="static"
        value={value}
        onChange={vi.fn()}
        ariaLabel="静态提示词"
      />,
    )

    expect(rendered.container.querySelector('[contenteditable]')).toBeNull()
    expect(rendered.getByRole('textbox').textContent).toContain('静态提示词')
  })

  it('受控外部回写更新内容但不重复触发 onChange', () => {
    const onChange = vi.fn()
    const first = createPlainTextPromptDocument('初始')
    const second = createPlainTextPromptDocument('外部载入')
    const rendered = render(
      <PromptEditor value={first} onChange={onChange} ariaLabel="提示词" />,
    )

    rendered.rerender(
      <PromptEditor value={second} onChange={onChange} ariaLabel="提示词" />,
    )

    expect(rendered.getByRole('textbox').textContent).toBe('外部载入')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('程序化替换默认进入实例并同步结构化文档', () => {
    const onChange = vi.fn<[PromptDocumentV1], void>()
    const ref = createRef<PromptEditorHandle>()
    const first = createPlainTextPromptDocument('替换前')
    const second = createPlainTextPromptDocument('替换后')
    render(
      <PromptEditor ref={ref} value={first} onChange={onChange} ariaLabel="提示词" />,
    )

    act(() => ref.current?.replaceDocument(second))

    expect(ref.current?.getDocument()).toEqual(second)
    expect(onChange).toHaveBeenLastCalledWith(second)
  })

  it('提交快捷键避开 composition 并吞掉当前事件', () => {
    const onSubmit = vi.fn()
    const rendered = render(
      <PromptEditor
        value={createPlainTextPromptDocument('中文')}
        onChange={vi.fn()}
        ariaLabel="提示词"
        submitShortcut="mod-enter"
        onSubmit={onSubmit}
      />,
    )
    const editor = rendered.getByRole('textbox')

    fireEvent.keyDown(editor, { key: 'Enter', ctrlKey: true })
    expect(onSubmit).toHaveBeenCalledTimes(1)

    fireEvent.compositionStart(editor)
    fireEvent.keyDown(editor, { key: 'Enter', ctrlKey: true, isComposing: true })
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('两个实例的程序化替换与撤销历史互不影响', () => {
    const firstRef = createRef<PromptEditorHandle>()
    const secondRef = createRef<PromptEditorHandle>()
    const parentKeyDown = vi.fn()
    const first = createPlainTextPromptDocument('实例 A')
    const second = createPlainTextPromptDocument('实例 B')
    const firstReplacement = createPlainTextPromptDocument('实例 A 已替换')
    const secondReplacement = createPlainTextPromptDocument('实例 B 已替换')
    const rendered = render(
      <div onKeyDown={parentKeyDown}>
        <PromptEditor ref={firstRef} value={first} onChange={vi.fn()} ariaLabel="实例 A" />
        <PromptEditor ref={secondRef} value={second} onChange={vi.fn()} ariaLabel="实例 B" />
      </div>,
    )

    act(() => {
      firstRef.current?.replaceDocument(firstReplacement)
      secondRef.current?.replaceDocument(secondReplacement)
    })
    fireEvent.keyDown(rendered.getByRole('textbox', { name: '实例 A' }), {
      key: 'z',
      ctrlKey: true,
    })

    expect(firstRef.current?.getDocument()).toEqual(first)
    expect(secondRef.current?.getDocument()).toEqual(secondReplacement)
    expect(parentKeyDown).not.toHaveBeenCalled()
  })
})
