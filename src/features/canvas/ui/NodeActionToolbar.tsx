import { isCanvasNodeUnavailable } from '../domain/nodeAvailability';
import { useNodeToolbarBoundary } from './useNodeToolbarBoundary'
import { reportCanvasOperationFailure } from '@/features/canvas/application/canvasOperationFeedback';
import { createLogger } from '@/core/logging'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NodeToolbar as ReactFlowNodeToolbar } from '@xyflow/react';
import { Check, Copy, Crop, Download, FolderCheck, FolderPlus, Image, PenLine, RefreshCw, Scissors, Sparkles, Trash2, Unlink2, Video } from 'lucide-react';
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
  isAssetGroupNode,
  type CanvasNode,
} from '@/features/canvas/domain/canvasNodes';
import { canvasEventBus } from '@/features/canvas/application/canvasServices';
import {
  executeCanvasImageCapabilityFromSource,
} from '@/features/canvas/application/canvasImageCapabilityApplicationService';
import {
  type CanvasImageCapabilityId,
} from '@/features/canvas/capabilities';
import { getNodeDefinition } from '@/features/canvas/domain/nodeRegistry';
import { getNodeToolPlugins } from '@/features/canvas/tools';
import type { ToolIconKey } from '@/features/canvas/tools';
import {
  UI_GLASS_ADAPTIVE_DIVIDER_CLASS,
  UiButton,
  UiPanel,
} from '@/components/ui';
import { copyImageSourceToClipboard } from '@/commands/image';
import { useSettingsStore } from '@/stores/settingsStore';
import { useCanvasStore } from '@/stores/canvasStore';
import { useProjectStore } from '@/stores/projectStore';
import { deleteCanvasNodes } from '@/features/canvas/application/canvasMutationService';
import { sanitizeStoryboardText } from '@/features/canvas/application/storyboardText';
import {
  NODE_TOOLBAR_ALIGN,
  NODE_TOOLBAR_CLASS,
  NODE_TOOLBAR_OFFSET,
  NODE_TOOLBAR_POSITION,
} from './nodeToolbarConfig';
import ContextMenu from '@/components/ContextMenu';
import { useAddToAssetLibrary } from '@/features/assets/hooks/useAddToAssetLibrary';
import { resolveLocalAssetPath } from '@/features/assets/services/assetCollectionService';
import { checkAssetPaths } from '@/commands/assetLibrary';
import { ICON_WORKSPACE_VIDEO_EDIT } from '@/core/theme/icons';
import { createCameraStageRenderTaskRef } from '@/features/cameraStage/application/cameraStageRenderCapabilityAdapter';
import { sendCreativeResultToVideoEdit } from '@/features/videoEdit/application/videoEditResultSend';
import type { VideoEditCreativeSourceRequest } from '@/core/videoEdit/creativeResult';
import { useNodeDownload } from '@/features/canvas/hooks/useNodeDownload';
import { runCanvasNode } from '@/features/canvas/application/canvasExecutionService';
import { dissolveAssetGroup } from '@/features/canvas/application/assetGroupApplicationService';
import { CanvasImageCapabilityActions } from './CanvasImageCapabilityActions';
import {
  excludeClaimedLocalTools,
  resolveCanvasImageCapabilityActionsForSourceNode,
} from './canvasImageCapabilityLayout';

interface NodeActionToolbarProps {
  node: CanvasNode;
}

const toolIconMap: Record<ToolIconKey, typeof Crop> = {
  edit: PenLine,
  split: Scissors,
};

