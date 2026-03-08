import { createPortal } from 'react-dom';
import { CanvasNodeImage } from '@/features/canvas/ui/CanvasNodeImage';
import { resolveImageDisplayUrl } from '@/features/canvas/application/imageData';
import type { IncomingImageItem } from './shared';

interface PickerState {
  frameId: string;
  x: number;
  y: number;
}

interface IncomingImagePickerProps {
  pickerState: PickerState | null;
  pickerMenuRef: { current: HTMLDivElement | null };
  incomingImageItems: IncomingImageItem[];
  incomingImageViewerList: string[];
  onReplaceFromInput: (frameId: string, imageUrl: string) => void;
}

export function IncomingImagePicker({
  pickerState,
  pickerMenuRef,
  incomingImageItems,
  incomingImageViewerList,
  onReplaceFromInput,
}: IncomingImagePickerProps): JSX.Element | null {
  if (!pickerState || typeof document === 'undefined') {
    return null;
  }

  return createPortal(
    <div
      ref={pickerMenuRef}
      className="nowheel fixed z-[140] w-[120px] overflow-hidden rounded-xl border border-[rgba(255,255,255,0.16)] bg-surface-dark shadow-xl"
      style={{ left: `${pickerState.x}px`, top: `${pickerState.y}px` }}
      onMouseDown={(event) => event.stopPropagation()}
      onWheelCapture={(event) => event.stopPropagation()}
    >
      {incomingImageItems.length > 0 ? (
        <div
          className="ui-scrollbar nowheel max-h-[180px] overflow-y-auto"
          onWheelCapture={(event) => event.stopPropagation()}
        >
          {incomingImageItems.map((item) => (
            <button
              key={`${pickerState.frameId}-${item.imageUrl}`}
              type="button"
              className="flex w-full items-center gap-2 border border-transparent bg-bg-dark/70 px-2 py-2 text-left text-sm text-text-dark transition-colors hover:border-[rgba(255,255,255,0.18)]"
              onClick={(event) => {
                event.stopPropagation();
                onReplaceFromInput(pickerState.frameId, item.imageUrl);
              }}
              title={item.label}
            >
              <CanvasNodeImage
                src={item.displayUrl}
                alt={item.label}
                viewerSourceUrl={resolveImageDisplayUrl(item.imageUrl)}
                viewerImageList={incomingImageViewerList}
                className="h-8 w-8 rounded object-cover"
                draggable={false}
              />
              <span className="truncate">{item.label}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="px-2 py-2 text-sm text-text-muted">
          暂无输入图片
        </div>
      )}
    </div>,
    document.body
  );
}
