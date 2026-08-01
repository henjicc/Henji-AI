import type { PromptDocumentV1, PromptMediaType } from '@/core/inputs/promptDocument'

export type PromptEditorPreset =
  | 'plain'
  | 'media-references'
  | 'template-variables'
  | 'structured'
export type PromptEditorMode = 'edit' | 'static'
export type PromptEditorLayout = 'auto' | 'fill-scroll'
export type PromptEditorSubmitShortcut = 'enter' | 'mod-enter' | 'none'

export interface PromptReferenceItem {
  resourceId: string
  mediaType: PromptMediaType
  label: string
  legacyLabels?: readonly string[]
  thumbnailSrc?: string
  sourceNodeId?: string
}

export interface PromptVariableItem {
  key: string
  label: string
  group?: string
  description?: string
}

export type PromptReferenceResolver = (
  resourceId: string,
) => PromptReferenceItem | undefined

export type PromptVariableResolver = (
  key: string,
) => PromptVariableItem | undefined

export type PromptReferenceSuggestionProvider = (
  query: string,
) => readonly PromptReferenceItem[] | Promise<readonly PromptReferenceItem[]>

export type PromptVariableSuggestionProvider = (
  query: string,
) => readonly PromptVariableItem[] | Promise<readonly PromptVariableItem[]>

export interface ReplacePromptDocumentOptions {
  addToHistory?: boolean
}

export interface PromptEditorActivationPoint {
  clientX: number
  clientY: number
}

export interface PromptEditorActivationRange {
  anchor: PromptEditorActivationPoint
  head: PromptEditorActivationPoint
}

export type PromptEditorActivation =
  | PromptEditorActivationPoint
  | PromptEditorActivationRange

export interface PromptEditorHandle {
  focus: () => void
  focusAtPoint: (point: PromptEditorActivationPoint) => void
  selectRangeAtPoints: (
    anchor: PromptEditorActivationPoint,
    head: PromptEditorActivationPoint,
  ) => void
  getScrollTop: () => number
  setScrollTop: (scrollTop: number) => void
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
  references?: readonly PromptReferenceItem[]
  variables?: readonly PromptVariableItem[]
  resolveReference?: PromptReferenceResolver
  resolveVariable?: PromptVariableResolver
  getReferenceSuggestions?: PromptReferenceSuggestionProvider
  getVariableSuggestions?: PromptVariableSuggestionProvider
  suggestionContainer?: string | HTMLElement
  mode?: PromptEditorMode
  layout?: PromptEditorLayout
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
  editorShellClassName?: string
  editorClassName?: string
  onSubmit?: () => void
  onReady?: () => void
  onEditStart?: () => void
  onEditEnd?: () => void
  onActivate?: (activation?: PromptEditorActivation) => void
  onFocus?: () => void
  onBlur?: () => void
  onPaste?: (event: ClipboardEvent) => void
  onDrop?: (event: DragEvent) => void
  onCompositionStart?: (event: CompositionEvent) => void
  onCompositionEnd?: (event: CompositionEvent) => void
  onKeyDown?: (event: KeyboardEvent) => void
  onError?: (error: Error) => void
}
