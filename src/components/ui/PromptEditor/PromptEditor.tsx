import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
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
import { UI_TEXT_META_CLASS } from '../styleTokens'

import { MediaReferenceExtension } from './extensions/mediaReference'
import { TemplateVariableExtension } from './extensions/templateVariable'
import {
  countPromptDocumentCharacters,
  fromTiptapContent,
  promptDocumentsEqual,
  toTiptapContent,
} from './promptEditorDocument'
import {
  getPromptEditorLayoutClasses,
  getPromptEditorShellStateClass,
  PROMPT_EDITOR_CONTENT_CLASS,
  PROMPT_EDITOR_SHELL_CLASS,
} from './promptEditorStyles'
import {
  isPromptEditorHistoryShortcut,
  shouldSubmitPromptEditor,
} from './promptEditorKeyboard'
import { resolvePromptEditorPreset } from './promptEditorPresets'
import { pastePromptMediaReferences } from './promptEditorPaste'
import { PromptEditorResourceRegistry } from './resourceRegistry'
import type { PromptReferenceItem, PromptVariableItem } from './types'
import type {
  PromptEditorActivationPoint,
  PromptEditorHandle,
  PromptEditorProps,
} from './types'

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
    layout = 'auto',
    className = '',
    editorShellClassName = '',
    editorClassName = '',
    onSubmit,
    onReady,
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
    const layoutClasses = getPromptEditorLayoutClasses(layout)
    const callbacksRef = useRef({
      onChange,
      onSubmit,
      onReady,
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
      onReady,
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
    const readyEditorRef = useRef<object | null>(null)
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
          class: `${PROMPT_EDITOR_CONTENT_CLASS} ${layoutClasses.content} ${disabled ? 'cursor-not-allowed' : 'cursor-text'} ${editorClassName}`,
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
        handlePaste: (view, event): boolean => {
          callbacksRef.current.onPaste?.(event)
          if (event.defaultPrevented) return true
          return pastePromptMediaReferences(view, event, resourceRegistry)
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
            class: `${PROMPT_EDITOR_CONTENT_CLASS} ${layoutClasses.content} ${disabled ? 'cursor-not-allowed' : 'cursor-text'} ${editorClassName}`,
          },
        },
      })
    }, [ariaLabel, disabled, editor, editorClassName, layoutClasses.content, readOnly])

    useImperativeHandle(ref, () => ({
      focus: (): void => {
        editor?.commands.focus()
      },
      focusAtPoint: (point: PromptEditorActivationPoint): void => {
        if (!editor) return
        const position = editor.view.posAtCoords({
          left: point.clientX,
          top: point.clientY,
        })
        if (!position) {
          editor.commands.focus()
          return
        }
        editor.chain().focus().setTextSelection(position.pos).run()
      },
      selectRangeAtPoints: (
        anchor: PromptEditorActivationPoint,
        head: PromptEditorActivationPoint,
      ): void => {
        if (!editor) return
        const anchorPosition = editor.view.posAtCoords({
          left: anchor.clientX,
          top: anchor.clientY,
        })
        const headPosition = editor.view.posAtCoords({
          left: head.clientX,
          top: head.clientY,
        })
        if (!anchorPosition || !headPosition) {
          editor.commands.focus()
          return
        }
        editor.chain().focus().setTextSelection({
          from: Math.min(anchorPosition.pos, headPosition.pos),
          to: Math.max(anchorPosition.pos, headPosition.pos),
        }).run()
      },
      getScrollTop: (): number => editor?.view.dom.scrollTop ?? 0,
      setScrollTop: (scrollTop): void => {
        if (editor) editor.view.dom.scrollTop = scrollTop
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

    // 画布静态态切换为真实编辑器时，调用方会在 onReady 中恢复光标或拖拽选区。
    // 必须在浏览器绘制前完成，否则静态选区消失与 Tiptap 选区出现之间会闪一帧。
    useLayoutEffect(() => {
      if (!editor || readyEditorRef.current === editor) return
      readyEditorRef.current = editor
      setCharacterCount(editor.storage.characterCount.characters())
      callbacksRef.current.onReady?.()
    }, [editor])

    const reachedLimit = maxCharacters !== undefined && characterCount >= maxCharacters
    const shellStateClass = getPromptEditorShellStateClass(error)

    return (
      <div className={`${layoutClasses.outer} ${className}`}>
        <EditorContent
          editor={editor}
          className={`${PROMPT_EDITOR_SHELL_CLASS} ${shellStateClass} ${layoutClasses.shell} ${editorShellClassName} ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
        />
        {(showCharacterCount || errorMessage) ? (
          <div className={`mt-1 flex items-start justify-between gap-2 ${UI_TEXT_META_CLASS}`}>
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
