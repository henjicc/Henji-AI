import { useCallback, useEffect, useRef, useState } from 'react';
import { Maximize2, Pause, Play, Volume2, VolumeX } from 'lucide-react';

import { UiIconButton, UiRangeInput } from '@/components/ui';

interface CanvasVideoPlayerProps {
  src: string;
  knownDuration?: number | null;
  onOpenViewer: () => void;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const wholeSeconds = Math.floor(seconds);
  const minutes = Math.floor(wholeSeconds / 60);
  return `${minutes}:${String(wholeSeconds % 60).padStart(2, '0')}`;
}

/** 画布视频节点内嵌播放器：首帧直出，控制条使用项目 Ui primitives。 */
export function CanvasVideoPlayer({
  src,
  knownDuration,
  onOpenViewer,
}: CanvasVideoPlayerProps): JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(knownDuration ?? 0);
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    setPlaying(false);
    setCurrentTime(0);
    setDuration(knownDuration ?? 0);
  }, [knownDuration, src]);

  const togglePlayback = useCallback((): void => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      void video.play().catch(() => setPlaying(false));
    } else {
      video.pause();
    }
  }, []);

  const seekTo = useCallback((nextTime: number): void => {
    const video = videoRef.current;
    if (!video) return;
    const clamped = Math.max(0, Math.min(nextTime, duration || nextTime));
    video.currentTime = clamped;
    setCurrentTime(clamped);
  }, [duration]);

  return (
    <div
      className="nodrag nowheel group/player relative h-full w-full overflow-hidden bg-bg-dark"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <video
        ref={videoRef}
        src={src}
        className="h-full w-full cursor-pointer object-contain"
        preload="auto"
        playsInline
        draggable={false}
        onClick={(event) => {
          event.stopPropagation();
          togglePlayback();
        }}
        onDoubleClick={(event) => {
          event.stopPropagation();
          onOpenViewer();
        }}
        onLoadedMetadata={(event) => {
          const video = event.currentTarget;
          setDuration(Number.isFinite(video.duration) ? video.duration : (knownDuration ?? 0));
          video.currentTime = 0;
          setCurrentTime(0);
        }}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime || 0)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          seekTo(0);
        }}
        onVolumeChange={(event) => {
          setMuted(event.currentTarget.muted);
        }}
      />

      {!playing && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-bg-dark/75 text-text-dark shadow-lg">
            <Play className="ml-0.5 h-5 w-5" />
          </span>
        </div>
      )}

      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-bg-dark via-bg-dark/90 to-transparent px-2 pb-1.5 pt-5">
        <UiRangeInput
          min={0}
          max={Math.max(duration, 0.01)}
          step={0.01}
          value={Math.min(currentTime, Math.max(duration, 0.01))}
          aria-label="视频进度"
          className="w-full"
          onChange={(event) => seekTo(Number(event.target.value))}
          onClick={(event) => event.stopPropagation()}
        />
        <div className="flex min-w-0 items-center gap-1">
          <UiIconButton
            className="h-7 w-7 shrink-0"
            showBorder={false}
            aria-label={playing ? '暂停' : '播放'}
            onClick={(event) => {
              event.stopPropagation();
              togglePlayback();
            }}
          >
            {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          </UiIconButton>
          <span className="min-w-0 flex-1 truncate text-[10px] tabular-nums text-text-muted">
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>
          <UiIconButton
            className="h-7 w-7 shrink-0"
            showBorder={false}
            aria-label={muted ? '取消静音' : '静音'}
            onClick={(event) => {
              event.stopPropagation();
              const video = videoRef.current;
              if (!video) return;
              video.muted = !video.muted;
              setMuted(video.muted);
            }}
          >
            {muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
          </UiIconButton>
          <UiIconButton
            className="h-7 w-7 shrink-0"
            showBorder={false}
            aria-label="打开视频查看器"
            onClick={(event) => {
              event.stopPropagation();
              onOpenViewer();
            }}
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </UiIconButton>
        </div>
      </div>
    </div>
  );
}
