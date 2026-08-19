import type { PromptDocumentV1 } from '@/core/inputs/promptDocument'
import { CanvasPromptEditor } from '@/features/canvas/nodes/shared/CanvasPromptEditor'
import {
  NODE_ROW_CARD_CLASS,
} from '@/features/canvas/ui/nodeControlStyles'
import { UI_TEXT_META_CLASS } from '@/components/ui'

interface TextProcessingSystemPromptEditorProps {
  selected: boolean
  value: PromptDocumentV1
  readOnly: boolean
  readOnlyHint: string
  label: string
  placeholder: string
  onChange: (document: PromptDocumentV1) => void
  onSubmit: () => void
  onEditEnd: () => void
  onSelectNode: () => void
}

export function TextProcessingSystemPromptEditor({
  selected,
  value,
  readOnly,
  readOnlyHint,
  label,
  placeholder,
  onChange,
  onSubmit,
  onEditEnd,
  onSelectNode,
}: TextProcessingSystemPromptEditorProps): JSX.Element {
  return (
    <div className="flex h-24 shrink-0 flex-col gap-1">
      <div className={`flex items-center justify-between gap-2 px-1 ${UI_TEXT_META_CLASS}`}>
        <span>{label}</span>
        {readOnly ? <span className="text-text-faint">{readOnlyHint}</span> : null}
      </div>
      <div className={`flex min-h-0 flex-1 flex-col p-1.5 focus-within:border-accent/70 ${NODE_ROW_CARD_CLASS}`}>
        <CanvasPromptEditor
          selected={selected}
          onSelectNode={onSelectNode}
          value={value}
          onChange={onChange}
          readOnly={readOnly}
          preset="plain"
          layout="fill-scroll"
          ariaLabel={label}
          placeholder={placeholder}
          submitShortcut="mod-enter"
          onSubmit={onSubmit}
          onEditEnd={onEditEnd}
          className={`nodrag nowheel relative !rounded-md !border-0 !bg-transparent !p-0 !shadow-none ${readOnly ? 'cursor-default' : 'cursor-text'}`}
          editorShellClassName={`relative !rounded-md !border-0 !bg-transparent !shadow-none focus-within:!ring-0 ${readOnly ? 'cursor-default' : 'cursor-text'}`}
          editorClassName="ui-scrollbar nodrag nowheel !px-1.5 !py-1 !text-sm !leading-6"
        />
      </div>
    </div>
  )
}
