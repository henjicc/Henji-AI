import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from 'react'
import type { JSONContent } from '@tiptap/core'
import Document from '@tiptap/extension-document'
import HardBreak from '@tiptap/extension-hard-break'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import { UndoRedo } from '@tiptap/extensions/undo-redo'
import { EditorContent, useEditor } from '@tiptap/react'

import { MediaReferenceExtension } from './MediaReferenceExtension'
import type {
  PromptEditorPrototypeHandle,
  PrototypeReference,
} from './prototypeTypes'

interface PrototypePromptEditorProps {
  value: JSONContent
  references: readonly PrototypeReference[]
  ariaLabel: string
  editable?: boolean
  onChange?: (document: JSONContent) => void
  onEditStart?: () => void
  onEditEnd?: () => void
  onReady?: () => void
  className?: string
}

function documentsEqual(left: JSONContent, right: JSONContent): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function isHistoryShortcut(event: KeyboardEvent): boolean {
  if (!event.ctrlKey && !event.metaKey) return false
  const key = event.key.toLocaleLowerCase()
  return key === 'z' || key === 'y'
}

export const PrototypePromptEditor = forwardRef<
  PromptEditorPrototypeHandle,
  PrototypePromptEditorProps
>(function PrototypePromptEditor({
  value,
  references,
  ariaLabel,
  editable = true,
  onChange,
  onEditStart,
  onEditEnd,
  onReady,
  className = '',
}, ref) {
  const readyReportedRef = useRef(false)
  const callbacksRef = useRef({ onChange, onEditStart, onEditEnd, onReady })
  callbacksRef.current = { onChange, onEditStart, onEditEnd, onReady }

  const extensions = useMemo(() => [
    Document,
    Paragraph,
    Text,
    HardBreak,
    UndoRedo.configure({ depth: 100, newGroupDelay: 500 }),
    MediaReferenceExtension.configure({ references }),
  ], [references])

  const editor = useEditor({
    extensions,
    content: value,
    editable,
    immediatelyRender: true,
    editorProps: {
      attributes: {
        'aria-label': ariaLabel,
        class: 'min-h-[92px] whitespace-pre-wrap break-words px-3 py-2.5 text-sm leading-6 text-text-dark outline-none',
      },
      handleKeyDown: (_view, event): boolean => {
        if (isHistoryShortcut(event)) event.stopPropagation()
        return false
      },
    },
    onCreate: (): void => {
      if (readyReportedRef.current) return
      readyReportedRef.current = true
      callbacksRef.current.onReady?.()
    },
    onUpdate: ({ editor: currentEditor }): void => {
      callbacksRef.current.onChange?.(currentEditor.getJSON())
    },
    onFocus: (): void => callbacksRef.current.onEditStart?.(),
    onBlur: (): void => callbacksRef.current.onEditEnd?.(),
  }, [extensions, ariaLabel])

  useEffect(() => {
    if (!editor || documentsEqual(editor.getJSON(), value)) return
    editor.commands.setContent(value, { emitUpdate: false, errorOnInvalidContent: true })
  }, [editor, value])

  useEffect(() => {
    editor?.setEditable(editable)
  }, [editable, editor])

  useImperativeHandle(ref, () => ({
    focus: (): void => {
      editor?.commands.focus()
    },
    getDocument: (): JSONContent => editor?.getJSON() ?? value,
    replaceDocument: (document): void => {
      editor?.chain().focus().setContent(document, {
        emitUpdate: true,
        errorOnInvalidContent: true,
      }).run()
    },
  }), [editor, value])

  return (
    <EditorContent
      editor={editor}
      className={`rounded-lg border border-border-dark bg-surface-dark transition-shadow focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-accent ${className}`}
    />
  )
})

PrototypePromptEditor.displayName = 'PrototypePromptEditor'
