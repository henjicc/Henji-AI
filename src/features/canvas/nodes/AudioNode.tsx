import { memo, useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { AudioLines, Pause, Play, Upload } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  CANVAS_NODE_TYPES,
  type AudioMediaNodeData,
  type CanvasNodeType,
} from '@/features/canvas/domain/canvasNodes';
import { resolveImageDisplayUrl } from '@/features/canvas/application/imageData';
import { resolveNodeDisplayName } from '@/features/canvas/domain/nodeDisplay';
import { NodeHeader, NODE_HEADER_FLOATING_POSITION_CLASS } from '@/features/canvas/ui/NodeHeader';
import {
  NODE_PORT_NODE_CLASS,
  NODE_PORT_VISIBLE_CLASS,
} from '@/features/canvas/ui/nodeControlStyles';
import { getSocketColor } from '@/features/canvas/domain/socketTypes';
import { useGenerationProgressDisplay } from '@/features/canvas/nodes/shared/useGenerationProgressDisplay';
import { formatDuration, getAudioDuration } from '@/utils/mediaDimensions';
import { saveUploadAudio } from '@/utils/save';
import { useCanvasStore } from '@/stores/canvasStore';
import { UiIconButton, UiInput } from '@/components/ui';
import { AudioViewerModal } from '@/components/mediaViewer/AudioViewerModal';

type AudioNodeProps = NodeProps & {
  id: string;
  data: AudioMediaNodeData;
  selected?: boolean;
};

const AUDIO_NODE_WIDTH = 280;
const AUDIO_NODE_HEIGHT = 88;

/** 音频节点：服务于结果音频与上传音频，卡片式展示 + 懒挂载播放 */
export const AudioNode = memo(({ id, data, selected, type }: AudioNodeProps) => {
  const { t } = useTranslation();
  const setSelectedNode = useCanvasStore((state) => state.setSelectedNode);
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const hasTargetConnections = useCanvasStore(
    (state) => state.edges.some((edge) => edge.target === id && (edge.targetHandle ?? 'target') === 'target')
  );
  const hasSourceConnections = useCanvasStore(
    (state) => state.edges.some((edge) => edge.source === id && (edge.sourceHandle ?? 'source') === 'source')
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isViewerOpen, setIsViewerOpen] = useState(false);

  const isUploadVariant = type === CANVAS_NODE_TYPES.audioUpload;
  const { isGenerating, progress, transitionDurationMs } = useGenerationProgressDisplay(id, data);

  const resolvedTitle = useMemo(
    () => resolveNodeDisplayName(type as CanvasNodeType, data),
    [data, type]
  );
  const audioSource = useMemo(
    () => (data.audioUrl ? resolveImageDisplayUrl(data.audioUrl) : null),
    [data.audioUrl]
  );
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
  }, [audioSource]);

  const togglePlay = useCallback(() => {
    if (!audioSource) {
      return;
    }
    if (isPlaying) {
      audioRef.current?.pause();
      setIsPlaying(false);
      return;
    }
    if (!audioRef.current) {
      const element = new Audio(audioSource);
      element.onended = () => setIsPlaying(false);
      audioRef.current = element;
    }
    void audioRef.current.play();
    setIsPlaying(true);
  }, [audioSource, isPlaying]);

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

  return (
    <div
      className={`
        group relative overflow-visible rounded-[var(--node-radius)] border bg-surface-dark/85 transition-colors duration-150
        ${selected
          ? 'border-accent shadow-[0_0_0_1px_rgba(59,130,246,0.32)]'
          : 'border-[rgba(255,255,255,0.22)] hover:border-[rgba(255,255,255,0.34)]'}
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

      <div className="relative flex h-full w-full items-center gap-3 overflow-hidden rounded-[var(--node-radius)] bg-bg-dark px-3">
        {data.audioUrl ? (
          <>
            <UiIconButton
              aria-label={isPlaying ? t('node.audioNode.pause') : t('node.audioNode.play')}
              onClick={(event) => {
                event.stopPropagation();
                togglePlay();
              }}
              className="h-10 w-10 shrink-0 rounded-full"
            >
              {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="ml-0.5 h-4 w-4" />}
            </UiIconButton>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-text-muted">
                <AudioLines className={`h-4 w-4 ${isPlaying ? 'text-accent' : ''}`} />
                <span className="truncate text-xs">
                  {data.sourceFileName || resolvedTitle}
                </span>
              </div>
              {durationLabel && (
                <div className="mt-1 text-[10px] leading-none text-text-muted/80">{durationLabel}</div>
              )}
            </div>
          </>
        ) : isUploadVariant ? (
          <div className="flex h-full w-full cursor-pointer flex-col items-center justify-center gap-1.5 text-text-muted/85">
            <Upload className="h-6 w-6 opacity-60" />
            <span className="text-[11px]">{t('node.audioNode.uploadHint')}</span>
          </div>
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 text-text-muted/85">
            <AudioLines className="h-6 w-6 opacity-60" />
            <span className="text-[11px]">{t('node.audioNode.waitingResult')}</span>
          </div>
        )}

        {isGenerating && (
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="absolute inset-0 bg-bg-dark/55" />
            <div
              className="absolute left-0 top-0 h-full w-full origin-left bg-gradient-to-r from-[rgba(255,255,255,0.4)] to-[rgba(255,255,255,0.06)] ease-out"
              style={{ transform: `scaleX(${progress})`, transition: `transform ${transitionDurationMs}ms ease-out` }}
            />
          </div>
        )}
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
