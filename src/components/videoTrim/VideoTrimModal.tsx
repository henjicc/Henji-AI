import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pause, Play, Volume2, VolumeX } from 'lucide-react';
import { createLogger } from '@/core/logging';
import { UiButton, UiIconButton, UiModal } from '@/components/ui';
import { compressVideoToFit } from '@/commands/video';
import { VideoTrimTimeline } from './VideoTrimTimeline';

const logger = createLogger('components.videoTrim.VideoTrimModal');

export interface VideoTrimRange {
  start: number;
  end: number;
}

interface VideoTrimModalProps {
  open: boolean;
  /** 立即可用的预览地址（object URL 或 henji-media 展示地址），打开窗口时不需要任何落盘/IPC */
  previewUrl: string;
  maxClipSeconds: number;
  /** 模型 videoConstraints.maxSizeMB；提供时确认裁剪会顺带按需压缩一次完整视频 */
  maxSizeMB?: number;
  /** 懒解析出完整视频的本地文件路径，只在需要按需压缩时（maxSizeMB 存在）才调用一次 */
  resolveSource?: () => Promise<string>;
  /** 上次保存过的选区（若有），重新打开同一个视频时用它初始化，而不是总是从头开始 */
  initialRange?: VideoTrimRange | null;
  /** 确认只回传选中的 [start, end]，不在这里跑裁剪；真正的裁剪推迟到生成提交时 */
  onConfirm: (range: VideoTrimRange) => void;
  /** 仅在确认时真的触发了压缩（完整视频体积/尺寸超限）才回调，调用方需要把"完整视频"
   *  引用换成压缩后的路径——这是确认流程里唯一可能产生新文件的分支 */
  onVideoCompressed?: (newPath: string) => void;
  onClose: () => void;
}

/**
 * 视频本地截取窗口：拖拽双滑块预览选定 start/end，确认时保存这两个数字，
 * 并在完整视频体积/尺寸超限时顺带压缩一次（裁剪本身仍然不在这里做）。
 *
 * 裁剪窗口本身只是"预览 + 选区"，不持有完整视频以外的任何文件：原始（完整时长）视频
 * 一直是调用方持有的上传引用，裁剪选区只是附加在它上面的元数据，重新打开窗口可以
 * 在完整时长范围内重新选择，不会被上一次的选区"吃掉"。真正切出选中片段、用于上传，
 * 发生在生成提交那一刻（见 GenerationService.trimFirstVideoIfSelected），藏在任务进度条后面。
 * 压缩则挪到这里做：既然用户已经主动打开了裁剪窗口（说明大概率需要处理这个视频），
 * 压缩结果会被哈希缓存，同一个视频第二次确认不会重新编码。
 *
 * 打开窗口本身不做任何落盘/IPC：时长通过 <video> 自身的 loadedmetadata 读取，
 * 压缩需要的真实文件路径推迟到点"确定"时才通过 resolveSource 懒解析。
 */
