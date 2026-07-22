import type { PromptDocumentV1 } from '@/core/inputs/promptDocument'

export type PromptEditorPreset = 'plain'
export type PromptEditorMode = 'edit' | 'static'
export type PromptEditorSubmitShortcut = 'enter' | 'mod-enter' | 'none'

export interface ReplacePromptDocumentOptions {
  addToHistory?: boolean
}

export interface PromptEditorHandle {
  focus: () => void
  getDocument: () => PromptDocumentV1
  replaceDocument: (
    document: PromptDocumentV1,
    options?: ReplacePromptDocumentOptions,
  ) => void
}

export interface PromptEditorProps {
  value: PromptDocumentV1
  onChange: (document: PromptDocumentV1) => void
  preset?: PromptEditorPreset
  mode?: PromptEditorMode
  ariaLabel: string
  placeholder?: string
  disabled?: boolean
  readOnly?: boolean
  autoFocus?: boolean
  maxCharacters?: number
  showCharacterCount?: boolean
  submitShortcut?: PromptEditorSubmitShortcut
  error?: boolean
  errorMessage?: string
  className?: string
  editorClassName?: string
  onSubmit?: () => void
  onEditStart?: () => void
  onEditEnd?: () => void
  onActivate?: () => void
  onFocus?: () => void
  onBlur?: () => void
  onPaste?: (event: ClipboardEvent) => void
  onDrop?: (event: DragEvent) => void
  onCompositionStart?: (event: CompositionEvent) => void
  onCompositionEnd?: (event: CompositionEvent) => void
  onKeyDown?: (event: KeyboardEvent) => void
  onError?: (error: Error) => void
}
