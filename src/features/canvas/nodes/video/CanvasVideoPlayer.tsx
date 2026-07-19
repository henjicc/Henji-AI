import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { Maximize2, Pause, Play, Volume2, VolumeX } from 'lucide-react';

import { UiIconButton, UiRangeInput } from '@/components/ui';
import { readVideoInfo } from '@/commands/video';

interface CanvasVideoPlayerProps {
  src: string;
  knownDuration?: number | null;
  onOpenViewer: () => void;
  /** poster 点击播放场景：挂载后元数据就绪即自动开播 */
  autoPlayOnMount?: boolean;
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
  autoPlayOnMount = false,
}: CanvasVideoPlayerProps): JSX.Element {
  const playerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(knownDuration ?? 0);
  const [muted, setMuted] = useState(false);
  const [hasAudio, setHasAudio] = useState<boolean | null>(null);
  const [compactControls, setCompactControls] = useState(false);

  useEffect(() => {
    setPlaying(false);
    setCurrentTime(0);
    setDuration(knownDuration ?? 0);
  }, [knownDuration, src]);

  useEffect(() => {
    let cancelled = false;
    setHasAudio(null);
    void readVideoInfo(src).then(
      (info) => {
        if (!cancelled) setHasAudio(info.hasAudio);
      },
      () => {
        if (!cancelled) setHasAudio(null);
      },
    );
    return () => { cancelled = true; };
  }, [src]);

  useEffect(() => {
    const player = playerRef.current;
    if (!player) return undefined;

    const updateControlsDensity = (width: number): void => {
      setCompactControls(width < 220);
    };
    updateControlsDensity(player.getBoundingClientRect().width);

    const observer = new ResizeObserver(([entry]) => {
      if (entry) updateControlsDensity(entry.contentRect.width);
    });
    observer.observe(player);
    return () => observer.disconnect();
  }, []);

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

  const progressPercent = duration > 0
    ? Math.min(100, Math.max(0, (currentTime / duration) * 100))
    : 0;

  return (
    <div
      ref={playerRef}
      className="group/player relative h-full w-full overflow-hidden bg-bg-dark"
    >
      <video
        ref={videoRef}
        src={src}
        className="pointer-events-none h-full w-full select-none object-contain"
        preload="auto"
        playsInline
        draggable={false}
        onLoadedMetadata={(event) => {
          const video = event.currentTarget;
          setDuration(Number.isFinite(video.duration) ? video.duration : (knownDuration ?? 0));
          video.currentTime = 0;
          setCurrentTime(0);
          if (autoPlayOnMount) {
            void video.play().catch(() => setPlaying(false));
          }
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
          <UiIconButton
            aria-label="播放"
            showBorder={false}
            className="nodrag nowheel pointer-events-auto !h-11 !w-11 !rounded-full !border-white/15 !bg-black/50 !text-white shadow-xl shadow-black/25 backdrop-blur-md hover:!bg-black/65"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              togglePlayback();
            }}
          >
            <Play className="ml-0.5 h-5 w-5" />
          </UiIconButton>
        </div>
      )}

      <div
        className={`nodrag nowheel absolute inset-x-0 bottom-0 px-2 pb-1.5 pt-9 transition-opacity duration-150 ${
          playing ? 'opacity-0 group-hover/player:opacity-100' : 'opacity-100'
        }`}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/85 via-black/45 to-transparent" />
        <div className="relative flex flex-col gap-0.5">
          <UiRangeInput
            min={0}
            max={Math.max(duration, 0.01)}
            step={0.01}
            value={Math.min(currentTime, Math.max(duration, 0.01))}
            aria-label="视频进度"
            className="canvas-video-progress h-2.5 min-w-0"
            style={{ '--video-progress': `${progressPercent}%` } as CSSProperties}
            onChange={(event) => seekTo(Number(event.target.value))}
            onClick={(event) => event.stopPropagation()}
          />
          <div className="flex h-6 min-w-0 items-center gap-1">
            <UiIconButton
              className="!h-6 !w-6 shrink-0 !p-0 !text-white/90 hover:!border-white/10 hover:!bg-white/10 hover:!text-white"
              showBorder={false}
              appearance="hover-only"
              aria-label={playing ? '暂停' : '播放'}
              onClick={(event) => {
                event.stopPropagation();
                togglePlayback();
              }}
            >
              {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            </UiIconButton>
            <span className="shrink-0 whitespace-nowrap text-[10px] leading-none tabular-nums text-white/90">
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>
            <span className="min-w-0 flex-1" />
            {!compactControls && hasAudio !== false && (
              <UiIconButton
                className="!h-6 !w-6 shrink-0 !p-0 !text-white/90 hover:!border-white/10 hover:!bg-white/10 hover:!text-white"
                showBorder={false}
                appearance="hover-only"
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
            )}
            <UiIconButton
              className="!h-6 !w-6 shrink-0 !p-0 !text-white/90 hover:!border-white/10 hover:!bg-white/10 hover:!text-white"
              showBorder={false}
              appearance="hover-only"
              aria-label="打开大播放器"
              onClick={(event) => {
                event.stopPropagation();
                videoRef.current?.pause();
                onOpenViewer();
              }}
            >
              <Maximize2 className="h-3.5 w-3.5" strokeWidth={1.75} />
            </UiIconButton>
          </div>
        </div>
      </div>
    </div>
  );
}
