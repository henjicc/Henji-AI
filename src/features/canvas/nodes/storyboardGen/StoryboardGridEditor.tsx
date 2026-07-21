import { memo, type CSSProperties } from 'react'
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
  // 字号/行高直接走 inline style：Tailwind 任意值 class 与 UiTextAreaField 自带的
  // text-sm/px-3 等基础样式同优先级，谁生效取决于编译后样式表顺序，不可控；
  // inline style 的优先级始终高于普通 class，可以彻底绕开这个问题。
  // scrollbarGutter 覆写为 auto：ReferenceTextarea 默认用 stable 常驻预留滚动条宽度，
  // 在最小尺寸的小格子里这部分预留（高 DPI 下可达 10+px）会挤占大半可用宽度、逼着文字换行；
  // 改成 auto 后无内容溢出时不预留，把宽度让回给文字，小格子才能单行显示。
  const cellTextStyle: CSSProperties = {
    fontSize: `${frameLayout.cellFontSizePx}px`,
    lineHeight: `${frameLayout.cellLineHeightPx}px`,
    scrollbarGutter: 'auto',
  }

  return (
    <>
      <div className="canvas-node-lod-detail mb-2.5 flex shrink-0 items-center justify-between gap-2">
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

      <div className="canvas-node-lod-detail mb-2 flex min-h-0 flex-1 items-center justify-center">
        <div
          className="grid gap-0.5"
          style={{
            width: `${frameLayout.gridWidth}px`,
            gridTemplateColumns: `repeat(${nodeData.gridCols}, ${frameLayout.cellWidth}px)`,
          }}
        >
          {nodeData.frames.map((frame, index) => {
            const frameDescription = frameDescriptionDrafts[frame.id] ?? frame.description
            const cellStyle: CSSProperties = { aspectRatio: frameLayout.cellAspectRatio }
            return (
              <div
                key={frame.id}
                className="relative overflow-hidden rounded border border-[rgba(255,255,255,0.06)] bg-bg-dark/40 transition-colors focus-within:border-accent/50"
                style={cellStyle}
              >
                <ReferenceTextarea
                  value={frameDescription}
                  onChange={(nextValue) => onFrameDescriptionChange(index, nextValue)}
                  references={incomingImageItems}
                  pickerAnchorScale={zoom}
                  placeholder={`分镜 ${String(index + 1).padStart(2, '0')} 描述`}
                  wrap="soft"
                  className="relative h-full w-full"
                  highlightLayerClassName="text-text-dark"
                  highlightLayerStyle={cellTextStyle}
                  highlightContentClassName="px-1.5 py-1 text-left"
                  textareaClassName="ui-scrollbar nodrag nowheel relative z-10 h-full w-full resize-none overflow-y-auto overflow-x-hidden !border-0 !bg-transparent !shadow-none !px-1.5 !py-1 text-left text-transparent caret-text-dark placeholder:text-text-muted/40 selection:bg-accent/45 selection:text-white focus:!outline-none focus:!ring-0 focus:!shadow-none whitespace-pre-wrap break-words"
                  style={cellTextStyle}
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
