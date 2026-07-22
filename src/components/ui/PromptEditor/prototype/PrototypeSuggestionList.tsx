import { forwardRef, useCallback, useEffect, useImperativeHandle, useState } from 'react'
import type { SuggestionKeyDownProps, SuggestionProps } from '@tiptap/suggestion'

import { UiOptionButton } from '@/components/ui/primitives'

import type { PrototypeReference } from './prototypeTypes'

export interface PrototypeSuggestionListHandle {
  onKeyDown: (props: SuggestionKeyDownProps) => boolean
}

type PrototypeSuggestionProps = SuggestionProps<PrototypeReference, PrototypeReference>

export const PrototypeSuggestionList = forwardRef<
  PrototypeSuggestionListHandle,
  PrototypeSuggestionProps
>(function PrototypeSuggestionList({ items, command }, ref) {
  const [selectedIndex, setSelectedIndex] = useState(0)

  useEffect(() => {
    setSelectedIndex(0)
  }, [items])

  const selectItem = useCallback((index: number): void => {
    const item = items[index]
    if (item) command(item)
  }, [command, items])

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }): boolean => {
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
      return event.key === 'Escape'
    },
  }), [items, selectItem, selectedIndex])

  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-border-dark bg-panel px-3 py-2 text-xs text-text-muted shadow-2xl">
        没有匹配的媒体
      </div>
    )
  }

  return (
    <div
      className="flex min-w-[220px] flex-col gap-1 rounded-lg border border-border-dark bg-panel p-1.5 shadow-2xl"
      role="listbox"
      aria-label="媒体引用候选"
    >
      {items.map((item, index) => (
        <UiOptionButton
          key={item.id}
          active={index === selectedIndex}
          className="gap-2"
          role="option"
          aria-selected={index === selectedIndex}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => selectItem(index)}
        >
          {item.thumbnailSrc ? (
            <img
              src={item.thumbnailSrc}
              alt=""
              className="h-8 w-8 rounded object-cover"
              draggable={false}
            />
          ) : (
            <span className="flex h-8 w-8 items-center justify-center rounded bg-layer text-[10px] text-text-muted">
              {item.mediaType}
            </span>
          )}
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-xs text-text-dark">{item.label}</span>
            <span className="truncate text-[10px] text-text-muted">{item.id}</span>
          </span>
        </UiOptionButton>
      ))}
    </div>
  )
})

PrototypeSuggestionList.displayName = 'PrototypeSuggestionList'
