import { createLogger } from '@/core/logging'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NodeToolbar as ReactFlowNodeToolbar } from '@xyflow/react';
import { Copy, Crop, Download, FolderCheck, FolderPlus, Image, PenLine, RefreshCw, Scissors, Sparkles, Trash2, Unlink2, Video } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const logger = createLogger('features.canvas.ui.NodeActionToolbar')

import {
  isExportImageNode,
  isCameraStageNode,
  isGroupNode,
  isImageEditNode,
  isStoryboardGenNode,
  isStoryboardSplitNode,
  isUploadNode,
  isVideoMediaNode,
  isAudioMediaNode,
  type CanvasNode,
} from '@/features/canvas/domain/canvasNodes';
import { canvasEventBus } from '@/features/canvas/application/canvasServices';
import { getNodeDefinition } from '@/features/canvas/domain/nodeRegistry';
import { getNodeToolPlugins } from '@/features/canvas/tools';
import type { ToolIconKey } from '@/features/canvas/tools';
import { UiChipButton, UiPanel } from '@/components/ui';
import { copyImageSourceToClipboard } from '@/commands/image';
import { useSettingsStore } from '@/stores/settingsStore';
import { useCanvasStore } from '@/stores/canvasStore';
import { sanitizeStoryboardText } from '@/features/canvas/application/storyboardText';
import {
  NODE_TOOLBAR_ALIGN,
  NODE_TOOLBAR_CLASS,
  NODE_TOOLBAR_OFFSET,
  NODE_TOOLBAR_POSITION,
} from './nodeToolbarConfig';
import { NodeDownloadMenu } from './NodeDownloadMenu';
import { useAddToAssetLibrary } from '@/features/assets/hooks/useAddToAssetLibrary';
import { resolveLocalAssetPath } from '@/features/assets/services/assetCollectionService';
import { checkAssetPaths } from '@/commands/assetLibrary';
import { useNodeDownload } from '@/features/canvas/hooks/useNodeDownload';

interface NodeActionToolbarProps {
  node: CanvasNode;
}

const toolIconMap: Record<ToolIconKey, typeof Crop> = {
  edit: PenLine,
  split: Scissors,
};

const TOOLBAR_BUTTON_RADIUS_CLASS = 'rounded-lg';
/*
 * 工具条外壳是毛玻璃（它浮在画布与图片节点之上），所以按钮的 hover 必须是白色半透明。
 * 这里原先是 `hover:!bg-layer`——不透明的 #404040，压在玻璃上会变成一块实心灰贴片，
 * 把底下的画布内容整块糊掉。玻璃上的层次只能靠加白。
 */
const TOOLBAR_NEUTRAL_BUTTON_CLASS =
  '!border-transparent !bg-transparent text-text-dark hover:!border-veil-subtle hover:!bg-veil-soft hover:!text-text-dark';
const TOOLBAR_ACCENT_BUTTON_CLASS =
  '!border-transparent !bg-transparent text-accent hover:!border-accent/45 hover:!bg-accent/15';
const TOOLBAR_DANGER_BUTTON_CLASS =
  '!border-transparent !bg-transparent text-red-400 hover:!border-red-500/80 hover:!bg-red-500 hover:!text-white';

