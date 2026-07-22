import { ReactRenderer } from '@tiptap/react'
import type {
  SuggestionKeyDownProps,
  SuggestionProps,
} from '@tiptap/suggestion'

import {
  PromptSuggestionList,
  type PromptSuggestionItem,
  type PromptSuggestionListHandle,
} from './PromptSuggestionList'

export function createSuggestionRenderer(): () => {
  onStart: (props: SuggestionProps<PromptSuggestionItem, PromptSuggestionItem>) => void
  onUpdate: (props: SuggestionProps<PromptSuggestionItem, PromptSuggestionItem>) => void
  onKeyDown: (props: SuggestionKeyDownProps) => boolean
  onExit: () => void
} {
  return () => {
    let renderer: ReactRenderer<
      PromptSuggestionListHandle,
      SuggestionProps<PromptSuggestionItem, PromptSuggestionItem>
    > | null = null
    let unmount: (() => void) | null = null

    return {
      onStart: (props): void => {
        renderer = new ReactRenderer(PromptSuggestionList, {
          editor: props.editor,
          props,
          className: 'z-[1000]',
        })
        unmount = props.mount(renderer.element)
      },
      onUpdate: (props): void => renderer?.updateProps(props),
      onKeyDown: (props): boolean => renderer?.ref?.onKeyDown(props) ?? false,
      onExit: (): void => {
        unmount?.()
        renderer?.destroy()
        unmount = null
        renderer = null
      },
    }
  }
}