export const NodeActionToolbar = memo(({ node }: NodeActionToolbarProps) => {
  const toolbarPanelRef = useNodeToolbarBoundary(node.id)
  const { t } = useTranslation();
  const isImageEdit = isImageEditNode(node);
  const isCameraStage = isCameraStageNode(node);
  const isStoryboardGen = isStoryboardGenNode(node);
  const isStoryboardSplit = isStoryboardSplitNode(node);
  const canCopyStoryboardText = isStoryboardGen || isStoryboardSplit;
  const nodeDefinition = getNodeDefinition(node.type);
  const canTriggerGeneration = Boolean(nodeDefinition.capabilities.toolbarGenerate) && !isCanvasNodeUnavailable(node);
  const imageCapabilityActions = useMemo(
    () => resolveCanvasImageCapabilityActionsForSourceNode(node),
    [node],
  );
  const tools = useMemo(
    () => excludeClaimedLocalTools(
      getNodeToolPlugins(node),
      imageCapabilityActions.map(({ capability }) => capability),
    ),
    [imageCapabilityActions, node],
  );
  const projectId = useProjectStore((state) => state.currentProjectId);
  const ungroupNode = useCanvasStore((state) => state.ungroupNode);
  const canReupload = nodeDefinition.media?.role === 'source'
    && Boolean(nodeDefinition.getOutputs?.(node.data).length);
  const downloadPresetPaths = useSettingsStore((state) => state.downloadPresetPaths);
  const {
    canDownload,
    downloadMenu,
    closeDownloadMenu,
    handleDownloadClick,
  } = useNodeDownload(node, downloadPresetPaths);
  const ignoreAtTagWhenCopyingAndGenerating = useSettingsStore(
    (state) => state.ignoreAtTagWhenCopyingAndGenerating
  );
  const [isCopySuccess, setIsCopySuccess] = useState(false);
  const [isCopyTextSuccess, setIsCopyTextSuccess] = useState(false);
  const [pendingCapabilityId, setPendingCapabilityId] = useState<CanvasImageCapabilityId | null>(null);
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
  const assetCandidate = isCameraStage
      ? ((node.data.outputKind ?? 'image') === 'video' ? node.data.videoUrl : node.data.imageUrl)
      : isVideoMediaNode(node)
        ? node.data.videoUrl
        : isAudioMediaNode(node)
          ? node.data.audioUrl
          : imageSource;
  const assetMediaType: 'image' | 'video' | 'audio' = isCameraStage
      ? ((node.data.outputKind ?? 'image') === 'video' ? 'video' : 'image')
      : isVideoMediaNode(node) ? 'video' : isAudioMediaNode(node) ? 'audio' : 'image';
  const assetMedia = useMemo(() => {
    const filePath = resolveLocalAssetPath(assetCandidate);
    return filePath ? { filePath, mediaType: assetMediaType } : null;
  }, [assetCandidate, assetMediaType]);
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

  // Only persisted completions enter an edit; 3D results keep their render-task provenance.
  const videoEditSource = useMemo((): { source: VideoEditCreativeSourceRequest; mediaKind: 'image' | 'video' | 'audio' } | null => {
    const descriptor = node.data.generationOutputDescriptor;
    if (!projectId || !assetMedia || !node.data.generationOutputCommitId || descriptor?.version !== 1 || node.data.isGenerating) return null;
    const receipt = node.data.cameraStageRenderReceipt;
    const source: VideoEditCreativeSourceRequest = receipt
      ? { kind: 'camera_stage.render_task', taskRef: createCameraStageRenderTaskRef(receipt).id }
      : { kind: 'canvas.node', projectId, nodeId: node.id, completionId: node.data.generationOutputCommitId, outputId: descriptor.outputId };
    return { source, mediaKind: descriptor.mediaType };
  }, [assetMedia, node.data.cameraStageRenderReceipt, node.data.generationOutputCommitId, node.data.generationOutputDescriptor, node.data.isGenerating, node.id, projectId]);
  const [sendingToVideoEdit, setSendingToVideoEdit] = useState(false);
  const handleSendToVideoEdit = useCallback(async (): Promise<void> => {
    if (!videoEditSource || sendingToVideoEdit) return;
    setSendingToVideoEdit(true);
    try {
      await sendCreativeResultToVideoEdit(videoEditSource.source, { mediaKind: videoEditSource.mediaKind, mode: 'add' });
      canvasEventBus.publish('canvas/toast', { message: t('ui:videoEditSend.added'), type: 'success' });
    } catch (error) {
      canvasEventBus.publish('canvas/toast', { message: error instanceof Error ? error.message : t('ui:videoEditSend.failed') });
      logger.warn('画布结果加入剪辑失败', { event: 'canvas.video_edit_send.failed', error, context: { nodeId: node.id } });
    } finally { setSendingToVideoEdit(false); }
  }, [node.id, sendingToVideoEdit, t, videoEditSource]);

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

    try {
      await copyImageSourceToClipboard(imageSource);
      setIsCopySuccess(true);
      if (copyFeedbackTimerRef.current) {
        clearTimeout(copyFeedbackTimerRef.current);
      }
      copyFeedbackTimerRef.current = setTimeout(() => {
        setIsCopySuccess(false);
        copyFeedbackTimerRef.current = null;
      }, 1100);
    } catch (error) {
      logger.error('Failed to copy image to clipboard', error);
      setIsCopySuccess(false);
      reportCanvasOperationFailure(new Error(t('ui:workspace.toast.copyFailed', {
        reason: error instanceof Error ? error.message : String(error),
      })));
    }
  }, [imageSource, t]);

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

    try {
      await navigator.clipboard.writeText(storyboardText);
      setIsCopyTextSuccess(true);
      if (copyTextFeedbackTimerRef.current) {
        clearTimeout(copyTextFeedbackTimerRef.current);
      }
      copyTextFeedbackTimerRef.current = setTimeout(() => {
        setIsCopyTextSuccess(false);
        copyTextFeedbackTimerRef.current = null;
      }, 1100);
    } catch (error) {
      logger.error('Failed to copy storyboard text', error);
      setIsCopyTextSuccess(false);
      reportCanvasOperationFailure(new Error(t('ui:workspace.toast.copyFailed', {
        reason: error instanceof Error ? error.message : String(error),
      })));
    }
  }, [storyboardText, t]);

  const handleExecuteImageCapability = useCallback(async (
    capabilityId: CanvasImageCapabilityId,
  ): Promise<void> => {
    if (pendingCapabilityId !== null) return;
    setPendingCapabilityId(capabilityId);
    try {
      await executeCanvasImageCapabilityFromSource(node.id, capabilityId);
    } catch (error) {
      reportCanvasOperationFailure(error);
    } finally {
      setPendingCapabilityId(null);
    }
  }, [node.id, pendingCapabilityId]);

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
      <UiPanel ref={toolbarPanelRef} variant="glass" data-node-toolbar-panel className="ui-scrollbar flex w-max items-center gap-1 overflow-x-auto p-1 [&>*]:shrink-0">
        {canTriggerGeneration && (
          <UiButton
            key="node-generate"
            variant="primary"
            onClick={(event) => {
              event.stopPropagation();
              void runCanvasNode(node.id).catch(() => undefined);
            }}
          >
            <Sparkles className="h-3.5 w-3.5" />
            {t('canvas.generate')}
          </UiButton>
        )}
        {isCameraStage && (node.data.outputKind ?? 'image') === 'image' && (
            <UiButton
              variant="secondary"
              disabled={Boolean(node.data.imageExporting || node.data.videoExporting)}
              onClick={(event) => {
                event.stopPropagation();
                canvasEventBus.publish('camera-stage/render-image', { nodeId: node.id });
              }}
            >
              <Image className="h-3.5 w-3.5" />
              {t('nodeToolbar.outputImage')}
            </UiButton>
        )}
        {isCameraStage && node.data.outputKind === 'video' && (
            <UiButton
              variant="secondary"
              disabled={Boolean(node.data.videoExporting)}
              onClick={(event) => {
                event.stopPropagation();
                canvasEventBus.publish('camera-stage/render-video', { nodeId: node.id });
              }}
            >
              <Video className="h-3.5 w-3.5" />
              {t('nodeToolbar.outputVideo')}
            </UiButton>
        )}
        <CanvasImageCapabilityActions
          actions={imageCapabilityActions}
          pendingCapabilityId={pendingCapabilityId}
          onExecute={(capabilityId) => {
            void handleExecuteImageCapability(capabilityId);
          }}
        />
        {imageCapabilityActions.length > 0 && (
          <span
            role="separator"
            aria-orientation="vertical"
            className={`mx-0.5 h-5 w-px shrink-0 ${UI_GLASS_ADAPTIVE_DIVIDER_CLASS}`}
          />
        )}
        {!isImageEdit && tools.map((tool) => {
          const Icon = toolIconMap[tool.icon] ?? Crop;

          return (
            <UiButton
              key={tool.type}
              onClick={() =>
                canvasEventBus.publish('tool-dialog/open', {
                  nodeId: node.id,
                  toolType: tool.type,
                })
              }
            >
              <Icon className="h-3.5 w-3.5" />
              {tool.label}
            </UiButton>
          );
        })}
        {!isImageEdit && canReupload && (
          <UiButton
            key="upload-reupload"
            onClick={() =>
              canvasEventBus.publish('upload-node/reupload', {
                nodeId: node.id,
              })
            }
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {t('nodeToolbar.reupload')}
          </UiButton>
        )}
        {!isImageEdit && canHandleImage && (
          <UiButton
            key="image-copy"
            aria-label={isCopySuccess ? t('ui:workspace.toast.copySuccess') : t('nodeToolbar.copy')}
            onClick={() => {
              void handleCopyImage();
            }}
          >
            {isCopySuccess ? <Check className="h-3.5 w-3.5 text-success-text" /> : <Copy className="h-3.5 w-3.5" />}
            {t('nodeToolbar.copy')}
          </UiButton>
        )}
        {assetMedia && (
          <UiButton
            key="asset-collect"
            disabled={collecting}
            onClick={(event) => {
              event.stopPropagation();
              void handleCollectAsset();
            }}
          >
            {assetCollected ? <FolderCheck className="h-3.5 w-3.5 text-success-text" /> : <FolderPlus className="h-3.5 w-3.5" />}
            {t('ui:assetLibrary.assetShort')}
          </UiButton>
        )}
        {videoEditSource && (
          <UiButton
            key="video-edit-send"
            disabled={sendingToVideoEdit}
            title={t('ui:videoEditSend.addToPlayhead')}
            onClick={(event) => {
              event.stopPropagation();
              void handleSendToVideoEdit();
            }}
          >
            <ICON_WORKSPACE_VIDEO_EDIT className="h-3.5 w-3.5" />
            {t('ui:videoEditSend.short')}
          </UiButton>
        )}
        {!isImageEdit && canCopyStoryboardText && (
          <UiButton
            key="storyboard-text-copy"
            aria-label={isCopyTextSuccess ? t('ui:workspace.toast.copySuccess') : t('nodeToolbar.copyText')}
            onClick={() => {
              void handleCopyStoryboardText();
            }}
          >
            {isCopyTextSuccess ? <Check className="h-3.5 w-3.5 text-success-text" /> : <Copy className="h-3.5 w-3.5" />}
            {t('nodeToolbar.copyText')}
          </UiButton>
        )}
        {canDownload && (
          <UiButton
            key="media-download"
            onClick={handleDownloadClick}
          >
            <Download className="h-3.5 w-3.5" />
            {t('nodeToolbar.download')}
          </UiButton>
        )}
        {!isImageEdit && (isGroupNode(node) || isAssetGroupNode(node)) && (
          <UiButton
            key="group-ungroup"
            onClick={(event) => {
              event.stopPropagation();
              closeDownloadMenu();
              if (isAssetGroupNode(node)) void dissolveAssetGroup({ groupId: node.id }).catch(reportCanvasOperationFailure);
              else ungroupNode(node.id);
            }}
          >
            <Unlink2 className="h-3.5 w-3.5" />
            {t('nodeToolbar.ungroup')}
          </UiButton>
        )}
        <UiButton
          key="node-delete"
          variant="danger"
          onClick={(event) => {
            event.stopPropagation();
            closeDownloadMenu();
            if (projectId) void deleteCanvasNodes(projectId, [node.id]).catch(reportCanvasOperationFailure);
          }}
        >
          <Trash2 className="h-3.5 w-3.5" />
          {t('common.delete')}
        </UiButton>
      </UiPanel>

      {canDownload && (
        <ContextMenu
          visible={downloadMenu.visible}
          position={downloadMenu.position}
          items={downloadMenu.items}
          onClose={closeDownloadMenu}
          surface="glass"
        />
      )}
    </ReactFlowNodeToolbar>
  );
});

NodeActionToolbar.displayName = 'NodeActionToolbar';
