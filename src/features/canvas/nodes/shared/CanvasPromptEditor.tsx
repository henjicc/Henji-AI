import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

import {
  PromptEditor,
  type PromptEditorActivation,
  type PromptEditorHandle,
  type PromptEditorProps,
} from '@/components/ui'

export interface CanvasPromptEditorProps extends Omit<
  PromptEditorProps,
  'autoFocus' | 'mode' | 'onActivate' | 'onReady'
> {
  selected: boolean
  onSelectNode: () => void
}

type PendingActivation =
  | { kind: 'pointer'; activation: PromptEditorActivation }
  | { kind: 'keyboard' }

/**
 * 画布专用的静态/编辑态切换壳。
 * 非激活项只渲染轻量文档；首次手势等 Tiptap 真正挂载后再恢复光标或拖拽选区。
 */
export function CanvasPromptEditor({
  selected,
  onSelectNode,
  disabled = false,
  readOnly = false,
  onEditEnd,
  ...editorProps
}: CanvasPromptEditorProps): JSX.Element {
  const [isEditing, setIsEditing] = useState(false)
  const pendingActivationRef = useRef<PendingActivation | null>(null)
  const editorRef = useRef<PromptEditorHandle | null>(null)
  const savedScrollTopRef = useRef(0)
  const canActivate = !disabled && !readOnly

  useEffect(() => {
    if (!selected || !canActivate) {
      pendingActivationRef.current = null
      setIsEditing(false)
    }
  }, [canActivate, selected])

  const handleActivate = useCallback((activation?: PromptEditorActivation): void => {
    if (!canActivate) return
    savedScrollTopRef.current = editorRef.current?.getScrollTop() ?? 0
    pendingActivationRef.current = activation
      ? { kind: 'pointer', activation }
      : { kind: 'keyboard' }
    onSelectNode()
    setIsEditing(true)
  }, [canActivate, onSelectNode])

  const handleReady = useCallback((): void => {
    const editor = editorRef.current
    const activation = pendingActivationRef.current
    if (!editor || !activation) return
    editor.setScrollTop(savedScrollTopRef.current)
    if (activation.kind === 'keyboard') {
      editor.focus()
    } else if ('clientX' in activation.activation) {
      editor.focusAtPoint(activation.activation)
    } else {
      editor.selectRangeAtPoints(
        activation.activation.anchor,
        activation.activation.head,
      )
    }
    pendingActivationRef.current = null
  }, [])

  const handleEditEnd = useCallback((): void => {
    savedScrollTopRef.current = editorRef.current?.getScrollTop() ?? 0
    pendingActivationRef.current = null
    setIsEditing(false)
    onEditEnd?.()
  }, [onEditEnd])

  useLayoutEffect(() => {
    editorRef.current?.setScrollTop(savedScrollTopRef.current)
  }, [isEditing])

  return (
    <PromptEditor
      ref={editorRef}
      {...editorProps}
      disabled={disabled}
      readOnly={readOnly}
      mode={isEditing && canActivate ? 'edit' : 'static'}
      onActivate={canActivate ? handleActivate : undefined}
      onReady={handleReady}
      onEditEnd={handleEditEnd}
    />
  )
}
