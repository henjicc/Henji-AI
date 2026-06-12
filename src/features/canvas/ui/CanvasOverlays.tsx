import type { CanvasNodeType } from '@/features/canvas/domain/canvasNodes'
import type { PreviewConnectionVisual } from '@/features/canvas/canvasUtils'
import { NodeSelectionMenu } from '@/features/canvas/NodeSelectionMenu'
import { CanvasEmptyHint } from '@/features/canvas/ui/CanvasEmptyHint'
import { ImageViewerModal } from '@/components/mediaViewer/ImageViewerModal'

interface CanvasOverlaysProps {
  nodesCount: number
  emptyTitle: string
  emptySubtitle: string
  showNodeMenu: boolean
  previewConnectionVisual: PreviewConnectionVisual | null
  menuPosition: { x: number; y: number }
  menuAllowedTypes?: CanvasNodeType[]
  onSelectNodeType: (type: CanvasNodeType) => void
  onCloseNodeMenu: () => void
  imageViewerOpen: boolean
  imageViewerCurrentUrl: string
  imageViewerList: string[]
  imageViewerIndex: number
  onCloseImageViewer: () => void
  onNavigateImageViewer: (direction: 'prev' | 'next') => void
}

export function CanvasOverlays({
  nodesCount,
  emptyTitle,
  emptySubtitle,
  showNodeMenu,
  previewConnectionVisual,
  menuPosition,
  menuAllowedTypes,
  onSelectNodeType,
  onCloseNodeMenu,
  imageViewerOpen,
  imageViewerCurrentUrl,
  imageViewerList,
  imageViewerIndex,
  onCloseImageViewer,
  onNavigateImageViewer,
}: CanvasOverlaysProps) {
  return (
    <>
      {nodesCount === 0 && <CanvasEmptyHint title={emptyTitle} subtitle={emptySubtitle} />}

      {showNodeMenu && previewConnectionVisual && (
        <svg
          className="pointer-events-none absolute z-40 overflow-visible"
          style={{
            left: previewConnectionVisual.left,
            top: previewConnectionVisual.top,
            width: previewConnectionVisual.width,
            height: previewConnectionVisual.height,
          }}
          width={previewConnectionVisual.width}
          height={previewConnectionVisual.height}
        >
          <path
            className="pointer-events-none"
            d={previewConnectionVisual.d}
            fill="none"
            stroke={previewConnectionVisual.stroke}
            strokeWidth={previewConnectionVisual.strokeWidth}
            strokeLinecap={previewConnectionVisual.strokeLinecap}
          />
        </svg>
      )}

      {showNodeMenu && (
        <NodeSelectionMenu
          position={menuPosition}
          allowedTypes={menuAllowedTypes}
          onSelect={onSelectNodeType}
          onClose={onCloseNodeMenu}
        />
      )}

      <ImageViewerModal
        open={imageViewerOpen}
        imageUrl={imageViewerCurrentUrl}
        imageList={imageViewerList}
        currentIndex={imageViewerIndex}
        onClose={onCloseImageViewer}
        onNavigate={onNavigateImageViewer}
      />
    </>
  )
}
