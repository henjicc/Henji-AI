/** @vitest-environment jsdom */

import type { Editor } from '@tiptap/core'
import type { SuggestionProps } from '@tiptap/suggestion'
import { describe, expect, it, vi } from 'vitest'

import { createSuggestionRenderer } from './createSuggestionRenderer'
import type { PromptSuggestionItem } from './PromptSuggestionList'

describe('createSuggestionRenderer', () => {
  it('候选浮层挂到 body 时高于生成工作区浮动面板', () => {
    const unmount = vi.fn()
    const mount = vi.fn<[HTMLElement], () => void>(() => unmount)
    const lifecycle = createSuggestionRenderer()()
    const props = {
      editor: { isEditorContentInitialized: false } as unknown as Editor,
      items: [],
      mount,
    } as unknown as SuggestionProps<PromptSuggestionItem, PromptSuggestionItem>

    lifecycle.onStart(props)

    const mountedElement = mount.mock.calls[0]?.[0]
    expect(mountedElement).toBeInstanceOf(HTMLElement)
    expect(mountedElement?.classList.contains('z-dropdown')).toBe(true)

    lifecycle.onExit()
    expect(unmount).toHaveBeenCalledTimes(1)
  })
})