export function VideoTrimModal({
  open,
  previewUrl,
  maxClipSeconds,
  maxSizeMB,
  resolveSource,
  initialRange,
  onConfirm,
  onVideoCompressed,
  onClose,
}: VideoTrimModalProps) {
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);
  const [isProbing, setIsProbing] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);

  useEffect(() => {
    if (!open) return;
    setIsProbing(true);
    setError(null);
    setDurationSeconds(0);
  }, [open, previewUrl]);

  const handleLoadedMetadata = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const total = video.duration;
    setDurationSeconds(total);
    // 起止点统一取整秒：Math.floor 总时长再夹到 maxClipSeconds，避免初始值出现小数。
    // 有上次保存过的选区时优先复用它（仍夹到当前总时长内，防御性处理时长探测有偏差的边缘情况）。
    const totalFloor = Math.floor(total);
    const defaultEnd = Math.min(maxClipSeconds, totalFloor);
    const initialStart = initialRange ? Math.max(0, Math.min(initialRange.start, totalFloor - 1)) : 0;
    const initialEnd = initialRange ? Math.max(initialStart + 1, Math.min(initialRange.end, totalFloor)) : defaultEnd;
    setStart(initialStart);
    setEnd(initialEnd);
    setCurrentTime(initialStart);
    setIsProbing(false);
  }, [maxClipSeconds, initialRange]);

  const handleVideoError = useCallback(() => {
    logger.error('[VideoTrimModal] video load failed');
    setError(t('node.mediaRow.videoTrimReadFailed'));
    setIsProbing(false);
  }, [t]);

  // 预览只在 [start, end] 区间内播放，到 end 自动暂停并回到 start——
  // 既符合"预览选中片段"的直觉，也避免解码裁剪范围之外的内容。
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const handleTimeUpdate = () => {
      if (video.currentTime >= end) {
        video.pause();
        video.currentTime = start;
      }
      setCurrentTime(video.currentTime);
    };
    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);
    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);
    return () => {
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
    };
  }, [start, end]);

  // 拖拽手柄/播放指针时把画面实时跳转到对应帧。
  // mousemove 触发频率可能远超 60Hz，用 rAF 合并到每帧最多 seek 一次，避免疯狂 seek 卡顿。
  const pendingSeekRef = useRef<number | null>(null);
  const seekRafIdRef = useRef<number | null>(null);
  const seekVideoTo = useCallback((time: number) => {
    pendingSeekRef.current = time;
    if (seekRafIdRef.current !== null) return;
    seekRafIdRef.current = requestAnimationFrame(() => {
      seekRafIdRef.current = null;
      const video = videoRef.current;
      if (video && pendingSeekRef.current !== null) {
        video.pause();
        video.currentTime = pendingSeekRef.current;
      }
    });
  }, []);
  useEffect(() => () => {
    if (seekRafIdRef.current !== null) cancelAnimationFrame(seekRafIdRef.current);
  }, []);

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (isPlaying) {
      video.pause();
      return;
    }
    if (video.currentTime < start || video.currentTime >= end) {
      video.currentTime = start;
    }
    video.play().catch(() => {});
  };

  const handleConfirm = async () => {
    if (!maxSizeMB || !resolveSource) {
      onConfirm({ start, end });
      onClose();
      return;
    }
    setIsProcessing(true);
    setError(null);
    try {
      const source = await resolveSource();
      const result = await compressVideoToFit(source, maxSizeMB);
      if (result.path !== source) {
        onVideoCompressed?.(result.path);
      }
      onConfirm({ start, end });
      onClose();
    } catch (confirmError) {
      logger.error('[VideoTrimModal] compressVideoToFit failed', confirmError);
      setError(t('node.mediaRow.videoTrimFailed'));
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <UiModal
      isOpen={open}
      title={t('node.mediaRow.videoTrimTitle')}
      onClose={onClose}
      size="editor"
      contentClassName="overflow-y-auto px-4 py-4"
      footer={(
        <>
          <UiButton variant="ghost" onClick={onClose} disabled={isProcessing}>
            {t('common:cancel')}
          </UiButton>
          <UiButton
            variant="primary"
            onClick={() => void handleConfirm()}
            disabled={isProbing || isProcessing || durationSeconds <= 0}
          >
            {isProcessing ? t('node.mediaRow.videoTrimProcessing') : t('common:confirm')}
          </UiButton>
        </>
      )}
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <video
            ref={videoRef}
            src={previewUrl}
            className="max-h-[60vh] w-full rounded-md bg-black object-contain"
            preload="metadata"
            muted={muted}
            playsInline
            onLoadedMetadata={handleLoadedMetadata}
            onError={handleVideoError}
          />
          <div className="flex items-center gap-1">
            <UiIconButton
              onClick={togglePlay}
              className="h-7 w-7 border-0 bg-transparent"
              title={t('ui:audioPlayer.playPause')}
            >
              {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </UiIconButton>
            <UiIconButton
              onClick={() => setMuted((value) => !value)}
              className="h-7 w-7 border-0 bg-transparent"
              title={muted ? t('ui:viewer.unmute') : t('ui:viewer.mute')}
            >
              {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </UiIconButton>
          </div>
        </div>
        {isProbing ? (
          <div className="text-xs text-text-muted">{t('common:loading')}</div>
        ) : durationSeconds > 0 ? (
          <VideoTrimTimeline
            durationSeconds={durationSeconds}
            maxClipSeconds={maxClipSeconds}
            start={start}
            end={end}
            currentTime={currentTime}
            onSeek={(nextTime) => {
              setCurrentTime(nextTime);
              seekVideoTo(nextTime);
            }}
            onChange={(nextStart, nextEnd) => {
              if (nextStart !== start) {
                setStart(nextStart);
                setCurrentTime(nextStart);
                seekVideoTo(nextStart);
              }
              if (nextEnd !== end) {
                setEnd(nextEnd);
                setCurrentTime(nextEnd);
                seekVideoTo(nextEnd);
              }
            }}
          />
        ) : null}
        {error && <div className="text-xs text-red-400">{error}</div>}
      </div>
    </UiModal>
  );
}
