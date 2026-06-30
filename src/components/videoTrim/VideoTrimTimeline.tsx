import { useCallback, useEffect, useRef, useState } from 'react';
import { UI_COLOR_ACCENT_BG_CLASS } from '@/components/ui/styleTokens';

// 拖拽粒度收敛到整秒：一是配合 API 只接受整秒的 ends 字段，二是用户反馈小数秒在交互上没有意义。
const MIN_GAP_SECONDS = 1;

type HandleType = 'start' | 'end' | 'playhead';

interface VideoTrimTimelineProps {
  durationSeconds: number;
  maxClipSeconds: number;
  start: number;
  end: number;
  onChange: (start: number, end: number) => void;
  /** 当前播放位置（秒），用于渲染播放指针；拖拽指针时不取整秒，保留连续定位手感 */
  currentTime: number;
  /** 拖拽播放指针时实时回调新位置，由调用方负责实际 seek 视频 */
  onSeek: (time: number) => void;
}

function formatSeconds(value: number): string {
  return `${Math.round(value)}s`;
}

/**
 * 双滑块时间轴：拖左手柄改 start，拖右手柄改 end，区间长度恒 <= maxClipSeconds。
 * 拖拽数学移植自 ImageEditor/CropOverlay.tsx 的 clientX 增量模式，简化成水平 1 维。
 */
export function VideoTrimTimeline({
  durationSeconds,
  maxClipSeconds,
  start,
  end,
  onChange,
  currentTime,
  onSeek,
}: VideoTrimTimelineProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [handleType, setHandleType] = useState<HandleType | null>(null);
  const startClientXRef = useRef(0);
  const trackWidthRef = useRef(0);
  const startValuesRef = useRef({ start: 0, end: 0, playhead: 0 });

  const handlePointerDown = useCallback((type: HandleType, event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const track = trackRef.current;
    if (!track) return;
    trackWidthRef.current = track.getBoundingClientRect().width;
    startClientXRef.current = event.clientX;
    startValuesRef.current = { start, end, playhead: currentTime };
    setHandleType(type);
  }, [start, end, currentTime]);

  useEffect(() => {
    if (!handleType) return;

    const handleMouseMove = (event: MouseEvent) => {
      const trackWidth = trackWidthRef.current;
      if (trackWidth <= 0 || durationSeconds <= 0) return;
      const dx = event.clientX - startClientXRef.current;
      const deltaSeconds = (dx / trackWidth) * durationSeconds;
      const { start: origStart, end: origEnd, playhead: origPlayhead } = startValuesRef.current;

      // 起止点全程按整秒取值：边界本身也先取整（Math.floor 总时长），避免出现"内部状态是整数
      // 但夹到的上限是小数"这种不一致。
      const durationFloor = Math.floor(durationSeconds);

      if (handleType === 'start') {
        const minStart = Math.max(0, origEnd - maxClipSeconds);
        const maxStart = origEnd - MIN_GAP_SECONDS;
        const rawStart = Math.round(origStart + deltaSeconds);
        const nextStart = Math.min(maxStart, Math.max(minStart, rawStart));
        onChange(nextStart, origEnd);
      } else if (handleType === 'end') {
        const maxEnd = Math.min(durationFloor, origStart + maxClipSeconds);
        const minEnd = origStart + MIN_GAP_SECONDS;
        const rawEnd = Math.round(origEnd + deltaSeconds);
        const nextEnd = Math.max(minEnd, Math.min(maxEnd, rawEnd));
        onChange(origStart, nextEnd);
      } else {
        // 播放指针：连续定位（不取整），限制在当前选中片段 [start, end] 内——
        // 预览本来就只在这个区间内播放，拖出这个范围没有意义。
        const nextPlayhead = Math.min(origEnd, Math.max(origStart, origPlayhead + deltaSeconds));
        onSeek(nextPlayhead);
      }
    };

    const handleMouseUp = () => setHandleType(null);

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [handleType, durationSeconds, maxClipSeconds, onChange, onSeek]);

  const startPct = durationSeconds > 0 ? (start / durationSeconds) * 100 : 0;
  const endPct = durationSeconds > 0 ? (end / durationSeconds) * 100 : 100;
  const playheadPct = durationSeconds > 0
    ? (Math.min(end, Math.max(start, currentTime)) / durationSeconds) * 100
    : 0;

  return (
    <div className="flex flex-col gap-2">
      <div ref={trackRef} className="relative h-10 rounded-md bg-surface-dark">
        <div
          className={`absolute top-0 h-full rounded-md ${UI_COLOR_ACCENT_BG_CLASS} opacity-40`}
          style={{ left: `${startPct}%`, width: `${Math.max(0, endPct - startPct)}%` }}
        />
        <div
          className={`absolute top-0 h-full w-1.5 -translate-x-1/2 cursor-ew-resize rounded-full ${UI_COLOR_ACCENT_BG_CLASS}`}
          style={{ left: `${startPct}%` }}
          onMouseDown={(event) => handlePointerDown('start', event)}
        />
        <div
          className={`absolute top-0 h-full w-1.5 -translate-x-1/2 cursor-ew-resize rounded-full ${UI_COLOR_ACCENT_BG_CLASS}`}
          style={{ left: `${endPct}%` }}
          onMouseDown={(event) => handlePointerDown('end', event)}
        />
        <div
          className="absolute top-0 z-10 h-full w-0.5 -translate-x-1/2 cursor-ew-resize bg-text-dark"
          style={{ left: `${playheadPct}%` }}
          onMouseDown={(event) => handlePointerDown('playhead', event)}
        >
          <div className="absolute -top-1 left-1/2 h-2 w-2 -translate-x-1/2 rounded-full bg-text-dark" />
        </div>
      </div>
      <div className="flex items-center justify-between text-[11px] text-text-muted">
        <span>{formatSeconds(start)}</span>
        <span>{formatSeconds(end - start)} / {formatSeconds(maxClipSeconds)}</span>
        <span>{formatSeconds(end)}</span>
      </div>
    </div>
  );
}
