import { memo, type CSSProperties } from 'react'
import type { PromptReferenceItem } from '@/components/ui'
import type { PromptDocumentV1 } from '@/core/inputs/promptDocument'
import type { StoryboardGenNodeData } from '@/features/canvas/domain/canvasNodes'
import { useCanvasEditHistory, createCanvasTextHistoryGroup } from '@/features/canvas/hooks/useCanvasTextHistory'
import { CanvasPromptEditor } from '@/features/canvas/nodes/shared/CanvasPromptEditor'
import { GridStepperControl, GRID_SUMMARY_CLASS } from './shared'
import type { StoryboardFrameLayout } from './layout'

interface StoryboardGridEditorProps {
  nodeId: string
  selected: boolean
  nodeData: StoryboardGenNodeData
  totalFrames: number
  frameLayout: StoryboardFrameLayout
  frameDocuments: Readonly<Record<string, PromptDocumentV1>>
  references: readonly PromptReferenceItem[]
  gridLocked?: boolean
  onSelectNode: () => void
  onRowChange: (delta: number) => void
  onColChange: (delta: number) => void
  onFrameDescriptionChange: (index: number, document: PromptDocumentV1, historyGroup: string) => void
}

interface FrameDescriptionEditorProps {
  nodeId: string
  selected: boolean
  frameId: string
  index: number
  value: PromptDocumentV1
  textStyle: CSSProperties
  references: readonly PromptReferenceItem[]
  onSelectNode: () => void
  onChange: (index: number, document: PromptDocumentV1, historyGroup: string) => void
}

function FrameDescriptionEditor({
  nodeId,
  selected,
  frameId,
  index,
  value,
  textStyle,
  references,
  onSelectNode,
  onChange,
}: FrameDescriptionEditorProps): JSX.Element {
  const historyGroup = createCanvasTextHistoryGroup(nodeId, `frames.${frameId}.description`)
  const editHistory = useCanvasEditHistory(historyGroup)
  return (
    <div className="h-full w-full" style={textStyle}>
      <CanvasPromptEditor
        selected={selected}
        onSelectNode={onSelectNode}
        value={value}
        onChange={(document) => onChange(index, document, historyGroup)}
        onEditEnd={editHistory.onEditEnd}
        preset="media-references"
        references={references}
        ariaLabel={`分镜 ${String(index + 1).padStart(2, '0')} 描述`}
        placeholder={`分镜 ${String(index + 1).padStart(2, '0')} 描述`}
        className="nodrag nowheel relative h-full min-h-0 w-full cursor-text"
        editorShellClassName="relative h-full min-h-0 w-full cursor-text overflow-visible !rounded-none !border-0 !bg-transparent !shadow-none focus-within:!ring-0"
        editorClassName="ui-scrollbar nodrag nowheel h-full min-h-0 overflow-y-auto overflow-x-hidden !px-1.5 !py-1 text-left !text-[length:var(--storyboard-frame-font-size)] !leading-[var(--storyboard-frame-line-height)]"
      />
    </div>
  )
}

export const StoryboardGridEditor = memo(({
  nodeId,
  selected,
  nodeData,
  totalFrames,
  frameLayout,
  frameDocuments,
  references,
  gridLocked = false,
  onSelectNode,
  onRowChange,
  onColChange,
  onFrameDescriptionChange,
}: StoryboardGridEditorProps): JSX.Element => {
  // 字号/行高直接走 inline style：Tailwind 任意值 class 与 UiTextAreaField 自带的
  // text-sm/px-3 等基础样式同优先级，谁生效取决于编译后样式表顺序，不可控；
  // inline style 的优先级始终高于普通 class，可以彻底绕开这个问题。
  // 小格子不常驻预留滚动条宽度，避免高 DPI 下挤占文字区域。
  const cellTextStyle: CSSProperties = {
    '--storyboard-frame-font-size': `${frameLayout.cellFontSizePx}px`,
    '--storyboard-frame-line-height': `${frameLayout.cellLineHeightPx}px`,
    scrollbarGutter: 'auto',
  } as CSSProperties

  return (
    <>
      <div className="canvas-node-lod-detail mb-2.5 flex shrink-0 items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <GridStepperControl
            label="行"
            value={nodeData.gridRows}
            disabled={gridLocked}
            onDecrease={() => onRowChange(-1)}
            onIncrease={() => onRowChange(1)}
          />
          <GridStepperControl
            label="列"
            value={nodeData.gridCols}
            disabled={gridLocked}
            onDecrease={() => onColChange(-1)}
            onIncrease={() => onColChange(1)}
          />
        </div>

        <div className={GRID_SUMMARY_CLASS}>
          {gridLocked ? `固定 ${nodeData.gridRows}×${nodeData.gridCols}` : `${totalFrames} 格`}
        </div>
      </div>

      <div className="canvas-node-lod-detail mb-2 flex min-h-0 flex-1 items-center justify-center">
        <div
          className="grid gap-0.5"
          style={{
            width: `${frameLayout.gridWidth}px`,
            gridTemplateColumns: `repeat(${nodeData.gridCols}, ${frameLayout.cellWidth}px)`,
          }}
        >
          {nodeData.frames.map((frame, index) => {
            const frameDocument = frameDocuments[frame.id]
            if (!frameDocument) return null
            const cellStyle: CSSProperties = { aspectRatio: frameLayout.cellAspectRatio }
            return (
              <div
                key={frame.id}
                className="relative overflow-hidden rounded border border-veil-subtle bg-bg-dark/40 transition-colors focus-within:border-accent/50"
                style={cellStyle}
              >
                <FrameDescriptionEditor
                  nodeId={nodeId}
                  selected={selected}
                  frameId={frame.id}
                  index={index}
                  value={frameDocument}
                  textStyle={cellTextStyle}
                  references={references}
                  onSelectNode={onSelectNode}
                  onChange={onFrameDescriptionChange}
                />
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
})

StoryboardGridEditor.displayName = 'StoryboardGridEditor'
