import { UI_ICON_SIZE_CLASS } from '@/components/ui/styleTokens'
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MutableRefObject } from 'react';
import { Handle, Position, useReactFlow } from '@xyflow/react';
import { useTranslation } from 'react-i18next';
import { useStoreWithEqualityFn } from 'zustand/traditional';
import { Image as ImageIcon, Music, Plus, Scissors, Video, X } from 'lucide-react';

import { resolveImageDisplayUrl } from '@/features/canvas/application/imageData';
import {
  areMediaOutputListsEqual,
  collectInputMediaByKind,
} from '@/features/canvas/application/graphMediaResolver';
import { getSocketColor, mediaPortId, type RowMediaKind } from '@/features/canvas/domain/socketTypes';
import {
  NODE_ROW_CLASS,
  NODE_ROW_CONTROL_SLOT_CLASS,
  NODE_ROW_LABEL_CLASS,
  NODE_PORT_BASE_CLASS,
  NODE_PORT_ROW_CLASS,
  NODE_PORT_VISIBLE_CLASS,
} from '@/features/canvas/ui/nodeControlStyles';
import { importLocalMedia, inferLocalMediaKind } from '@/services/localMediaImport';
import { UiIconButton, UiInput } from '@/components/ui';
import { canvasViewStore, useCanvasStore } from '@/stores/canvasStore';
import { getIncomingEdges } from '@/features/canvas/domain/connectionIndex';
import { CanvasNodeImage } from '@/features/canvas/ui/CanvasNodeImage';
import { isLocalVideoSource, useVideoInputThumbnail } from './useVideoInputThumbnail';
import { VideoViewerModal } from '@/components/mediaViewer/VideoViewerModal';
import { VideoTrimModal, type VideoTrimRange } from '@/components/videoTrim/VideoTrimModal';
import { useReorderDrag } from '@/components/ui/fileUploader/useReorderDrag';
import { readAssetDragPayload } from '@/features/assets/drag/assetDragPayload';
import { UI_DURATION, uiTransition } from '@/components/ui/motion';
import { Z_LAYERS } from '@/core/theme/zLayers';
import type { NodeMediaOutput as MediaOutput } from '@/features/canvas/domain/nodePorts';
import {
  formatAcceptedMediaTypes,
  isMediaFileAccepted,
  type GenerationMediaInputConstraint,
} from '@/features/canvas/application/generationMediaInputConstraints';

/** 一行里的一类素材：各类素材的数量上限、格式、本地值与连线状态互相独立 */
export interface MediaInputSource {
  kind: RowMediaKind;
  maxCount: number;
  inlineValue: string[];
  onInlineChange: (next: string[]) => void;
  acceptedFileTypes?: readonly string[];
  maxFileSizeBytes?: number;
  /** 视频裁剪能力：来自模型 inputLimits.videoConstraints.trim，仅视频有意义 */
  videoTrimMaxClipSeconds?: number;
  /** 视频体积上限（MB），存在时裁剪确认会顺带按需压缩一次完整视频 */
  videoTrimMaxSizeMB?: number;
  /** 已保存的裁剪选区（若有），重新打开裁剪窗口时用它初始化，而不是每次都从头选 */
  videoTrimRange?: VideoTrimRange | null;
  /** 确认裁剪只回传选区，不替换 inlineValue 里的视频引用——完整视频始终保留 */
  onVideoTrimRangeChange?: (range: VideoTrimRange) => void;
}

interface MediaInputsRowProps {
  nodeId: string;
  label: string;
  sources: MediaInputSource[];
  /** 一次上传多类素材时合并成一次提交；省略时逐类调用各自的 onInlineChange */
  onSourcesChange?: (changes: Partial<Record<RowMediaKind, string[]>>) => void;
  /** 需要在本行承载端口的素材类型；宿主已在节点外缘提供端口的类型不在其中。 */
  handleKinds: RowMediaKind[];
}

