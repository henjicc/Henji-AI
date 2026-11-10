import type { UiTextAreaHeight } from '../styleTokens'
import type { PromptDocumentV1, PromptMediaType } from '@/core/inputs/promptDocument'
import type { PromptEditorExternalChange } from './extensions/externalHistory'

export type { PromptEditorExternalChange }

export type PromptEditorPreset =
  | 'plain'
  | 'media-references'
  | 'template-variables'
  | 'structured'
type PromptEditorMode = 'edit' | 'static'
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

interface ReplacePromptDocumentOptions {
  addToHistory?: boolean
}

export interface PromptEditorActivationPoint {
  clientX: number
  clientY: number
}

interface PromptEditorActivationRange {
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
  /**
   * 在文档位置插入素材引用（与手动输入 @ 选中素材相同）；位置超出当前文档时落在末尾。
   * 带 change 时把这次外部变化（如素材进参考条）与插入并成一步撤销。
   */
  insertMediaReferences: (position: number, references: readonly PromptReferenceItem[], change?: PromptEditorExternalChange) => void
  /** 把编辑器以外已经发生的一次变化记进编辑器的撤销栈，与文字编辑按顺序一起撤销、重做。 */
  recordExternalChange: (change: PromptEditorExternalChange) => void
  undo: () => void
  redo: () => void
}

/** 拖放落点：松手处对应的文档位置，落在文字区之外时为 null。 */
interface PromptEditorDropTarget {
  position: number | null
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
  height?: UiTextAreaHeight
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
  /**
   * 编辑器外框：`field`（默认）= 字段表面 + 描边 + 聚焦环；`none` = 无框无底，
   * 用于外层已经是一整块输入卡片的场景（生成输入区，界面重设计 3.2）。
   */
  frame?: 'field' | 'none'
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
  onDrop?: (event: DragEvent, target: PromptEditorDropTarget) => void
  onCompositionStart?: (event: CompositionEvent) => void
  onCompositionEnd?: (event: CompositionEvent) => void
  onKeyDown?: (event: KeyboardEvent) => void
  onError?: (error: Error) => void
}
