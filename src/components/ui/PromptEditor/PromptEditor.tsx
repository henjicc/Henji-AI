import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import Document from '@tiptap/extension-document'
import HardBreak from '@tiptap/extension-hard-break'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import { CharacterCount } from '@tiptap/extensions/character-count'
import { Placeholder } from '@tiptap/extensions/placeholder'
import { UndoRedo } from '@tiptap/extensions/undo-redo'
import { EditorContent, useEditor } from '@tiptap/react'

import { MediaReferenceExtension } from './extensions/mediaReference'
import { TemplateVariableExtension } from './extensions/templateVariable'
import {
  countPromptDocumentCharacters,
  fromTiptapContent,
  promptDocumentsEqual,
  toTiptapContent,
} from './promptEditorDocument'
import {
  isPromptEditorHistoryShortcut,
  shouldSubmitPromptEditor,
} from './promptEditorKeyboard'
import { resolvePromptEditorPreset } from './promptEditorPresets'
import { PromptEditorResourceRegistry } from './resourceRegistry'
import type { PromptReferenceItem, PromptVariableItem } from './types'
import type { PromptEditorHandle, PromptEditorProps } from './types'

const EDITOR_CONTENT_CLASS = [
  'min-h-[92px] whitespace-pre-wrap break-words px-3 py-2.5 text-sm leading-6 text-text-dark outline-none',
  '[&_.is-editor-empty:first-child::before]:pointer-events-none',
  '[&_.is-editor-empty:first-child::before]:float-left',
  '[&_.is-editor-empty:first-child::before]:h-0',
  '[&_.is-editor-empty:first-child::before]:text-text-muted',
  '[&_.is-editor-empty:first-child::before]:content-[attr(data-placeholder)]',
].join(' ')

const EMPTY_REFERENCES: readonly PromptReferenceItem[] = []
const EMPTY_VARIABLES: readonly PromptVariableItem[] = []