type MediaInputRowProps = Omit<MediaInputSource, 'kind'> & {
  /** 宿主已在节点外缘提供同一端口时隐藏行内端口。 */
  showHandle?: boolean;
  nodeId: string;
  mediaKind: RowMediaKind;
  label: string;
};

const MEDIA_ACCEPT: Record<RowMediaKind, string> = {
  image: 'image/*',
  video: 'video/*',
  audio: 'audio/*',
};

const MEDIA_ICON: Record<RowMediaKind, typeof ImageIcon> = {
  image: ImageIcon,
  video: Video,
  audio: Music,
};

interface UploadedMediaUrl {
  url: string;
  previewUrl?: string;
}

async function fileToMediaUrl(file: File, kind: RowMediaKind): Promise<UploadedMediaUrl> {
  const imported = await importLocalMedia(file, kind);
  return imported.kind === 'image'
    ? { url: imported.fullPath, previewUrl: imported.previewPath }
    : { url: imported.fullPath };
}

function moveArrayItem<T>(list: T[], fromIndex: number, toIndex: number): T[] {
  const next = [...list];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

function toInputConstraint(source: MediaInputSource): GenerationMediaInputConstraint | undefined {
  return source.acceptedFileTypes?.length || source.maxFileSizeBytes !== undefined
    ? { accept: source.acceptedFileTypes ?? [], maxSizeBytes: source.maxFileSizeBytes }
    : undefined;
}

function sourceAcceptList(source: MediaInputSource): string[] {
  return source.acceptedFileTypes?.length ? [...source.acceptedFileTypes] : [MEDIA_ACCEPT[source.kind]];
}

function areFlagListsEqual(left: boolean[], right: boolean[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function areMediaListGroupsEqual(left: MediaOutput[][], right: MediaOutput[][]): boolean {
  return left.length === right.length && left.every((list, index) => areMediaOutputListsEqual(list, right[index]));
}

/** 素材小块上的操作：悬停或键盘聚焦到这一块时显现 */
const CHIP_ACTION_REVEAL_CLASS = 'opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100'

/** 单类素材的行：与多类素材行同一实现，供只收一种素材的节点使用 */
export function MediaInputRow({ showHandle = true, nodeId, mediaKind, label, ...source }: MediaInputRowProps) {
  const sources = [{ ...source, kind: mediaKind }];
  return <MediaInputsRow nodeId={nodeId} label={label} sources={sources} handleKinds={showHandle ? [mediaKind] : []} />;
}

/**
 * 参考素材行：图片、视频、音频共用一个端口和一个上传入口，进来后仍按类型各自存放、各自编号。
 * 连线时由连线规划按上游素材类型落到对应类型的端口，所以各类型端口叠放在同一位置、只露出一个。
 * 某类素材已连上游 → 这一类只读展示上游素材；其余类型仍可本地上传。
 */
export function MediaInputsRow({ nodeId, label, sources, onSourcesChange, handleKinds }: MediaInputsRowProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [constraintError, setConstraintError] = useState<string | null>(null);
  // 拖拽排序时小块跟手移出槽位，槽位暂时不裁切
  const [draggingKind, setDraggingKind] = useState<RowMediaKind | null>(null);
  // 本地上传的图片在导入服务中已经生成过 previewPath，
  // 这里缓存下来供缩略图复用，避免 28px 小图也去解码原图。仅运行时内存缓存，不参与持久化。
  const localPreviewMapRef = useRef(new Map<string, string>());
  const kindKey = sources.map((source) => source.kind).join('|');

  const upstreamByKind = useStoreWithEqualityFn(
    canvasViewStore,
    (state) => kindKey.split('|').filter(Boolean).map((kind) => collectInputMediaByKind(nodeId, state.nodes, state.edges, kind as RowMediaKind)),
    areMediaListGroupsEqual,
  );
  const portConnectedByKind = useStoreWithEqualityFn(
    useCanvasStore,
    (state) => kindKey.split('|').filter(Boolean).map((kind) => {
      const handleId = mediaPortId(kind as RowMediaKind);
      return getIncomingEdges(state.edges, nodeId).some((edge) => edge.targetHandle === handleId);
    }),
    areFlagListsEqual,
  );
  const states = sources.map((source, index) => {
    const upstream = upstreamByKind[index] ?? [];
    const isConnected = Boolean(portConnectedByKind[index]) || upstream.length > 0;
    const count = isConnected ? upstream.length : source.inlineValue.length;
    return { source, upstream, isConnected, canAddMore: !isConnected && count < source.maxCount };
  });
  const uploadable = states.filter((state) => state.canAddMore);
  const anyConnected = states.some((state) => state.isConnected);

  const handleFiles = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) {
      return;
    }
    const remaining = new Map(uploadable.map((state) => [state.source.kind, state.source.maxCount - state.source.inlineValue.length]));
    const picked: Array<{ file: File; source: MediaInputSource }> = [];
    let error: string | null = null;
    for (const file of Array.from(files)) {
      const kind = inferLocalMediaKind(file);
      const target = uploadable.find((state) => state.source.kind === kind)?.source;
      const constraint = target ? toInputConstraint(target) : undefined;
      if (!target) {
        // 这类素材已连上游或已满，不算格式错误
        if (sources.some((source) => source.kind === kind)) continue;
        error ??= t('node.mediaRow.unsupportedFormat', { formats: formatAcceptedMediaTypes(uploadable.flatMap((state) => sourceAcceptList(state.source))) });
        continue;
      }
      if ((remaining.get(target.kind) ?? 0) <= 0) continue;
      if (!isMediaFileAccepted(constraint, { fileName: file.name, mimeType: file.type, sizeBytes: file.size })) {
        error ??= constraint?.maxSizeBytes !== undefined && file.size > constraint.maxSizeBytes
          ? t('node.mediaRow.maxSizeExceeded', { max: Math.max(0.1, constraint.maxSizeBytes / 1024 / 1024).toFixed(1) })
          : t('node.mediaRow.unsupportedFormat', { formats: formatAcceptedMediaTypes(constraint?.accept ?? []) });
        continue;
      }
      remaining.set(target.kind, (remaining.get(target.kind) ?? 0) - 1);
      picked.push({ file, source: target });
    }
    setConstraintError(error);
    const uploaded = await Promise.all(picked.map(async ({ file, source }) => ({ source, item: await fileToMediaUrl(file, source.kind) })));
    for (const { item } of uploaded) {
      if (item.previewUrl) {
        localPreviewMapRef.current.set(item.url, item.previewUrl);
      }
    }
    const changes: Partial<Record<RowMediaKind, string[]>> = {};
    for (const source of new Set(uploaded.map(({ source }) => source))) {
      const urls = uploaded.filter((entry) => entry.source === source).map(({ item }) => item.url);
      changes[source.kind] = [...source.inlineValue, ...urls];
    }
    const changedSources = uploadable.filter((state) => changes[state.source.kind]).map((state) => state.source);
    if (changedSources.length === 0) return;
    if (onSourcesChange) onSourcesChange(changes);
    else changedSources.forEach((source) => source.onInlineChange(changes[source.kind]!));
  }, [onSourcesChange, sources, t, uploadable]);

  const dropTargetFor = (dataTransfer: DataTransfer) => {
    const payload = readAssetDragPayload(dataTransfer);
    const target = payload ? uploadable.find((state) => state.source.kind === payload.type)?.source : undefined;
    return payload && target ? { payload, target } : null;
  };

  const visibleHandleKind = handleKinds[0];
  const UploadIcon = uploadable.length === 1 && sources.length === 1 ? MEDIA_ICON[sources[0].kind] : Plus;
  const accept = [...new Set(uploadable.flatMap((state) => sourceAcceptList(state.source)))].join(',');

  return (
    <div
      className={NODE_ROW_CLASS}
      style={draggingKind ? { zIndex: Z_LAYERS.drag } : undefined}
      onDragOver={(event) => {
        if (dropTargetFor(event.dataTransfer)) {
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = 'copy';
        }
      }}
      onDrop={(event) => {
        const drop = dropTargetFor(event.dataTransfer);
        if (!drop) return;
        event.preventDefault();
        event.stopPropagation();
        const constraint = toInputConstraint(drop.target);
        if (!isMediaFileAccepted(constraint, { fileName: drop.payload.filePath })) {
          setConstraintError(t('node.mediaRow.unsupportedFormat', { formats: formatAcceptedMediaTypes(constraint?.accept ?? []) }));
          return;
        }
        setConstraintError(null);
        drop.target.onInlineChange([...drop.target.inlineValue, drop.payload.filePath]);
      }}
    >
      {handleKinds.map((kind) => (
        <Handle
          key={kind}
          type="target"
          id={mediaPortId(kind)}
          position={Position.Left}
          style={{
            background: getSocketColor(handleKinds.length === 1 ? kind.toUpperCase() : 'OBJECT'),
            left: 0,
            top: '50%',
            transform: 'translate(-50%, -50%)',
            // 其余类型的端口叠在同一处，只为已有连线提供落点，不显现也不接收指针
            ...(kind === visibleHandleKind ? {} : { pointerEvents: 'none' as const }),
          }}
          className={kind === visibleHandleKind ? `${NODE_PORT_ROW_CLASS} ${anyConnected ? NODE_PORT_VISIBLE_CLASS : ''}` : NODE_PORT_BASE_CLASS}
        />
      ))}
      <span className={NODE_ROW_LABEL_CLASS}>{label}</span>
      <div className={`nodrag nowheel gap-1.5 ${NODE_ROW_CONTROL_SLOT_CLASS} ${draggingKind ? 'overflow-visible' : 'overflow-x-auto'}`}>
        {states.map(({ source, upstream, isConnected }) => (
          <MediaKindItems
            key={source.kind}
            source={source}
            upstream={upstream}
            isConnected={isConnected}
            localPreviewMapRef={localPreviewMapRef}
            onDraggingChange={(dragging) => setDraggingKind((current) => dragging ? source.kind : current === source.kind ? null : current)}
          />
        ))}
        {uploadable.length > 0 && (
          // ui-surface-allow 添加媒体的虚线占位格（拖放目标），与上传组件同一表面语言，不是按钮档位
          <UiIconButton
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              inputRef.current?.click();
            }}
            disabledReason={constraintError ?? undefined} tooltip={constraintError ?? t('node.mediaRow.upload')}
            className="border border-dashed border-line hover:border-accent hover:text-accent-text"
          >
            <UploadIcon />
          </UiIconButton>
        )}
      </div>
      <UiInput
        ref={inputRef}
        type="file"
        accept={accept}
        multiple
        className="hidden"
        onChange={(event) => {
          void handleFiles(event.target.files);
          event.target.value = '';
        }}
      />
      {constraintError && (
        <span className="sr-only" role="alert">{constraintError}</span>
      )}
    </div>
  );
}