export const NodeActionToolbar = memo(({ node }: NodeActionToolbarProps) => {
  const { t } = useTranslation();
  const isImageEdit = isImageEditNode(node);
  const isCameraStage = isCameraStageNode(node);
  const isStoryboardGen = isStoryboardGenNode(node);
  const isStoryboardSplit = isStoryboardSplitNode(node);
  const canCopyStoryboardText = isStoryboardGen || isStoryboardSplit;
  const canTriggerGeneration = Boolean(getNodeDefinition(node.type).capabilities.toolbarGenerate);
  const tools = useMemo(() => getNodeToolPlugins(node), [node]);
  const deleteNode = useCanvasStore((state) => state.deleteNode);
  const ungroupNode = useCanvasStore((state) => state.ungroupNode);
  const canReupload = isUploadNode(node) && Boolean(node.data.imageUrl);
  const downloadPresetPaths = useSettingsStore((state) => state.downloadPresetPaths);
  const {
    canDownload,
    downloadMenu,
    isDownloadMenuVisible,
    downloadMenuRef,
    closeDownloadMenu,
    handleDownloadClick,
    handleDownloadSaveAs,
    handleDownloadToPreset,
  } = useNodeDownload(node, downloadPresetPaths);
  const ignoreAtTagWhenCopyingAndGenerating = useSettingsStore(
    (state) => state.ignoreAtTagWhenCopyingAndGenerating
  );
  const [isCopySuccess, setIsCopySuccess] = useState(false);
  const [isCopyTextSuccess, setIsCopyTextSuccess] = useState(false);
  const { addMedia, collecting } = useAddToAssetLibrary();
  const copyFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyTextFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const imageSource = useMemo(() => {
    if (isUploadNode(node) || isImageEditNode(node) || isExportImageNode(node)) {
      return node.data.imageUrl || node.data.previewImageUrl || null;
    }
    return null;
  }, [node]);
  const canHandleImage = Boolean(imageSource);
  const assetMedia = useMemo((): { filePath: string; mediaType: 'image' | 'video' | 'audio' } | null => {
    const candidate = isCameraStage
      ? ((node.data.outputKind ?? 'image') === 'video' ? node.data.videoUrl : node.data.imageUrl)
      : isVideoMediaNode(node)
        ? node.data.videoUrl
        : isAudioMediaNode(node)
          ? node.data.audioUrl
          : imageSource;
    const filePath = resolveLocalAssetPath(candidate);
    if (!filePath) return null;
    const mediaType = isCameraStage
      ? ((node.data.outputKind ?? 'image') === 'video' ? 'video' : 'image')
      : isVideoMediaNode(node) ? 'video' : isAudioMediaNode(node) ? 'audio' : 'image';
    return { filePath, mediaType };
  }, [imageSource, isCameraStage, node]);
  const [assetCollected, setAssetCollected] = useState(false);
  useEffect(() => {
    let cancelled = false;
    if (!assetMedia) { setAssetCollected(false); return; }
    void checkAssetPaths([assetMedia.filePath]).then(([collected]) => {
      if (!cancelled) setAssetCollected(Boolean(collected));
    }).catch(() => { if (!cancelled) setAssetCollected(false); });
    return () => { cancelled = true; };
  }, [assetMedia]);

  const handleCollectAsset = useCallback(async (): Promise<void> => {
    if (!assetMedia || collecting) return;
    try {
      const asset = await addMedia({ ...assetMedia, source: 'canvas', displayName: node.data.displayName });
      setAssetCollected(true);
      canvasEventBus.publish('canvas/toast', {
        message: t(asset.wasExisting ? 'ui:assetLibrary.alreadyCollected' : 'ui:assetLibrary.collectSuccess'),
        type: 'success',
      });
    } catch (error) {
      canvasEventBus.publish('canvas/toast', { message: t('ui:assetLibrary.collectFailed') });
      logger.error('画布节点加入资产库失败', error, {
        event: 'canvas.asset_collection.failed',
        context: { nodeId: node.id, mediaType: assetMedia.mediaType },
      });
    }
  }, [addMedia, assetMedia, collecting, node.data.displayName, node.id, t]);

  useEffect(() => {
    return () => {
      if (copyFeedbackTimerRef.current) {
        clearTimeout(copyFeedbackTimerRef.current);
      }
      if (copyTextFeedbackTimerRef.current) {
        clearTimeout(copyTextFeedbackTimerRef.current);
      }
    };
  }, []);

  const handleCopyImage = useCallback(async () => {
    if (!imageSource) {
      return;
    }

    setIsCopySuccess(true);
    if (copyFeedbackTimerRef.current) {
      clearTimeout(copyFeedbackTimerRef.current);
    }
    copyFeedbackTimerRef.current = setTimeout(() => {
      setIsCopySuccess(false);
      copyFeedbackTimerRef.current = null;
    }, 1100);

    try {
      await copyImageSourceToClipboard(imageSource);
    } catch (error) {
      logger.error('Failed to copy image to clipboard', error);
    }
  }, [imageSource]);

  const storyboardText = useMemo(() => {
    if (isStoryboardGen) {
      return node.data.frames
        .map((frame, index) => t('nodeToolbar.storyboardLine', {
          index: String(index + 1).padStart(2, '0'),
          content: sanitizeStoryboardText(
            frame.description ?? '',
            ignoreAtTagWhenCopyingAndGenerating
          ),
        }))
        .join('\n');
    }
    if (isStoryboardSplit) {
      const orderedFrames = [...node.data.frames].sort((a, b) => a.order - b.order);
      return orderedFrames
        .map((frame, index) => t('nodeToolbar.storyboardLine', {
          index: String(index + 1).padStart(2, '0'),
          content: sanitizeStoryboardText(frame.note ?? '', ignoreAtTagWhenCopyingAndGenerating),
        }))
        .join('\n');
    }
    return '';
  }, [ignoreAtTagWhenCopyingAndGenerating, isStoryboardGen, isStoryboardSplit, node, t]);

  const handleCopyStoryboardText = useCallback(async () => {
    if (!storyboardText) {
      return;
    }

    setIsCopyTextSuccess(true);
    if (copyTextFeedbackTimerRef.current) {
      clearTimeout(copyTextFeedbackTimerRef.current);
    }
    copyTextFeedbackTimerRef.current = setTimeout(() => {
      setIsCopyTextSuccess(false);
      copyTextFeedbackTimerRef.current = null;
    }, 1100);

    try {
      await navigator.clipboard.writeText(storyboardText);
    } catch (error) {
      logger.error('Failed to copy storyboard text', error);
    }
  }, [storyboardText]);

  return (
    <ReactFlowNodeToolbar
      nodeId={node.id}
      isVisible
      position={NODE_TOOLBAR_POSITION}
      align={NODE_TOOLBAR_ALIGN}
      offset={NODE_TOOLBAR_OFFSET}
      className={NODE_TOOLBAR_CLASS}
    >
      {/* 工具条浮在画布/图片节点之上，背后是用户内容而非纯色 UI，走玻璃材质 */}
      <UiPanel variant="glass" className="flex items-center gap-1 p-1">
        {canTriggerGeneration && (
          <UiChipButton
            key="node-generate"
            className={`h-8 ${TOOLBAR_BUTTON_RADIUS_CLASS} px-2.5 text-xs ${TOOLBAR_ACCENT_BUTTON_CLASS}`}
            onClick={(event) => {
              event.stopPropagation();
              canvasEventBus.publish('generation/run', { nodeId: node.id });
            }}
          >
            <Sparkles className="h-3.5 w-3.5" />
            {t('canvas.generate')}
          </UiChipButton>
        )}
        {isCameraStage && (node.data.outputKind ?? 'image') === 'image' && (
            <UiChipButton
              className={`h-8 ${TOOLBAR_BUTTON_RADIUS_CLASS} px-2.5 text-xs ${TOOLBAR_ACCENT_BUTTON_CLASS}`}
              disabled={!node.data.imageUrl}
              onClick={(event) => {
                event.stopPropagation();
                canvasEventBus.publish('camera-stage/output', { nodeId: node.id, kind: 'image' });
              }}
            >
              <Image className="h-3.5 w-3.5" />
              {t('nodeToolbar.outputImage')}
            </UiChipButton>
        )}
        {isCameraStage && node.data.outputKind === 'video' && (
            <UiChipButton
              className={`h-8 ${TOOLBAR_BUTTON_RADIUS_CLASS} px-2.5 text-xs ${TOOLBAR_ACCENT_BUTTON_CLASS}`}
              disabled={Boolean(node.data.videoExporting)}
              onClick={(event) => {
                event.stopPropagation();
                canvasEventBus.publish('camera-stage/render-video', { nodeId: node.id });
              }}
            >
              <Video className="h-3.5 w-3.5" />
              {t('nodeToolbar.outputVideo')}
            </UiChipButton>
        )}
        {!isImageEdit && tools.map((tool) => {
          const Icon = toolIconMap[tool.icon] ?? Crop;

          return (
            <UiChipButton
              key={tool.type}
              className={`h-8 ${TOOLBAR_BUTTON_RADIUS_CLASS} px-2.5 text-xs ${TOOLBAR_NEUTRAL_BUTTON_CLASS}`}
              onClick={() =>
                canvasEventBus.publish('tool-dialog/open', {
                  nodeId: node.id,
                  toolType: tool.type,
                })
              }
            >
              <Icon className="h-3.5 w-3.5" />
              {tool.label}
            </UiChipButton>
          );
        })}
        {!isImageEdit && canReupload && (
          <UiChipButton
            key="upload-reupload"
            className={`h-8 ${TOOLBAR_BUTTON_RADIUS_CLASS} px-2.5 text-xs ${TOOLBAR_NEUTRAL_BUTTON_CLASS}`}
            onClick={() =>
              canvasEventBus.publish('upload-node/reupload', {
                nodeId: node.id,
              })
            }
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {t('nodeToolbar.reupload')}
          </UiChipButton>
        )}
        {!isImageEdit && canHandleImage && (
          <UiChipButton
            key="image-copy"
            className={`h-8 ${TOOLBAR_BUTTON_RADIUS_CLASS} px-2.5 text-xs ${TOOLBAR_NEUTRAL_BUTTON_CLASS} ${
              isCopySuccess
                ? '!border-emerald-400/70 !bg-emerald-500/20 !text-emerald-200 hover:!bg-emerald-500/30'
                : ''
            }`}
            onClick={() => {
              void handleCopyImage();
            }}
          >
            <Copy className="h-3.5 w-3.5" />
            {t('nodeToolbar.copy')}
          </UiChipButton>
        )}
        {assetMedia && (
          <UiChipButton
            key="asset-collect"
            disabled={collecting}
            className={`h-8 ${TOOLBAR_BUTTON_RADIUS_CLASS} px-2.5 text-xs ${TOOLBAR_NEUTRAL_BUTTON_CLASS} ${assetCollected ? '!text-emerald-400' : ''}`}
            onClick={(event) => {
              event.stopPropagation();
              void handleCollectAsset();
            }}
          >
            {assetCollected ? <FolderCheck className="h-3.5 w-3.5" /> : <FolderPlus className="h-3.5 w-3.5" />}
            {t('ui:assetLibrary.assetShort')}
          </UiChipButton>
        )}
        {!isImageEdit && canCopyStoryboardText && (
          <UiChipButton
            key="storyboard-text-copy"
            className={`h-8 ${TOOLBAR_BUTTON_RADIUS_CLASS} px-2.5 text-xs ${TOOLBAR_NEUTRAL_BUTTON_CLASS} ${
              isCopyTextSuccess
                ? '!border-emerald-400/70 !bg-emerald-500/20 !text-emerald-200 hover:!bg-emerald-500/30'
                : ''
            }`}
            onClick={() => {
              void handleCopyStoryboardText();
            }}
          >
            <Copy className="h-3.5 w-3.5" />
            {t('nodeToolbar.copyText')}
          </UiChipButton>
        )}
        {canDownload && (
          <UiChipButton
            key="media-download"
            className={`h-8 ${TOOLBAR_BUTTON_RADIUS_CLASS} px-2.5 text-xs ${TOOLBAR_NEUTRAL_BUTTON_CLASS}`}
            onClick={handleDownloadClick}
          >
            <Download className="h-3.5 w-3.5" />
            {t('nodeToolbar.download')}
          </UiChipButton>
        )}
        {!isImageEdit && isGroupNode(node) && (
          <UiChipButton
            key="group-ungroup"
            className={`h-8 ${TOOLBAR_BUTTON_RADIUS_CLASS} px-2.5 text-xs ${TOOLBAR_NEUTRAL_BUTTON_CLASS} hover:!border-amber-400/60 hover:!bg-amber-500/20 hover:!text-amber-200`}
            onClick={(event) => {
              event.stopPropagation();
              closeDownloadMenu();
              ungroupNode(node.id);
            }}
          >
            <Unlink2 className="h-3.5 w-3.5" />
            {t('nodeToolbar.ungroup')}
          </UiChipButton>
        )}
        <UiChipButton
          key="node-delete"
          className={`h-8 ${TOOLBAR_BUTTON_RADIUS_CLASS} px-2.5 text-xs ${TOOLBAR_DANGER_BUTTON_CLASS}`}
          onClick={(event) => {
            event.stopPropagation();
            closeDownloadMenu();
            deleteNode(node.id);
          }}
        >
          <Trash2 className="h-3.5 w-3.5" />
          {t('common.delete')}
        </UiChipButton>
      </UiPanel>

      {canDownload && (
        <NodeDownloadMenu
          menu={downloadMenu}
          isVisible={isDownloadMenuVisible}
          menuRef={downloadMenuRef}
          downloadPresetPaths={downloadPresetPaths}
          saveAsLabel={t('nodeToolbar.saveAs')}
          noPresetHintLabel={t('nodeToolbar.noDownloadPresetPathsHint')}
          onSaveAs={() => {
            void handleDownloadSaveAs();
          }}
          onSaveToPreset={(path) => {
            void handleDownloadToPreset(path);
          }}
        />
      )}
    </ReactFlowNodeToolbar>
  );
});

NodeActionToolbar.displayName = 'NodeActionToolbar';
