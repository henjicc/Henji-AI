import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { useCanvasNodeUiRef } from '@/features/canvas/presence/canvasNodeUiState';
import { Maximize2, Pause, Play, Volume2, VolumeX } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { UiIconButton, UiRangeInput } from '@/components/ui';
import { readVideoInfo } from '@/commands/video';
import { formatVideoTime } from './formatVideoTime';
import { VideoIdleMarks } from './VideoIdleMarks';

interface CanvasVideoPlayerProps {
  /** 播放位置与静音跨正文卸载保留。 */
  nodeId?: string;
  src: string;
  knownDuration?: number | null;
  knownHasAudio?: boolean;
  onOpenViewer: () => void;
  /** poster 点击播放场景：挂载后元数据就绪即自动开播 */
  autoPlayOnMount?: boolean;
}

/** 画布视频节点内嵌播放器：首帧直出，控制条使用项目 Ui primitives。 */
export function CanvasVideoPlayer({
  nodeId,
  src,
  knownDuration,
  knownHasAudio,
  onOpenViewer,
  autoPlayOnMount = false,
}: CanvasVideoPlayerProps): JSX.Element {
  const { t } = useTranslation();
  const playerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(knownDuration ?? 0);
  const kept = useCanvasNodeUiRef<{ src: string; time: number; muted: boolean } | null>(nodeId, 'videoPlayback', null);
  const [muted, setMuted] = useState(() => kept.current?.src === src && kept.current.muted);
  const [hasAudio, setHasAudio] = useState<boolean | null>(knownHasAudio ?? null);
  const [compactControls, setCompactControls] = useState(false);

  useEffect(() => {
    setPlaying(false);
    setCurrentTime(0);
    setDuration(knownDuration ?? 0);
  }, [knownDuration, src]);

  useEffect(() => {
    if (typeof knownHasAudio === 'boolean') {
      setHasAudio(knownHasAudio);
      return undefined;
    }
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
  }, [knownHasAudio, src]);

  useEffect(() => {
    const player = playerRef.current;
    if (!player) return undefined;

    const updateControlsDensity = (width: number): void => {
      // 屏外暂停布局会产生零宽度；保留上次布局，避免控件增删反过来反复唤醒节点。
      if (width <= 0) return;
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
      className="group/player relative h-full w-full overflow-hidden bg-gap"
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
          // 同一段视频接着上次停下的位置（正文卸载过）
          const resume = kept.current?.src === src ? kept.current : null;
          video.currentTime = resume?.time ?? 0;
          video.muted = resume?.muted ?? video.muted;
          setCurrentTime(resume?.time ?? 0);
          if (autoPlayOnMount) {
            void video.play().catch(() => setPlaying(false));
          }
        }}
        onTimeUpdate={(event) => {
          const time = event.currentTarget.currentTime || 0;
          setCurrentTime(time);
          kept.current = { src, time, muted: event.currentTarget.muted };
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          seekTo(0);
        }}
        onVolumeChange={(event) => {
          setMuted(event.currentTarget.muted);
          kept.current = { src, time: event.currentTarget.currentTime || 0, muted: event.currentTarget.muted };
        }}
      />

      {/* 没在播放时与未载入的视频节点同一套记号：中央播放键 + 右下时长（悬停时时长让给底栏） */}
      {!playing && <VideoIdleMarks durationSec={duration} onPlay={togglePlayback} hideDurationOnHover />}
      {/* 静息只看画面：底栏悬停才出现，控件无底，只靠底部一层压暗保证看得清 */}
      <div
        className="nodrag nowheel absolute inset-x-0 bottom-0 px-2 pb-1.5 pt-9 opacity-0 transition-opacity duration-120 group-hover/player:opacity-100 focus-within:opacity-100"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-media-scrim via-media-scrim to-transparent" />
        <div className="relative flex flex-col gap-0.5">
          <UiRangeInput
            min={0}
            max={Math.max(duration, 0.01)}
            step={0.01}
            value={Math.min(currentTime, Math.max(duration, 0.01))}
            aria-label={t('node.videoPlayer.progress')}
            className="canvas-video-progress min-w-0"
            style={{ '--video-progress': `${progressPercent}%` } as CSSProperties}
            onChange={(event) => seekTo(Number(event.target.value))}
            onClick={(event) => event.stopPropagation()}
          />
          <div className="flex h-6 min-w-0 items-center gap-1">
            <UiIconButton size="xs" tone="mediaBare"
              aria-label={playing ? t('node.videoPlayer.pause') : t('node.videoPlayer.play')}
              onClick={(event) => {
                event.stopPropagation();
                togglePlayback();
              }}
            >
              {playing ? <Pause /> : <Play />}
            </UiIconButton>
            <span className="shrink-0 whitespace-nowrap text-3xs leading-none tabular-nums text-on-media/90">
              {formatVideoTime(currentTime)} / {formatVideoTime(duration)}
            </span>
            <span className="min-w-0 flex-1" />
            {!compactControls && hasAudio !== false && (
              <UiIconButton size="xs" tone="mediaBare"
                aria-label={muted ? t('node.videoPlayer.unmute') : t('node.videoPlayer.mute')}
                onClick={(event) => {
                  event.stopPropagation();
                  const video = videoRef.current;
                  if (!video) return;
                  video.muted = !video.muted;
                  setMuted(video.muted);
                }}
              >
                {muted ? <VolumeX /> : <Volume2 />}
              </UiIconButton>
            )}
            <UiIconButton size="xs" tone="mediaBare"
              aria-label={t('node.videoPlayer.openViewer')}
              onClick={(event) => {
                event.stopPropagation();
                videoRef.current?.pause();
                onOpenViewer();
              }}
            >
              <Maximize2 />
            </UiIconButton>
          </div>
        </div>
      </div>
    </div>
  );
}
