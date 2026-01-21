/**
 * useKeyboardNav Hook
 *
 * 处理键盘导航逻辑（上下箭头、Enter、Escape）
 */

import { useState, useCallback, useEffect } from 'react'

interface UseKeyboardNavOptions<T> {
  items: T[]
  onSelect: (item: T) => void
  isOpen: boolean
  onClose?: () => void
}

interface UseKeyboardNavReturn {
  focusedIndex: number
  setFocusedIndex: (index: number) => void
  handleKeyDown: (e: React.KeyboardEvent) => void
}

export function useKeyboardNav<T>({
  items,
  onSelect,
  isOpen,
  onClose
}: UseKeyboardNavOptions<T>): UseKeyboardNavReturn {
  const [focusedIndex, setFocusedIndex] = useState(-1)

  // 重置焦点索引
  useEffect(() => {
    if (!isOpen) {
      setFocusedIndex(-1)
    }
  }, [isOpen])

  // 处理键盘事件
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!isOpen || items.length === 0) return

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setFocusedIndex(prev => {
          const next = prev + 1
          return next >= items.length ? 0 : next
        })
        break

      case 'ArrowUp':
        e.preventDefault()
        setFocusedIndex(prev => {
          const next = prev - 1
          return next < 0 ? items.length - 1 : next
        })
        break

      case 'Enter':
        e.preventDefault()
        if (focusedIndex >= 0 && focusedIndex < items.length) {
          onSelect(items[focusedIndex])
        }
        break

      case 'Escape':
        e.preventDefault()
        if (onClose) {
          onClose()
        }
        break

      case 'Home':
        e.preventDefault()
        setFocusedIndex(0)
        break

      case 'End':
        e.preventDefault()
        setFocusedIndex(items.length - 1)
        break
    }
  }, [isOpen, items, focusedIndex, onSelect, onClose])

  return {
    focusedIndex,
    setFocusedIndex,
    handleKeyDown
  }
}
