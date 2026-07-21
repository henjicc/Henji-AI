import { useCallback, useEffect, useRef, useState } from 'react';
import type { MarkCropRect } from '../domain/types';
import { clampCropRect } from '../domain/geometry';

type HandleType = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'move';

interface CropOverlayBoxProps {
  /** 舞台显示尺寸(px) */
  displayWidth: number;
  displayHeight: number;
  /** 显示像素 / 图片像素 */
  scale: number;
  /** 图片坐标系裁剪区域 */
  crop: MarkCropRect;
  imageWidth: number;
  imageHeight: number;
  /** 宽高比约束,null 为自由 */
  ratio: number | null;
  onChange: (rect: MarkCropRect) => void;
  onCommit: () => void;
}

const MIN_CROP_IMAGE_PX = 16;

const HANDLE_DEFS: { type: HandleType; className: string; cursor: string }[] = [
  { type: 'nw', className: 'left-0 top-0 -translate-x-1/2 -translate-y-1/2', cursor: 'nwse-resize' },
  { type: 'n', className: 'left-1/2 top-0 -translate-x-1/2 -translate-y-1/2', cursor: 'ns-resize' },
  { type: 'ne', className: 'right-0 top-0 translate-x-1/2 -translate-y-1/2', cursor: 'nesw-resize' },
  { type: 'e', className: 'right-0 top-1/2 translate-x-1/2 -translate-y-1/2', cursor: 'ew-resize' },
  { type: 'se', className: 'right-0 bottom-0 translate-x-1/2 translate-y-1/2', cursor: 'nwse-resize' },
  { type: 's', className: 'left-1/2 bottom-0 -translate-x-1/2 translate-y-1/2', cursor: 'ns-resize' },
  { type: 'sw', className: 'left-0 bottom-0 -translate-x-1/2 translate-y-1/2', cursor: 'nesw-resize' },
  { type: 'w', className: 'left-0 top-1/2 -translate-x-1/2 -translate-y-1/2', cursor: 'ew-resize' },
];

function applyRatio(rect: MarkCropRect, ratio: number, handle: HandleType): MarkCropRect {
  if (handle === 'move') {
    return rect;
  }
  const { x, width } = rect;
  let { y, height } = rect;
  const newHeight = width / ratio;
  if (handle.includes('s')) {
    height = newHeight;
  } else if (handle.includes('n')) {
    const bottom = y + height;
    height = newHeight;
    y = bottom - height;
  } else {
    const centerY = y + height / 2;
    height = newHeight;
    y = centerY - height / 2;
  }
  return { x, y, width, height };
}

/** 裁剪覆盖层:在舞台显示坐标下交互,回传图片坐标;拖拽结束触发 onCommit 供记录历史 */
export function CropOverlayBox({
  displayWidth,
  displayHeight,
  scale,
  crop,
  imageWidth,
  imageHeight,
  ratio,
  onChange,
  onCommit,
}: CropOverlayBoxProps): JSX.Element {
  const [activeHandle, setActiveHandle] = useState<HandleType | null>(null);
  const startPosRef = useRef({ x: 0, y: 0 });
  const startRectRef = useRef<MarkCropRect>(crop);
  const latestPropsRef = useRef({ ratio, scale, imageWidth, imageHeight, onChange, onCommit });
  latestPropsRef.current = { ratio, scale, imageWidth, imageHeight, onChange, onCommit };

  const beginGesture = useCallback((event: React.MouseEvent, type: HandleType) => {
    event.preventDefault();
    event.stopPropagation();
    setActiveHandle(type);
    startPosRef.current = { x: event.clientX, y: event.clientY };
    startRectRef.current = { ...crop };
  }, [crop]);

  useEffect(() => {
    if (!activeHandle) {
      return;
    }

    const handleMouseMove = (event: MouseEvent) => {
      const props = latestPropsRef.current;
      const dx = (event.clientX - startPosRef.current.x) / Math.max(props.scale, 0.0001);
      const dy = (event.clientY - startPosRef.current.y) / Math.max(props.scale, 0.0001);
      const start = startRectRef.current;
      let next: MarkCropRect = { ...start };

      switch (activeHandle) {
        case 'move':
          next.x = start.x + dx;
          next.y = start.y + dy;
          break;
        case 'nw':
          next = { x: start.x + dx, y: start.y + dy, width: start.width - dx, height: start.height - dy };
          break;
        case 'n':
          next = { ...start, y: start.y + dy, height: start.height - dy };
          break;
        case 'ne':
          next = { ...start, y: start.y + dy, width: start.width + dx, height: start.height - dy };
          break;
        case 'e':
          next = { ...start, width: start.width + dx };
          break;
        case 'se':
          next = { ...start, width: start.width + dx, height: start.height + dy };
          break;
        case 's':
          next = { ...start, height: start.height + dy };
          break;
        case 'sw':
          next = { x: start.x + dx, y: start.y, width: start.width - dx, height: start.height + dy };
          break;
        case 'w':
          next = { ...start, x: start.x + dx, width: start.width - dx };
          break;
      }

      if (props.ratio && activeHandle !== 'move') {
        next = applyRatio(next, props.ratio, activeHandle);
      }
      props.onChange(clampCropRect(next, props.imageWidth, props.imageHeight, MIN_CROP_IMAGE_PX));
    };

    const handleMouseUp = () => {
      setActiveHandle(null);
      latestPropsRef.current.onCommit();
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [activeHandle]);

  const left = crop.x * scale;
  const top = crop.y * scale;
  const width = crop.width * scale;
  const height = crop.height * scale;

  return (
    <div className="absolute inset-0 z-10" style={{ width: displayWidth, height: displayHeight }}>
      {/* 四向遮罩 */}
      <div className="absolute left-0 right-0 top-0 bg-black/60" style={{ height: Math.max(0, top) }} />
      <div
        className="absolute left-0 right-0 bottom-0 bg-black/60"
        style={{ height: Math.max(0, displayHeight - top - height) }}
      />
      <div
        className="absolute left-0 bg-black/60"
        style={{ top, height, width: Math.max(0, left) }}
      />
      <div
        className="absolute right-0 bg-black/60"
        style={{ top, height, width: Math.max(0, displayWidth - left - width) }}
      />

      {/* 裁剪框 */}
      <div
        className="absolute border-2 border-white/90"
        style={{ left, top, width, height, cursor: 'move' }}
        onMouseDown={(event) => beginGesture(event, 'move')}
      >
        {/* 三分参考线 */}
        <div className="pointer-events-none absolute left-1/3 top-0 h-full w-px bg-white/30" />
        <div className="pointer-events-none absolute left-2/3 top-0 h-full w-px bg-white/30" />
        <div className="pointer-events-none absolute top-1/3 left-0 w-full h-px bg-white/30" />
        <div className="pointer-events-none absolute top-2/3 left-0 w-full h-px bg-white/30" />

        {HANDLE_DEFS.map((handle) => (
          <div
            key={handle.type}
            className={`absolute h-2.5 w-2.5 rounded-sm border border-black/40 bg-white ${handle.className}`}
            style={{ cursor: handle.cursor }}
            onMouseDown={(event) => beginGesture(event, handle.type)}
          />
        ))}
      </div>
    </div>
  );
}
