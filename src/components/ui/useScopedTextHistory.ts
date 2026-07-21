import { useCallback, useEffect, useMemo, useRef } from 'react'
import type {
  ChangeEventHandler,
  CompositionEventHandler,
  FocusEventHandler,
  KeyboardEvent as ReactKeyboardEvent,
  KeyboardEventHandler,
  MouseEventHandler,
  ReactEventHandler,
} from 'react'

import {
  breakTextEditCoalescing,
  createTextHistoryState,
  recordTextEdit,
  redoTextEdit,
  type TextEditKind,
  type TextHistorySnapshot,
  type TextHistoryState,
  undoTextEdit,
} from './textHistory'

export type TextHistoryElement = HTMLInputElement | HTMLTextAreaElement

export interface ScopedTextHistoryBinding {
  onValueChange: (value: string) => void
  onEditStart?: () => void
  onEditEnd?: () => void
}

interface UseScopedTextHistoryOptions {
  value: string
  binding?: ScopedTextHistoryBinding
}

export interface ScopedTextHistoryController {
  recordNativeChange: (element: TextHistoryElement, nativeEvent: Event) => void
  recordProgrammaticChange: (element: TextHistoryElement, nextValue: string, nextCursor: number) => void
  synchronizeValue: (element: TextHistoryElement, nextValue: string, nextCursor: number) => void
  handleKeyDown: (event: ReactKeyboardEvent<TextHistoryElement>) => boolean
  handleFocus: (element: TextHistoryElement) => void
  handleBlur: (element: TextHistoryElement) => void
  handleSelect: (element: TextHistoryElement) => void
  handleMouseDown: () => void
  handleCompositionStart: (element: TextHistoryElement) => void
  handleCompositionEnd: (element: TextHistoryElement) => void
}

interface TextHistoryDomHandlers<T extends TextHistoryElement> {
  onChange?: ChangeEventHandler<T>
  onKeyDown?: KeyboardEventHandler<T>
  onFocus?: FocusEventHandler<T>
  onBlur?: FocusEventHandler<T>
  onSelect?: ReactEventHandler<T>
  onMouseDown?: MouseEventHandler<T>
  onCompositionStart?: CompositionEventHandler<T>
  onCompositionEnd?: CompositionEventHandler<T>
}

function createSnapshot(
  element: TextHistoryElement,
  valueOverride?: string,
  cursorOverride?: number
): TextHistorySnapshot {
  const value = valueOverride ?? element.value
  const selectionStart = cursorOverride ?? element.selectionStart ?? value.length
  const selectionEnd = cursorOverride ?? element.selectionEnd ?? selectionStart
  return {
    value,
    selectionStart,
    selectionEnd,
    scrollTop: element.scrollTop,
    scrollLeft: element.scrollLeft,
  }
}

function createFallbackSnapshot(value: string): TextHistorySnapshot {
  return {
    value,
    selectionStart: value.length,
    selectionEnd: value.length,
    scrollTop: 0,
    scrollLeft: 0,
  }
}

function resolveEditKind(nativeEvent: Event): TextEditKind {
  const inputType = nativeEvent instanceof InputEvent ? nativeEvent.inputType : ''
  if (inputType.startsWith('delete')) return 'delete'
  if (inputType === 'insertText') return 'insert'
  if (inputType === 'insertCompositionText') return 'composition'
  return 'replace'
}

function restoreSnapshot(element: TextHistoryElement, snapshot: TextHistorySnapshot): void {
  requestAnimationFrame(() => {
    element.focus({ preventScroll: true })
    element.setSelectionRange(snapshot.selectionStart, snapshot.selectionEnd)
    element.scrollTop = snapshot.scrollTop
    element.scrollLeft = snapshot.scrollLeft
  })
}