interface MediaKindItemsProps {
  source: MediaInputSource;
  upstream: MediaOutput[];
  isConnected: boolean;
  localPreviewMapRef: MutableRefObject<Map<string, string>>;
  onDraggingChange: (dragging: boolean) => void;
}

/** 一类素材的小块：缩略图或文件名、同类内拖拽排序、移除、视频裁剪 */
function MediaKindItems({ source, upstream, isConnected, localPreviewMapRef, onDraggingChange }: MediaKindItemsProps) {
  const { t } = useTranslation();
  const {
    kind: mediaKind, inlineValue, onInlineChange,
    videoTrimMaxClipSeconds, videoTrimMaxSizeMB, videoTrimRange, onVideoTrimRangeChange,
  } = source;
  const [viewerVideoUrl, setViewerVideoUrl] = useState<string | null>(null);
  const [trimTargetIndex, setTrimTargetIndex] = useState<number | null>(null);
  // 节点渲染在 React Flow 缩放过的画布坐标系里：CSS transform 是"本地像素"，
  // 画布缩放会把它再放大/缩小一次，所以跟手位移、让位位移都要先除以 zoom 才能在屏幕上 1:1 还原。
  // 用 getZoom() 在拖拽开始那一刻取一次快照（而非 useViewport() 那样订阅视口、每帧重渲染）。
  const { getZoom } = useReactFlow();
  const dragZoomRef = useRef(1);
  const upstreamUrls = useMemo(() => upstream.map((item) => item.url), [upstream]);
  const previewUrlByUrl = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of upstream) {
      if (item.previewUrl) {
        map.set(item.url, item.previewUrl);
      }
    }
    for (const [url, previewUrl] of localPreviewMapRef.current) {
      if (!map.has(url)) {
        map.set(url, previewUrl);
      }
    }
    return map;
  }, [localPreviewMapRef, upstream]);
  const displayUrls = isConnected ? upstreamUrls : inlineValue;
  const Icon = MEDIA_ICON[mediaKind];

  const handleReorder = useCallback((from: number, to: number) => {
    if (isConnected || from === to) {
      return;
    }
    onInlineChange(moveArrayItem(inlineValue, from, to));
  }, [inlineValue, isConnected, onInlineChange]);

  const { dragState, itemRefs, handleMouseDown } = useReorderDrag({
    disabled: isConnected,
    isCustomDragging: false,
    files: displayUrls,
    onReorder: handleReorder,
  });
  const isRowDragging = dragState.isDragging || dragState.isDropping;
  const onDraggingChangeRef = useRef(onDraggingChange);
  onDraggingChangeRef.current = onDraggingChange;
  useEffect(() => {
    onDraggingChangeRef.current(isRowDragging);
  }, [isRowDragging]);

  // 横向让位步进量：拖拽刚开始（toIndex 尚未偏离 fromIndex）时测量一次真实间距，当成固定网格用，
  // 避免用固定像素数（图片/视频/音频 chip 宽度不一致）。
  // 用 offsetLeft（布局坐标，不受画布缩放影响）而不是 getBoundingClientRect()（屏幕坐标，
  // 需要再除一次 zoom 才能换算回本地像素）——这样测出来的步进量可以直接拿来当 translateX 用，
  // 不会因为屏幕坐标换算引入的舍入误差导致"回到原位"和真正原位有一点点偏差。
  const stepPxRef = useRef(34);
  useEffect(() => {
    if (!dragState.isDragging || dragState.fromIndex !== dragState.toIndex) {
      return;
    }
    const first = itemRefs.current[0];
    const second = itemRefs.current[1];
    if (!first || !second) {
      return;
    }
    const measured = Math.abs(second.offsetLeft - first.offsetLeft);
    if (measured > 0) {
      stepPxRef.current = measured;
    }
  }, [dragState.isDragging, dragState.fromIndex, dragState.toIndex, itemRefs]);

  const handleRemove = useCallback((index: number) => {
    if (isConnected) {
      return;
    }
    onInlineChange(inlineValue.filter((_, itemIndex) => itemIndex !== index));
  }, [inlineValue, isConnected, onInlineChange]);

  if (displayUrls.length === 0) {
    return null;
  }

  return (
    <div className="flex shrink-0 items-center gap-1.5">
      {displayUrls.map((url, index) => {
        const { fromIndex, toIndex } = dragState;
        const isDraggingThis = dragState.isDragging && fromIndex === index;
        const isDroppingThis = dragState.isDropping && fromIndex === index;
        const isDropTarget =
          (dragState.isDragging || dragState.isDropping) && toIndex === index && fromIndex !== index;

        const zoom = dragZoomRef.current;
        let itemStyle: CSSProperties | undefined;
        if (isDraggingThis) {
          // 视觉上任意方向跟随光标（拿起来的手感），排序判定本身只看横向距离，与视觉位移无关
          // 除以 zoom：节点本身处在画布缩放坐标系里，本地 transform 像素会被画布再缩放一次
          itemStyle = {
            transform: `translate(${(dragState.currentX - dragState.startX) / zoom}px, ${
              (dragState.currentY - dragState.startY) / zoom
            }px) scale(1.1)`,
            position: 'relative',
            zIndex: Z_LAYERS.drag,
            opacity: 0.85,
            pointerEvents: 'none',
          };
        } else if (isDroppingThis && fromIndex !== null && toIndex !== null) {
          // 落位动画：直接过渡到重排后的目标列位置，避免先弹回原位再跳到新位的二次跳动
          // 步进量是按布局坐标量出来的固定网格，本地 transform 直接用，不需要再除 zoom
          itemStyle = {
            transform: `translateX(${(toIndex - fromIndex) * stepPxRef.current}px)`,
            transition: uiTransition(['transform'], UI_DURATION.fast),
            position: 'relative',
            zIndex: Z_LAYERS.drag,
          };
        } else if ((dragState.isDragging || dragState.isDropping) && fromIndex !== null && toIndex !== null) {
          // 让位/复位动画：始终显式给出位移值（哪怕是 0）并保留 transition，
          // 这样从"已让位"回到"未让位"也会平滑过渡，而不是直接消失瞬间归位
          let shiftX = 0;
          if (fromIndex < toIndex && index > fromIndex && index <= toIndex) {
            shiftX = -stepPxRef.current;
          } else if (fromIndex > toIndex && index < fromIndex && index >= toIndex) {
            shiftX = stepPxRef.current;
          }
          itemStyle = { transform: `translateX(${shiftX}px)`, transition: uiTransition(['transform'], UI_DURATION.fast) };
        }

        return (
        <div
          key={`${url}-${index}`}
          ref={(element) => {
            itemRefs.current[index] = element;
          }}
          className={`group relative shrink-0 ${isDropTarget ? 'rounded-md ring-2 ring-accent' : ''}`}
          style={itemStyle}
          onMouseDown={
            !isConnected
              ? (event) => {
                  dragZoomRef.current = getZoom();
                  handleMouseDown(index, event);
                }
              : undefined
          }
        >
          {mediaKind === 'video' ? (
            // 视频与图片一样给缩略图：有首帧 poster 用 poster，没有就取主进程缓存的首帧图
            <span
              className="relative block h-7 w-7 cursor-pointer"
              aria-label={t('node.mediaRow.itemLabel', { kind: t('node.mediaRow.video'), index: index + 1 })}
              onDoubleClick={(event) => {
                event.stopPropagation();
                setViewerVideoUrl(resolveImageDisplayUrl(url));
              }}
            >
              {previewUrlByUrl.get(url)
                ? <CanvasNodeImage src={resolveImageDisplayUrl(previewUrlByUrl.get(url)!)} alt="" disableViewer failure="icon" className="h-7 w-7 rounded-md border border-line object-cover" draggable={false} />
                : <VideoInputThumbnail url={url} />}
              <Video aria-hidden className={`pointer-events-none absolute bottom-0.5 left-0.5 ${UI_ICON_SIZE_CLASS.xs} text-on-media`} />
              {!isConnected && videoTrimMaxClipSeconds && (
                <UiIconButton size="2xs" tone="media" shape="circle"
                  onClick={(event) => {
                    event.stopPropagation();
                    setTrimTargetIndex(index);
                  }}
                  aria-label={t('node.mediaRow.videoTrim')}
                  tooltip={t('node.mediaRow.videoTrim')}
                  className={`absolute -bottom-1.5 -right-1.5 ${CHIP_ACTION_REVEAL_CLASS}`}
                  type="button"
                >
                  <Scissors  />
                </UiIconButton>
              )}
              {!isConnected && (
                <UiIconButton size="2xs" tone="media" shape="circle"
                  onClick={(event) => {
                    event.stopPropagation();
                    handleRemove(index);
                  }}
                  aria-label={t('node.mediaRow.remove')}
                  tooltip={t('node.mediaRow.remove')}
                  className={`absolute -right-1.5 -top-1.5 ${CHIP_ACTION_REVEAL_CLASS}`}
                  type="button"
                >
                  <X  />
                </UiIconButton>
              )}
            </span>
          ) : mediaKind === 'image' ? (
            <>
              <CanvasNodeImage
                src={resolveImageDisplayUrl(previewUrlByUrl.get(url) ?? url)}
                viewerSourceUrl={resolveImageDisplayUrl(url)}
                viewerImageList={displayUrls.map((item) => resolveImageDisplayUrl(item))}
                alt=""
                className="h-7 w-7 rounded-md border border-line object-cover"
                failure="icon"
                draggable={false}
              />
              {/* 缩略图上是画面：移除按钮按角标叠在角上 */}
              {!isConnected && (
                <UiIconButton size="2xs" tone="media" shape="circle"
                  onClick={(event) => {
                    event.stopPropagation();
                    handleRemove(index);
                  }}
                  aria-label={t('node.mediaRow.remove')}
                  tooltip={t('node.mediaRow.remove')}
                  className={`absolute -right-1.5 -top-1.5 ${CHIP_ACTION_REVEAL_CLASS}`}
                  type="button"
                >
                  <X  />
                </UiIconButton>
              )}
            </>
          ) : (
            // 素材小块在节点卡片里：只用更暗的底、不描边（同一层纵深只画一次边框）。
            // 文字小块的裁剪、移除放在名称后面、常驻占位（悬停才显现）：此前按角标叠在角上，盖住图标与“视频 1”
            <span
              className={`flex h-7 items-center gap-1 rounded-md bg-gap/60 pl-1.5 text-2xs text-text2 ${isConnected ? 'pr-1.5' : 'pr-0.5'}`}
            >
              <Icon className={`${UI_ICON_SIZE_CLASS.xs} shrink-0`} />
              {t('node.mediaRow.itemLabel', { kind: t(`node.mediaRow.${mediaKind}`), index: index + 1 })}
              {!isConnected && (
                <UiIconButton size="2xs"
                  onClick={(event) => {
                    event.stopPropagation();
                    handleRemove(index);
                  }}
                  aria-label={t('node.mediaRow.remove')}
                  tooltip={t('node.mediaRow.remove')}
                  className={CHIP_ACTION_REVEAL_CLASS}
                  type="button"
                >
                  <X  />
                </UiIconButton>
              )}
            </span>
          )}
        </div>
        );
      })}
      {viewerVideoUrl && (
        <VideoViewerModal
          open
          videoUrl={viewerVideoUrl}
          onClose={() => setViewerVideoUrl(null)}
        />
      )}
      {trimTargetIndex !== null && videoTrimMaxClipSeconds && (
        <VideoTrimModal
          open
          previewUrl={resolveImageDisplayUrl(inlineValue[trimTargetIndex])}
          maxClipSeconds={videoTrimMaxClipSeconds}
          maxSizeMB={videoTrimMaxSizeMB}
          resolveSource={async () => inlineValue[trimTargetIndex]}
          initialRange={videoTrimRange ?? null}
          onConfirm={(range) => onVideoTrimRangeChange?.(range)}
          onVideoCompressed={(newPath) => {
            // 完整视频被压缩成新文件：更新画布媒体行引用，后续生成直接用压缩版本
            const idx = trimTargetIndex;
            onInlineChange(inlineValue.map((item, i) => (i === idx ? newPath : item)));
          }}
          onClose={() => setTrimTargetIndex(null)}
        />
      )}
    </div>
  );
}

function VideoInputThumbnail({ url }: { url: string }) {
  const thumbnail = useVideoInputThumbnail(url);
  if (!isLocalVideoSource(url)) {
    return <video src={`${resolveImageDisplayUrl(url)}#t=0.1`} preload="metadata" muted playsInline className="h-7 w-7 rounded-md border border-line bg-media object-cover" />;
  }
  return thumbnail
    ? <CanvasNodeImage src={thumbnail} alt="" disableViewer failure="icon" className="h-7 w-7 rounded-md border border-line object-cover" draggable={false} />
    : <span className="block h-7 w-7 rounded-md border border-line bg-media" />;
}
