import { memo } from 'react'
import type { StoryboardGenNodeData } from '@/features/canvas/domain/canvasNodes'
import { ReferenceTextarea, type ReferenceItem } from '@/components/ui'
import { GridStepperControl, GRID_SUMMARY_CLASS } from './shared'
import type { StoryboardFrameLayout } from './layout'

interface StoryboardGridEditorProps {
  nodeData: StoryboardGenNodeData
  totalFrames: number
  frameLayout: StoryboardFrameLayout
  zoom: number
  frameDescriptionDrafts: Record<string, string>
  incomingImageItems: ReferenceItem[]
  onRowChange: (delta: number) => void
  onColChange: (delta: number) => void
  onFrameDescriptionChange: (index: number, description: string) => void
}

export const StoryboardGridEditor = memo(({
  nodeData,
  totalFrames,
  frameLayout,
  zoom,
  frameDescriptionDrafts,
  incomingImageItems,
  onRowChange,
  onColChange,
  onFrameDescriptionChange,
}: StoryboardGridEditorProps): JSX.Element => {
  return (
    <>
      <div className="mb-2.5 flex shrink-0 items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <GridStepperControl
            label="行"
            value={nodeData.gridRows}
            onDecrease={() => onRowChange(-1)}
            onIncrease={() => onRowChange(1)}
          />
          <GridStepperControl
            label="列"
            value={nodeData.gridCols}
            onDecrease={() => onColChange(-1)}
            onIncrease={() => onColChange(1)}
          />
        </div>

        <div className={GRID_SUMMARY_CLASS}>
          {totalFrames} 格
        </div>
      </div>

      <div className="mb-2 flex min-h-0 flex-1 items-center justify-center">
        <div
          className="grid gap-0.5"
          style={{
            width: `${frameLayout.gridWidth}px`,
            gridTemplateColumns: `repeat(${nodeData.gridCols}, ${frameLayout.cellWidth}px)`,
          }}
        >
          {nodeData.frames.map((frame, index) => {
            const frameDescription = frameDescriptionDrafts[frame.id] ?? frame.description
            return (
              <div
                key={frame.id}
                className="relative overflow-hidden rounded border border-[rgba(255,255,255,0.06)] bg-bg-dark/40"
                style={{ aspectRatio: frameLayout.cellAspectRatio }}
              >
                <ReferenceTextarea
                  value={frameDescription}
                  onChange={(nextValue) => onFrameDescriptionChange(index, nextValue)}
                  references={incomingImageItems}
                  pickerAnchorScale={zoom}
                  placeholder={`分镜 ${String(index + 1).padStart(2, '0')} 描述`}
                  wrap="soft"
                  className="relative h-full w-full"
                  highlightLayerClassName="text-[10px] leading-4 text-text-dark"
                  highlightContentClassName="px-1.5 py-1 text-left"
                  textareaClassName="ui-scrollbar nodrag nowheel relative z-10 h-full w-full resize-none overflow-y-auto overflow-x-hidden bg-transparent px-1.5 py-1 text-left text-[10px] leading-4 text-transparent caret-text-dark placeholder:text-text-muted/40 focus:border-accent/50 focus:outline-none whitespace-pre-wrap break-words"
                  pickerClassName="w-[120px]"
                  pickerListClassName="max-h-[180px]"
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
