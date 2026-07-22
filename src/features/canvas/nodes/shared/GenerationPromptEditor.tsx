import { useCallback, useEffect, useRef, useState } from 'react'
import { Handle, Position } from '@xyflow/react'

import {
  PromptEditor,
  type PromptEditorActivationPoint,
  type PromptEditorHandle,
  type PromptReferenceItem,
} from '@/components/ui'
import type { PromptDocumentV1 } from '@/core/inputs/promptDocument'
import { getSocketColor, promptPortId } from '@/features/canvas/domain/socketTypes'
import {
  NODE_PORT_ROW_CLASS,
  NODE_PORT_VISIBLE_CLASS,
  NODE_ROW_CARD_CLASS,
} from '@/features/canvas/ui/nodeControlStyles'
import { useCanvasContentLod } from './useCanvasContentLod'

export interface GenerationPromptEditorProps {
  nodeId: string
  selected: boolean
  value: PromptDocumentV1
  references: readonly PromptReferenceItem[]
  readOnly: boolean
  invalid: boolean
  placeholder: string
  onChange: (document: PromptDocumentV1) => void
  onSubmit: () => void
  onEditEnd: () => void
  onSelectNode: (nodeId: string) => void
}

type PendingPromptActivation =
  | { kind: 'pointer'; point: PromptEditorActivationPoint }
  | { kind: 'keyboard' }

export function GenerationPromptEditor({
  nodeId,
  selected,
  value,
  references,
  readOnly,
  invalid,
  placeholder,
  onChange,
  onSubmit,
  onEditEnd,
  onSelectNode,
}: GenerationPromptEditorProps): JSX.Element {
  const isContentLodLow = useCanvasContentLod()
  const [isEditing, setIsEditing] = useState(false)
  const pendingActivationRef = useRef<PendingPromptActivation | null>(null)
  const activeEditorRef = useRef<PromptEditorHandle | null>(null)
  const canActivate = !readOnly && !isContentLodLow
  const isEditorActive = isEditing && canActivate

  useEffect(() => {
    if (!selected || !canActivate) {
      pendingActivationRef.current = null
      setIsEditing(false)
    }
  }, [canActivate, selected])

  const handleActivate = useCallback((point?: PromptEditorActivationPoint): void => {
    if (readOnly || isContentLodLow) return
    pendingActivationRef.current = point
      ? { kind: 'pointer', point }
      : { kind: 'keyboard' }
    onSelectNode(nodeId)
    setIsEditing(true)
  }, [isContentLodLow, nodeId, onSelectNode, readOnly])

  const handleEditorRef = useCallback((editor: PromptEditorHandle | null): void => {
    activeEditorRef.current = editor
  }, [])

  const handleEditorReady = useCallback((): void => {
    const editor = activeEditorRef.current
    const activation = pendingActivationRef.current
    if (!editor || !activation) return

    // 画布静态 renderer 的首次点击不会落到随后挂载的 contenteditable 上。
    // 等 Tiptap 真正完成 mount 后只执行这一处聚焦；画布路径禁用 autoFocus，
    // 避免 Tiptap 延迟 focus(true) 再把已经恢复的 selection 覆盖为文首。
    if (activation.kind === 'pointer') {
      editor.focusAtPoint(activation.point)
    } else {
      editor.focus()
    }
    pendingActivationRef.current = null
  }, [])

  const handleEditEnd = useCallback((): void => {
    pendingActivationRef.current = null
    onEditEnd()
    setIsEditing(false)
  }, [onEditEnd])

  return (
    <div className="group/row relative flex min-h-[100px] flex-1 flex-col">
      <Handle
        type="target"
        id={promptPortId()}
        position={Position.Left}
        style={{
          background: getSocketColor('STRING'),
          left: 0,
          top: '50%',
          transform: 'translate(-50%, -50%)',
        }}
        className={`${NODE_PORT_ROW_CLASS} ${readOnly ? NODE_PORT_VISIBLE_CLASS : ''}`}
      />
      <div
        className={`flex min-h-0 flex-1 flex-col p-1.5 focus-within:border-accent/70 ${NODE_ROW_CARD_CLASS} ${invalid ? '!border-red-500/70' : ''}`}
      >
        <PromptEditor
          ref={handleEditorRef}
          value={value}
          onChange={onChange}
          preset="media-references"
          references={references}
          mode={isEditorActive ? 'edit' : 'static'}
          ariaLabel={placeholder}
          placeholder={placeholder}
          readOnly={readOnly}
          submitShortcut="mod-enter"
          error={invalid}
          onSubmit={onSubmit}
          onReady={handleEditorReady}
          onEditEnd={handleEditEnd}
          onActivate={canActivate ? handleActivate : undefined}
          className={`nodrag nowheel relative flex min-h-[86px] flex-1 cursor-text flex-col !rounded-md !border-0 !bg-transparent !shadow-none ${isEditorActive ? 'overflow-visible !p-0' : 'overflow-y-auto overflow-x-hidden !px-1.5 !py-1'} ${invalid ? '[&>span]:!text-red-400/90' : ''}`}
          editorShellClassName="relative flex min-h-[86px] flex-1 cursor-text flex-col overflow-visible !rounded-md !border-0 !bg-transparent !shadow-none focus-within:!ring-0"
          editorClassName={`ui-scrollbar nodrag nowheel min-h-[86px] flex-1 overflow-y-auto overflow-x-hidden !px-1.5 !py-1 !text-sm !leading-6 ${invalid ? '[&.is-editor-empty:first-child::before]:!text-red-400/90' : ''}`}
        />
      </div>
    </div>
  )
}