export function useScopedTextHistory({
  value,
  binding,
}: UseScopedTextHistoryOptions): ScopedTextHistoryController {
  const stateRef = useRef<TextHistoryState>(createTextHistoryState(createFallbackSnapshot(value)))
  const bindingRef = useRef(binding)
  const compositionBaselineRef = useRef<TextHistorySnapshot | null>(null)
  bindingRef.current = binding

  useEffect(() => {
    if (stateRef.current.current.value === value) return
    stateRef.current = createTextHistoryState(createFallbackSnapshot(value))
    compositionBaselineRef.current = null
  }, [value])

  const recordNativeChange = useCallback((element: TextHistoryElement, nativeEvent: Event): void => {
    const nextSnapshot = createSnapshot(element)
    if (compositionBaselineRef.current) {
      stateRef.current = { ...stateRef.current, current: nextSnapshot }
      return
    }
    stateRef.current = recordTextEdit(stateRef.current, nextSnapshot, resolveEditKind(nativeEvent), performance.now())
  }, [])

  const recordProgrammaticChange = useCallback((
    element: TextHistoryElement,
    nextValue: string,
    nextCursor: number
  ): void => {
    stateRef.current = recordTextEdit(
      stateRef.current,
      createSnapshot(element, nextValue, nextCursor),
      'replace',
      performance.now()
    )
  }, [])

  const synchronizeValue = useCallback((
    element: TextHistoryElement,
    nextValue: string,
    nextCursor: number
  ): void => {
    stateRef.current = {
      ...stateRef.current,
      current: createSnapshot(element, nextValue, nextCursor),
    }
  }, [])

  const handleKeyDown = useCallback((event: ReactKeyboardEvent<TextHistoryElement>): boolean => {
    if (!bindingRef.current) return false
    const commandPressed = event.ctrlKey || event.metaKey
    const key = event.key.toLowerCase()
    const isUndo = commandPressed && key === 'z' && !event.shiftKey && !event.altKey
    const isRedo = commandPressed && !event.altKey && (key === 'y' || (key === 'z' && event.shiftKey))

    if (!isUndo && !isRedo) {
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
        stateRef.current = breakTextEditCoalescing(stateRef.current)
      }
      return false
    }

    event.preventDefault()
    event.stopPropagation()
    const previousState = stateRef.current
    const nextState = isUndo ? undoTextEdit(previousState) : redoTextEdit(previousState)
    stateRef.current = nextState
    if (nextState.current !== previousState.current) {
      bindingRef.current.onValueChange(nextState.current.value)
      restoreSnapshot(event.currentTarget, nextState.current)
    }
    return true
  }, [])

  const handleFocus = useCallback((element: TextHistoryElement): void => {
    const snapshot = createSnapshot(element)
    stateRef.current = stateRef.current.current.value === snapshot.value
      ? { ...breakTextEditCoalescing(stateRef.current), current: snapshot }
      : createTextHistoryState(snapshot)
    bindingRef.current?.onEditStart?.()
  }, [])

  const handleBlur = useCallback((element: TextHistoryElement): void => {
    stateRef.current = {
      ...breakTextEditCoalescing(stateRef.current),
      current: createSnapshot(element),
    }
    compositionBaselineRef.current = null
    bindingRef.current?.onEditEnd?.()
  }, [])

  const handleSelect = useCallback((element: TextHistoryElement): void => {
    if (stateRef.current.current.value !== element.value) return
    stateRef.current = { ...stateRef.current, current: createSnapshot(element) }
  }, [])

  const handleMouseDown = useCallback((): void => {
    stateRef.current = breakTextEditCoalescing(stateRef.current)
  }, [])

  const handleCompositionStart = useCallback((element: TextHistoryElement): void => {
    compositionBaselineRef.current = createSnapshot(element)
    stateRef.current = breakTextEditCoalescing(stateRef.current)
  }, [])

  const handleCompositionEnd = useCallback((element: TextHistoryElement): void => {
    const baseline = compositionBaselineRef.current
    compositionBaselineRef.current = null
    if (!baseline) return
    const baseState = { ...stateRef.current, current: baseline }
    stateRef.current = recordTextEdit(baseState, createSnapshot(element), 'composition', performance.now())
  }, [])

  return useMemo(() => ({
    recordNativeChange,
    recordProgrammaticChange,
    synchronizeValue,
    handleKeyDown,
    handleFocus,
    handleBlur,
    handleSelect,
    handleMouseDown,
    handleCompositionStart,
    handleCompositionEnd,
  }), [
    handleBlur,
    handleCompositionEnd,
    handleCompositionStart,
    handleFocus,
    handleKeyDown,
    handleMouseDown,
    handleSelect,
    recordNativeChange,
    recordProgrammaticChange,
    synchronizeValue,
  ])
}

export function useScopedTextHistoryProps<T extends TextHistoryElement>(
  value: string,
  binding: ScopedTextHistoryBinding | undefined,
  handlers: TextHistoryDomHandlers<T>
): Required<TextHistoryDomHandlers<T>> {
  const history = useScopedTextHistory({ value, binding })
  return {
    onChange: (event) => {
      history.recordNativeChange(event.currentTarget, event.nativeEvent)
      handlers.onChange?.(event)
    },
    onKeyDown: (event) => {
      handlers.onKeyDown?.(event)
      if (!event.defaultPrevented) history.handleKeyDown(event)
    },
    onFocus: (event) => {
      history.handleFocus(event.currentTarget)
      handlers.onFocus?.(event)
    },
    onBlur: (event) => {
      history.handleBlur(event.currentTarget)
      handlers.onBlur?.(event)
    },
    onSelect: (event) => {
      history.handleSelect(event.currentTarget)
      handlers.onSelect?.(event)
    },
    onMouseDown: (event) => {
      history.handleMouseDown()
      handlers.onMouseDown?.(event)
    },
    onCompositionStart: (event) => {
      history.handleCompositionStart(event.currentTarget)
      handlers.onCompositionStart?.(event)
    },
    onCompositionEnd: (event) => {
      history.handleCompositionEnd(event.currentTarget)
      handlers.onCompositionEnd?.(event)
    },
  }
}
