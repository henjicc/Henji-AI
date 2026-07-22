import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useState,
} from 'react'
import type { SuggestionKeyDownProps, SuggestionProps } from '@tiptap/suggestion'

import { UiOptionButton } from '@/components/ui/primitives'
import type { PromptReferenceItem, PromptVariableItem } from '../types'

export type PromptSuggestionItem =
  | { kind: 'reference'; value: PromptReferenceItem }
  | { kind: 'variable'; value: PromptVariableItem }

export interface PromptSuggestionListHandle {
  onKeyDown: (props: SuggestionKeyDownProps) => boolean
}

type PromptSuggestionListProps = SuggestionProps<PromptSuggestionItem, PromptSuggestionItem>

function getSuggestionKey(item: PromptSuggestionItem): string {
  return item.kind === 'reference' ? item.value.resourceId : item.value.key
}

function getSuggestionLabel(item: PromptSuggestionItem): string {
  return item.value.label
}

export const PromptSuggestionList = forwardRef<
  PromptSuggestionListHandle,
  PromptSuggestionListProps
>(function PromptSuggestionList({ items, command }, ref) {
  const [selectedIndex, setSelectedIndex] = useState(0)

  useEffect(() => setSelectedIndex(0), [items])

  const selectItem = useCallback((index: number): void => {
    const item = items[index]
    if (item) command(item)
  }, [command, items])

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }): boolean => {
      if (event.key === 'Escape') return true
      if (items.length === 0 && ['ArrowUp', 'ArrowDown', 'Enter'].includes(event.key)) {
        event.preventDefault()
        return true
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setSelectedIndex((current) => (current + items.length - 1) % items.length)
        return true
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setSelectedIndex((current) => (current + 1) % items.length)
        return true
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        selectItem(selectedIndex)
        return true
      }
      return false
    },
  }), [items, selectItem, selectedIndex])

  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-border-dark bg-panel px-3 py-2 text-xs text-text-muted shadow-2xl">
        没有匹配项
      </div>
    )
  }

  return (
    <div
      className="inline-flex w-max max-w-[calc(100vw-32px)] flex-col gap-1 rounded-lg border border-border-dark bg-panel p-1.5 shadow-2xl"
      role="listbox"
      aria-label={items[0]?.kind === 'reference' ? '媒体引用候选' : '模板变量候选'}
    >
      {items.map((item, index) => {
        const reference = item.kind === 'reference' ? item.value : null
        return (
          <UiOptionButton
            key={`${item.kind}:${getSuggestionKey(item)}`}
            active={index === selectedIndex}
            className={`w-full min-w-0 gap-2 ${index === selectedIndex ? '' : '!border-transparent !bg-transparent hover:!border-transparent hover:!bg-layer'}`}
            role="option"
            aria-selected={index === selectedIndex}
            onMouseDown={(event) => event.preventDefault()}
            onMouseEnter={() => setSelectedIndex(index)}
            onClick={() => selectItem(index)}
          >
            {reference?.thumbnailSrc ? (
              <img
                src={reference.thumbnailSrc}
                alt=""
                className="h-8 w-8 shrink-0 rounded object-cover"
                draggable={false}
              />
            ) : (
              <span className="flex h-8 min-w-8 items-center justify-center rounded bg-layer px-1 text-[10px] text-text-muted">
                {reference?.mediaType ?? '{{ }}'}
              </span>
            )}
            {reference ? (
              <span className="min-w-0 flex-1 truncate text-sm text-text-dark">
                {getSuggestionLabel(item)}
              </span>
            ) : (
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-xs text-text-dark">{getSuggestionLabel(item)}</span>
                <span className="truncate text-[10px] text-text-muted">{getSuggestionKey(item)}</span>
              </span>
            )}
          </UiOptionButton>
        )
      })}
    </div>
  )
})

PromptSuggestionList.displayName = 'PromptSuggestionList'
