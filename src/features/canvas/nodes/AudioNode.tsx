import { memo, useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { AudioLines, Maximize2, Pause, Play, Upload, Volume2, VolumeX } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  CANVAS_NODE_TYPES,
  type AudioMediaNodeData,
  type CanvasNodeType,
} from '@/features/canvas/domain/canvasNodes';
import { resolveImageDisplayUrl } from '@/features/canvas/application/imageData';
import { canvasEventBus } from '@/features/canvas/application/canvasServices';
import { getMainPortConnectionFlags } from '@/features/canvas/domain/connectionIndex';
import { isNodeUsingDefaultDisplayName, resolveNodeDisplayName } from '@/features/canvas/domain/nodeDisplay';
import { NodeHeader, NODE_HEADER_FLOATING_POSITION_CLASS } from '@/features/canvas/ui/NodeHeader';
import {
  NODE_GENERATION_ERROR_BORDER_CLASS,
  NODE_IDLE_BORDER_CLASS,
  NODE_PORT_NODE_CLASS,
  NODE_PORT_VISIBLE_CLASS,
  NODE_SELECTED_BORDER_CLASS,
} from '@/features/canvas/ui/nodeControlStyles';
import { getSocketColor } from '@/features/canvas/domain/socketTypes';
import { useGenerationProgressDisplay } from '@/features/canvas/nodes/shared/useGenerationProgressDisplay';
import { NodeGenerationError } from '@/features/canvas/nodes/shared/NodeGenerationError';
import { formatDuration, getAudioDuration } from '@/utils/mediaDimensions';
import { useAudioWaveform } from '@/hooks/useAudioWaveform';
import { saveUploadAudio } from '@/utils/save';
import { useCanvasStore } from '@/stores/canvasStore';
import { UiIconButton, UiInput } from '@/components/ui';
import { AudioViewerModal } from '@/components/mediaViewer/AudioViewerModal';
import Waveform from '@/components/Waveform';
import { uiTransition } from '@/components/ui/motion';

type AudioNodeProps = NodeProps & {
  id: string;
  data: AudioMediaNodeData;
  selected?: boolean;
};

const AUDIO_NODE_WIDTH = 280;
const AUDIO_NODE_HEIGHT = 96;
const AUDIO_WAVEFORM_WIDTH = AUDIO_NODE_WIDTH - 24;
const AUDIO_WAVEFORM_HEIGHT = 44;