const EditablePromptEditor = forwardRef<PromptEditorHandle, PromptEditorProps>(
  function EditablePromptEditor({
    value,
    onChange,
    preset = 'plain',
    references = EMPTY_REFERENCES,
    variables = EMPTY_VARIABLES,
    resolveReference,
    resolveVariable,
    getReferenceSuggestions,
    getVariableSuggestions,
    suggestionContainer,
    ariaLabel,
    placeholder = '',
    disabled = false,
    readOnly = false,
    autoFocus = false,
    maxCharacters,
    showCharacterCount = false,
    submitShortcut = 'none',
    error = false,
    errorMessage,
    className = '',
    editorClassName = '',
    onSubmit,
    onEditStart,
    onEditEnd,
    onFocus,
    onBlur,
    onPaste,
    onDrop,
    onCompositionStart,
    onCompositionEnd,
    onKeyDown,
    onError,
  }, ref): JSX.Element {
    const callbacksRef = useRef({
      onChange,
      onSubmit,
      onEditStart,
      onEditEnd,
      onFocus,
      onBlur,
      onPaste,
      onDrop,
      onCompositionStart,
      onCompositionEnd,
      onKeyDown,
      onError,
    })
    callbacksRef.current = {
      onChange,
      onSubmit,
      onEditStart,
      onEditEnd,
      onFocus,
      onBlur,
      onPaste,
      onDrop,
      onCompositionStart,
      onCompositionEnd,
      onKeyDown,
      onError,
    }

    const valueRef = useRef(value)
    valueRef.current = value
    const placeholderRef = useRef(placeholder)
    placeholderRef.current = placeholder
    const submitShortcutRef = useRef(submitShortcut)
    submitShortcutRef.current = submitShortcut
    const editSessionActiveRef = useRef(false)
    const [resourceRegistry] = useState(() => new PromptEditorResourceRegistry({
      references,
      variables,
      resolveReference,
      resolveVariable,
      getReferenceSuggestions,
      getVariableSuggestions,
      suggestionContainer,
    }))
    const [characterCount, setCharacterCount] = useState(() => (
      countPromptDocumentCharacters(value)
    ))

    const extensions = useMemo(() => {
      const capabilities = resolvePromptEditorPreset(preset)
      return [
        Document,
        Paragraph,
        Text,
        HardBreak,
        UndoRedo.configure({ depth: 100, newGroupDelay: 500 }),
        Placeholder.configure({ placeholder: () => placeholderRef.current }),
        CharacterCount.configure({ limit: maxCharacters ?? null, mode: 'textSize' }),
        ...(capabilities.mediaReferences
          ? [MediaReferenceExtension.configure({ registry: resourceRegistry })]
          : []),
        ...(capabilities.templateVariables
          ? [TemplateVariableExtension.configure({ registry: resourceRegistry })]
          : []),
      ]
    }, [maxCharacters, preset, resourceRegistry])

    const editor = useEditor({
      extensions,
      content: toTiptapContent(value),
      editable: !disabled && !readOnly,
      autofocus: autoFocus,
      immediatelyRender: true,
      editorProps: {
        attributes: {
          'aria-label': ariaLabel,
          role: 'textbox',
          class: `${EDITOR_CONTENT_CLASS} ${editorClassName}`,
        },
        handleKeyDown: (view, event): boolean => {
          if (isPromptEditorHistoryShortcut(event)) event.stopPropagation()

          callbacksRef.current.onKeyDown?.(event)
          if (event.defaultPrevented) return true

          if (!callbacksRef.current.onSubmit) return false
          if (!shouldSubmitPromptEditor(view, event, submitShortcutRef.current)) return false
          event.preventDefault()
          callbacksRef.current.onSubmit()
          return true
        },
        handlePaste: (_view, event): boolean => {
          callbacksRef.current.onPaste?.(event)
          return event.defaultPrevented
        },
        handleDrop: (_view, event): boolean => {
          callbacksRef.current.onDrop?.(event)
          return event.defaultPrevented
        },
        handleDOMEvents: {
          compositionstart: (_view, event): boolean => {
            callbacksRef.current.onCompositionStart?.(event)
            return event.defaultPrevented
          },
          compositionend: (_view, event): boolean => {
            callbacksRef.current.onCompositionEnd?.(event)
            return event.defaultPrevented
          },
        },
      },
      onCreate: ({ editor: currentEditor }): void => {
        setCharacterCount(currentEditor.storage.characterCount.characters())
      },
      onUpdate: ({ editor: currentEditor }): void => {
        const document = fromTiptapContent(currentEditor.getJSON())
        setCharacterCount(currentEditor.storage.characterCount.characters())
        if (promptDocumentsEqual(valueRef.current, document)) return
        valueRef.current = document
        callbacksRef.current.onChange(document)
      },
      onFocus: (): void => {
        if (!editSessionActiveRef.current) {
          editSessionActiveRef.current = true
          callbacksRef.current.onEditStart?.()
        }
        callbacksRef.current.onFocus?.()
      },
      onBlur: (): void => {
        if (editSessionActiveRef.current) {
          editSessionActiveRef.current = false
          callbacksRef.current.onEditEnd?.()
        }
        callbacksRef.current.onBlur?.()
      },
      onDestroy: (): void => {
        if (!editSessionActiveRef.current) return
        editSessionActiveRef.current = false
        callbacksRef.current.onEditEnd?.()
      },
    }, [extensions])

    useEffect(() => {
      resourceRegistry.update({
        references,
        variables,
        resolveReference,
        resolveVariable,
        getReferenceSuggestions,
        getVariableSuggestions,
        suggestionContainer,
      })
    }, [
      getReferenceSuggestions,
      getVariableSuggestions,
      references,
      resolveReference,
      resolveVariable,
      resourceRegistry,
      suggestionContainer,
      variables,
    ])

    useEffect(() => {
      if (!editor || promptDocumentsEqual(fromTiptapContent(editor.getJSON()), value)) return
      try {
        editor.chain()
          .setMeta('addToHistory', false)
          .setContent(toTiptapContent(value), {
            emitUpdate: false,
            errorOnInvalidContent: true,
          })
          .run()
        valueRef.current = value
        setCharacterCount(editor.storage.characterCount.characters())
      } catch (caught) {
        callbacksRef.current.onError?.(
          caught instanceof Error ? caught : new Error(String(caught)),
        )
      }
    }, [editor, value])

    useEffect(() => {
      editor?.setEditable(!disabled && !readOnly)
    }, [disabled, editor, readOnly])

    useEffect(() => {
      if (!editor) return
      editor.setOptions({
        editorProps: {
          ...editor.options.editorProps,
          attributes: {
            ...editor.options.editorProps.attributes,
            'aria-label': ariaLabel,
            'aria-disabled': String(disabled),
            'aria-readonly': String(readOnly),
            role: 'textbox',
            class: `${EDITOR_CONTENT_CLASS} ${editorClassName}`,
          },
        },
      })
    }, [ariaLabel, disabled, editor, editorClassName, readOnly])

    useImperativeHandle(ref, () => ({
      focus: (): void => {
        editor?.commands.focus()
      },
      getDocument: () => editor ? fromTiptapContent(editor.getJSON()) : valueRef.current,
      replaceDocument: (document, options = {}): void => {
        if (!editor) {
          valueRef.current = document
          return
        }

        try {
          const chain = editor.chain().focus()
          if (options.addToHistory === false) chain.setMeta('addToHistory', false)
          chain.setContent(toTiptapContent(document), {
            emitUpdate: true,
            errorOnInvalidContent: true,
          }).run()
        } catch (caught) {
          callbacksRef.current.onError?.(
            caught instanceof Error ? caught : new Error(String(caught)),
          )
        }
      },
    }), [editor])

    const reachedLimit = maxCharacters !== undefined && characterCount >= maxCharacters
    const shellStateClass = error
      ? 'border-red-500/70'
      : 'border-border-dark focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-accent'

    return (
      <div className={className}>
        <EditorContent
          editor={editor}
          className={`rounded-lg border bg-surface-dark transition-shadow ${shellStateClass} ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
        />
        {(showCharacterCount || errorMessage) ? (
          <div className="mt-1 flex items-start justify-between gap-2 text-xs">
            <span className={error ? 'text-red-300' : 'text-text-muted'}>
              {errorMessage ?? ''}
            </span>
            {showCharacterCount ? (
              <span className={reachedLimit ? 'text-red-300' : 'text-text-muted'}>
                {characterCount}{maxCharacters === undefined ? '' : ` / ${maxCharacters}`}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    )
  },
)

EditablePromptEditor.displayName = 'EditablePromptEditor'

export const PromptEditor = EditablePromptEditor

PromptEditor.displayName = 'PromptEditor'
