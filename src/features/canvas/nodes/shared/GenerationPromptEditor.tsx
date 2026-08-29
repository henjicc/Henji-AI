import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Handle, Position } from '@xyflow/react'

import {
  PromptEditor,
  UI_TEXT_META_CLASS,
  type PromptEditorActivation,
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
import { GENERATION_PROMPT_MIN_HEIGHT_PX } from './useGenerationNodeMinimumHeight'

export interface GenerationPromptEditorProps {
  nodeId: string
  selected: boolean
  value: PromptDocumentV1
  references: readonly PromptReferenceItem[]
  readOnly: boolean
  invalid: boolean
  placeholder: string
  maxCharacters?: number
  label?: string
  onChange: (document: PromptDocumentV1) => void
  onSubmit: () => void
  onEditEnd: () => void
  onSelectNode: (nodeId: string) => void
}

type PendingPromptActivation =
  | { kind: 'pointer'; activation: PromptEditorActivation }
  | { kind: 'keyboard' }

export function GenerationPromptEditor({
  nodeId,
  selected,
  value,
  references,
  readOnly,
  invalid,
  placeholder,
  maxCharacters,
  label,
  onChange,
  onSubmit,
  onEditEnd,
  onSelectNode,
}: GenerationPromptEditorProps): JSX.Element {
  const isContentLodLow = useCanvasContentLod()
  const [isEditing, setIsEditing] = useState(false)
  const pendingActivationRef = useRef<PendingPromptActivation | null>(null)
  const activeEditorRef = useRef<PromptEditorHandle | null>(null)
  const savedScrollTopRef = useRef(0)
  const canActivate = !readOnly && !isContentLodLow
  const isEditorActive = isEditing && canActivate

  useEffect(() => {
    if (!selected || !canActivate) {
      pendingActivationRef.current = null
      setIsEditing(false)
    }
  }, [canActivate, selected])

  const handleActivate = useCallback((activation?: PromptEditorActivation): void => {
    if (readOnly || isContentLodLow) return
    savedScrollTopRef.current = activeEditorRef.current?.getScrollTop() ?? 0
    pendingActivationRef.current = activation
      ? { kind: 'pointer', activation }
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

    editor.setScrollTop(savedScrollTopRef.current)

    // 画布静态 renderer 的首次手势不会落到随后挂载的 contenteditable 上。
    // 等 Tiptap 真正完成 mount 后恢复点击光标或拖拽选区；画布路径禁用 autoFocus，
    // 避免 Tiptap 延迟 focus(true) 再把已经恢复的 selection 覆盖为文首。
    if (activation.kind === 'keyboard') {
      editor.focus()
    } else {
      const pointerActivation = activation.activation
      if ('clientX' in pointerActivation) {
        editor.focusAtPoint(pointerActivation)
      } else {
        editor.selectRangeAtPoints(pointerActivation.anchor, pointerActivation.head)
      }
    }
    pendingActivationRef.current = null
  }, [])

  const handleEditEnd = useCallback((): void => {
    savedScrollTopRef.current = activeEditorRef.current?.getScrollTop() ?? 0
    pendingActivationRef.current = null
    onEditEnd()
    setIsEditing(false)
  }, [onEditEnd])

  useLayoutEffect(() => {
    activeEditorRef.current?.setScrollTop(savedScrollTopRef.current)
  }, [isEditorActive])

  // 提示词正文不参与节点宽度测量：节点根是 width:max-content（宽度由模型行、
  // 媒体行等固定行决定），不隔离时一行长提示词的 max-content 宽会一路把节点
  // 撑到 maxWidth 而不换行。inline 轴尺寸隔离让本行按外层已定宽度渲染并正常
  // 折行，与高度侧「正文不进入最低高度」的处理对称。
  return (
    <div
      className="group/row relative flex flex-1 flex-col"
      style={{ minHeight: GENERATION_PROMPT_MIN_HEIGHT_PX, contain: 'inline-size' }}
    >
      {label ? <div className={`mb-1 px-1 ${UI_TEXT_META_CLASS}`}>{label}</div> : null}
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
          layout="fill-scroll"
          ariaLabel={placeholder}
          placeholder={placeholder}
          maxCharacters={maxCharacters}
          showCharacterCount={typeof maxCharacters === 'number'}
          readOnly={readOnly}
          submitShortcut="mod-enter"
          error={invalid}
          onSubmit={onSubmit}
          onReady={handleEditorReady}
          onEditEnd={handleEditEnd}
          onActivate={canActivate ? handleActivate : undefined}
          className={`nodrag nowheel relative cursor-text !rounded-md !border-0 !bg-transparent !p-0 !shadow-none ${invalid ? '[&>span]:!text-red-400/90' : ''}`}
          editorShellClassName="relative cursor-text !rounded-md !border-0 !bg-transparent !shadow-none focus-within:!ring-0"
          editorClassName={`ui-scrollbar nodrag nowheel !px-1.5 !py-1 !text-sm !leading-6 ${invalid ? '[&.is-editor-empty:first-child::before]:!text-red-400/90' : ''}`}
        />
      </div>
    </div>
  )
}