/** 音频节点：服务于结果音频与上传音频，卡片式展示 + 懒挂载播放 */
export const AudioNode = memo(({ id, data, selected, type }: AudioNodeProps) => {
  const { t } = useTranslation();
  const setSelectedNode = useCanvasStore((state) => state.setSelectedNode);
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const hasTargetConnections = useCanvasStore(
    (state) => getMainPortConnectionFlags(state.edges).get(id)?.hasMainTarget ?? false
  );
  const hasSourceConnections = useCanvasStore(
    (state) => getMainPortConnectionFlags(state.edges).get(id)?.hasMainSource ?? false
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [mediaDuration, setMediaDuration] = useState(0);
  const [muted, setMuted] = useState(false);
  const [isViewerOpen, setIsViewerOpen] = useState(false);

  const isUploadVariant = type === CANVAS_NODE_TYPES.audioUpload;
  const { isGenerating, progress, transitionDurationMs } = useGenerationProgressDisplay(id, data);
  const generationError = typeof data.generationError === 'string' ? data.generationError : null;

  const resolvedTitle = useMemo(() => {
    const nodeType = type as CanvasNodeType;
    const sourceFileName = typeof data.sourceFileName === 'string' ? data.sourceFileName.trim() : '';
    if (isUploadVariant && sourceFileName && isNodeUsingDefaultDisplayName(nodeType, data)) {
      return sourceFileName;
    }
    return resolveNodeDisplayName(nodeType, data);
  }, [data, isUploadVariant, type]);
  const audioSource = useMemo(
    () => (data.audioUrl ? resolveImageDisplayUrl(data.audioUrl) : null),
    [data.audioUrl]
  );
  const { waveform, waveDuration } = useAudioWaveform(audioSource ?? '', undefined, {
    width: AUDIO_WAVEFORM_WIDTH,
    compact: true,
    duration: data.durationSec ?? undefined,
  });
  const effectiveDuration = mediaDuration || waveDuration || data.durationSec || 0;
  const waveformProgress = effectiveDuration > 0 ? currentTime / effectiveDuration : 0;
  const durationLabel = useMemo(
    () => (typeof data.durationSec === 'number' && data.durationSec > 0
      ? formatDuration(data.durationSec)
      : null),
    [data.durationSec]
  );

  useEffect(() => () => {
    audioRef.current?.pause();
    audioRef.current = null;
  }, []);

  // 音频源变化后复位播放状态
  useEffect(() => {
    audioRef.current?.pause();
    audioRef.current = null;
    setIsPlaying(false);
    setCurrentTime(0);
    setMediaDuration(0);
    setMuted(false);
  }, [audioSource]);

  const ensureAudioElement = useCallback((): HTMLAudioElement | null => {
    if (!audioSource) {
      return null;
    }
    if (!audioRef.current) {
      const element = new Audio(audioSource);
      element.preload = 'metadata';
      element.muted = muted;
      element.addEventListener('loadedmetadata', () => setMediaDuration(element.duration || 0));
      element.addEventListener('ended', () => setIsPlaying(false));
      audioRef.current = element;
    }
    return audioRef.current;
  }, [audioSource, muted]);

  // 播放中用 rAF 驱动进度，避免原生 timeupdate 事件频率过低（~4Hz）导致波形进度跳动
  useEffect(() => {
    if (!isPlaying) {
      return;
    }
    let rafId = 0;
    const tick = () => {
      const element = audioRef.current;
      if (element) {
        setCurrentTime(element.currentTime);
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [isPlaying]);

  const togglePlay = useCallback(() => {
    const element = ensureAudioElement();
    if (!element) {
      return;
    }
    if (isPlaying) {
      element.pause();
      setIsPlaying(false);
      return;
    }
    void element.play();
    setIsPlaying(true);
  }, [ensureAudioElement, isPlaying]);

  const seekToRatio = useCallback((ratio: number) => {
    const element = ensureAudioElement();
    const total = element?.duration || effectiveDuration;
    if (!element || !total) {
      return;
    }
    element.currentTime = ratio * total;
    setCurrentTime(element.currentTime);
  }, [ensureAudioElement, effectiveDuration]);

  const handleWaveformSeekEnd = useCallback((ratio: number, dragged: boolean) => {
    seekToRatio(ratio);
    if (dragged && audioRef.current) {
      void audioRef.current.play();
      setIsPlaying(true);
    }
  }, [seekToRatio]);

  const processFile = useCallback(async (file: File) => {
    const saved = await saveUploadAudio(file, 'persist');
    const durationSec = await getAudioDuration(resolveImageDisplayUrl(saved.fullPath)).catch(() => null);
    updateNodeData(id, {
      audioUrl: saved.fullPath,
      durationSec,
      sourceFileName: file.name,
    });
  }, [id, updateNodeData]);

  const handleFileChange = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !file.type.startsWith('audio/')) {
      return;
    }
    await processFile(file);
    event.target.value = '';
  }, [processFile]);

  const handleDrop = useCallback(async (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    if (!file || !file.type.startsWith('audio/')) {
      return;
    }
    await processFile(file);
  }, [processFile]);

  const handleNodeClick = useCallback(() => {
    setSelectedNode(id);
    if (isUploadVariant && !data.audioUrl) {
      inputRef.current?.click();
    }
  }, [data.audioUrl, id, isUploadVariant, setSelectedNode]);

  useEffect(() => {
    return canvasEventBus.subscribe('canvas/paste-media', ({ nodeId, file }) => {
      if (nodeId !== id || !file.type.startsWith('audio/')) {
        return;
      }
      void processFile(file);
    });
  }, [id, processFile]);

  return (
    <div
      className={`
        group relative overflow-visible rounded-[var(--node-radius)] border bg-surface-dark/85 transition-colors duration-150
        ${generationError
          ? NODE_GENERATION_ERROR_BORDER_CLASS
          : selected
            ? NODE_SELECTED_BORDER_CLASS
            : NODE_IDLE_BORDER_CLASS}
      `}
      style={{ width: AUDIO_NODE_WIDTH, height: AUDIO_NODE_HEIGHT }}
      onClick={handleNodeClick}
      onDoubleClick={(event) => {
        if (!data.audioUrl) {
          return;
        }
        event.stopPropagation();
        audioRef.current?.pause();
        setIsPlaying(false);
        setIsViewerOpen(true);
      }}
      onDrop={isUploadVariant ? handleDrop : undefined}
      onDragOver={isUploadVariant ? (event) => event.preventDefault() : undefined}
    >
      <NodeHeader
        className={NODE_HEADER_FLOATING_POSITION_CLASS}
        icon={isUploadVariant ? <Upload className="h-4 w-4" /> : <AudioLines className="h-4 w-4" />}
        titleText={resolvedTitle}
        editable
        onTitleChange={(nextTitle) => updateNodeData(id, { displayName: nextTitle })}
      />

      <div className="relative flex h-full w-full overflow-hidden rounded-[var(--node-radius)] bg-bg-dark px-3 py-2">
        {generationError ? null : data.audioUrl ? (
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="nodrag nowheel" style={{ height: AUDIO_WAVEFORM_HEIGHT }}>
              {waveform ? (
                <Waveform
                  samples={waveform}
                  width={AUDIO_WAVEFORM_WIDTH}
                  height={AUDIO_WAVEFORM_HEIGHT}
                  progress={waveformProgress}
                  duration={effectiveDuration}
                  onSeekStart={seekToRatio}
                  onSeekMove={seekToRatio}
                  onSeekEnd={handleWaveformSeekEnd}
                />
              ) : (
                <div className="h-full w-full rounded bg-layer/50" />
              )}
            </div>
            <div className="flex h-7 min-w-0 items-center gap-1">
              <UiIconButton
                aria-label={isPlaying ? t('node.audioNode.pause') : t('node.audioNode.play')}
                showBorder={false}
                appearance="hover-only"
                onClick={(event) => {
                  event.stopPropagation();
                  togglePlay();
                }}
                className="nodrag !h-7 !w-7 shrink-0 !p-0 text-text-dark"
              >
                {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="ml-0.5 h-4 w-4" />}
              </UiIconButton>
              <span className="shrink-0 text-3xs leading-none tabular-nums text-text-muted/85">
                {formatDuration(currentTime)} / {durationLabel ?? formatDuration(effectiveDuration)}
              </span>
              <span className="min-w-0 flex-1" />
              <UiIconButton
                aria-label={muted ? t('ui:viewer.unmute') : t('ui:viewer.mute')}
                showBorder={false}
                appearance="hover-only"
                onClick={(event) => {
                  event.stopPropagation();
                  const element = ensureAudioElement();
                  if (!element) return;
                  element.muted = !element.muted;
                  setMuted(element.muted);
                }}
                className="nodrag !h-7 !w-7 shrink-0 !p-0 text-text-dark"
              >
                {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
              </UiIconButton>
              <UiIconButton
                aria-label={t('node.audioNode.openViewer')}
                showBorder={false}
                appearance="hover-only"
                onClick={(event) => {
                  event.stopPropagation();
                  audioRef.current?.pause();
                  setIsPlaying(false);
                  setIsViewerOpen(true);
                }}
                className="nodrag !h-7 !w-7 shrink-0 !p-0 text-text-dark"
              >
                <Maximize2 className="h-3.5 w-3.5" strokeWidth={1.75} />
              </UiIconButton>
            </div>
          </div>
        ) : isUploadVariant ? (
          <div className="flex h-full w-full cursor-pointer flex-col items-center justify-center gap-1.5 text-text-muted/85">
            <Upload className="h-6 w-6 opacity-60" />
            <span className="text-2xs">{t('node.audioNode.uploadHint')}</span>
          </div>
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 text-text-muted/85">
            <AudioLines className="h-6 w-6 opacity-60" />
            <span className="text-2xs">{t('node.audioNode.waitingResult')}</span>
          </div>
        )}

        {isGenerating && (
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="absolute inset-0 bg-bg-dark/55" />
            <div
              className="absolute left-0 top-0 h-full w-full origin-left bg-gradient-to-r from-veil-bright to-veil-faint ease-out"
              style={{ transform: `scaleX(${progress})`, transition: uiTransition(['transform'], transitionDurationMs) }}
            />
          </div>
        )}

        {generationError && <NodeGenerationError message={generationError} />}
      </div>

      {isUploadVariant && (
        <UiInput
          ref={inputRef}
          type="file"
          accept="audio/*"
          className="hidden"
          onChange={handleFileChange}
        />
      )}

      {isViewerOpen && audioSource && (
        <AudioViewerModal
          open={isViewerOpen}
          audioUrl={audioSource}
          onClose={() => setIsViewerOpen(false)}
        />
      )}

      {!isUploadVariant && (
        <Handle
          type="target"
          id="target"
          position={Position.Left}
          className={`${NODE_PORT_NODE_CLASS} ${hasTargetConnections ? NODE_PORT_VISIBLE_CLASS : ''}`}
          style={{ background: getSocketColor('AUDIO'), left: 0, top: '50%', transform: 'translate(-50%, -50%)' }}
        />
      )}
      <Handle
        type="source"
        id="source"
        position={Position.Right}
        className={`${NODE_PORT_NODE_CLASS} ${hasSourceConnections ? NODE_PORT_VISIBLE_CLASS : ''}`}
        style={{ background: getSocketColor('AUDIO'), right: 0, top: '50%', transform: 'translate(50%, -50%)' }}
      />
    </div>
  );
});

AudioNode.displayName = 'AudioNode';
