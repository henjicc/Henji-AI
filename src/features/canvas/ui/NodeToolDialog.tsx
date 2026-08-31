import { createLogger } from '@/core/logging'
import { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

const logger = createLogger('features.canvas.ui.NodeToolDialog')

import {
  isExportImageNode,
  isImageEditNode,
  isLayerStackResultNode,
  isUploadNode,
} from '@/features/canvas/domain/canvasNodes';
import {
  canvasEventBus,
  canvasToolProcessor,
} from '@/features/canvas/application/canvasServices';
import {
  prepareNodeImage,
  reduceAspectRatio,
  resolveImageDisplayUrl,
} from '@/features/canvas/application/imageData';
import { commitGridSplitResult } from '@/features/canvas/application/gridSplitApplicationService';
import { readStoryboardImageMetadata } from '@/commands/image';
import { getToolPlugin, type ToolOptions } from '@/features/canvas/tools';
import { useCanvasStore } from '@/stores/canvasStore';
import { UiButton, UiModal } from '@/components/ui';
import { UI_DIALOG_TRANSITION_MS } from '@/components/ui/motion';
import { isImageEditorV3Enabled } from '@/platform/runtime';
import { FormToolEditor } from './tool-editors/FormToolEditor';
import { EditToolEditor } from './tool-editors/EditToolEditor';
import { SplitStoryboardToolEditor } from './tool-editors/SplitStoryboardToolEditor';

export function NodeToolDialog() {
  const { t } = useTranslation();
  const activeToolDialog = useCanvasStore((state) => state.activeToolDialog);
  const addDerivedExportNode = useCanvasStore((state) => state.addDerivedExportNode);
  const addEdge = useCanvasStore((state) => state.addEdge);

  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [options, setOptions] = useState<ToolOptions>({});
  const [isSplitImageReady, setIsSplitImageReady] = useState(true);
  const [readyEditorKey, setReadyEditorKey] = useState<string | null>(null);
  const [displayToolDialog, setDisplayToolDialog] = useState(activeToolDialog);
  // 每次打开自增,作为编辑器 key 的一部分,强制每次打开都重建编辑器实例
  // (避免取消后快速重开时复用旧内部状态,导致未保存的标注仍然出现)
  const [openSeq, setOpenSeq] = useState(0);
  const wasOpenRef = useRef(false);
  const processingAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const isOpen = Boolean(activeToolDialog);
    if (isOpen && !wasOpenRef.current) {
      setOpenSeq((seq) => seq + 1);
    }
    wasOpenRef.current = isOpen;
  }, [activeToolDialog]);

  useEffect(() => {
    if (activeToolDialog) {
      setDisplayToolDialog(activeToolDialog);
      return;
    }

    const timer = setTimeout(() => {
      setDisplayToolDialog(null);
    }, UI_DIALOG_TRANSITION_MS);

    return () => {
      clearTimeout(timer);
    };
  }, [activeToolDialog]);

  // 直接在 selector 里按 id 查找，避免订阅整个 nodes 数组——
  // 画布上任意其他节点编辑都会换 nodes 数组引用，但只有目标节点对象本身变化时才需要重渲染。
  const sourceNode = useCanvasStore((state) =>
    displayToolDialog ? state.nodes.find((node) => node.id === displayToolDialog.nodeId) ?? null : null
  );

  const sourceImageUrl = useMemo(() => {
    if (!sourceNode) {
      return null;
    }

    if (
      isUploadNode(sourceNode)
      || isImageEditNode(sourceNode)
      || isExportImageNode(sourceNode)
      || isLayerStackResultNode(sourceNode)
    ) {
      return sourceNode.data.imageUrl;
    }

    return null;
  }, [sourceNode]);

  const activePlugin = useMemo(() => {
    if (!displayToolDialog) {
      return null;
    }

    return getToolPlugin(displayToolDialog.toolType);
  }, [displayToolDialog]);

  const dialogKey = displayToolDialog
    ? `${displayToolDialog.nodeId}:${displayToolDialog.toolType}`
    : null;
  // 编辑器 key 追加 openSeq,保证每次打开都是全新实例,取消后重开不残留旧标注
  const editorKey = dialogKey ? `${dialogKey}:${openSeq}` : null;

  useEffect(() => {
    if (!sourceNode || !activePlugin) {
      return;
    }

    let cancelled = false;
    setError(null);
    const initialOptions = activePlugin.createInitialOptions(sourceNode);
    setOptions(initialOptions);

    if (!activePlugin.dialog.preloadStoryboardMetadata || !sourceImageUrl) {
      return () => {
        cancelled = true;
      };
    }

    void (async () => {
      try {
        const metadata = await readStoryboardImageMetadata(sourceImageUrl);
        if (!metadata || cancelled) {
          return;
        }

        const nextRows = Math.max(1, Math.min(8, Math.floor(metadata.gridRows)));
        const nextCols = Math.max(1, Math.min(8, Math.floor(metadata.gridCols)));
        if (!Number.isFinite(nextRows) || !Number.isFinite(nextCols)) {
          return;
        }

        setOptions((previous) => ({
          ...previous,
          rows: nextRows,
          cols: nextCols,
        }));
      } catch (error) {
        logger.warn('[StoryboardMetadata] read failed on split dialog init', error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [dialogKey, sourceNode, activePlugin, sourceImageUrl]);

  useEffect(() => {
    const requiresSplitPreload = Boolean(
      activePlugin?.dialog.preloadStoryboardMetadata && sourceImageUrl
    );
    if (!requiresSplitPreload || !sourceImageUrl) {
      setIsSplitImageReady(true);
      return;
    }

    let cancelled = false;
    const image = new Image();
    const displayImageUrl = resolveImageDisplayUrl(sourceImageUrl);

    setIsSplitImageReady(false);

    image.onload = () => {
      if (cancelled) {
        return;
      }
      setIsSplitImageReady(true);
    };

    image.onerror = () => {
      if (cancelled) {
        return;
      }
      setIsSplitImageReady(true);
    };

    image.src = displayImageUrl;
    if (image.complete) {
      setIsSplitImageReady(true);
    }

    return () => {
      cancelled = true;
    };
  }, [activePlugin?.dialog.preloadStoryboardMetadata, sourceImageUrl]);

  const closeDialog = useCallback(() => {
    processingAbortRef.current?.abort();
    // 立即清空本地编辑选项,避免取消后未保存的标注在重开时被重新读取
    setOptions({});
    setError(null);
    setReadyEditorKey(null);
    canvasEventBus.publish('tool-dialog/close', undefined);
  }, []);

  const handleApply = useCallback(async () => {
    if (!activeToolDialog || !sourceNode || !sourceImageUrl || !activePlugin) {
      setError(t('toolDialog.noProcessableImage'));
      return;
    }

    setIsProcessing(true);
    setError(null);
    const processingController = new AbortController();
    processingAbortRef.current = processingController;
    logger.debug('canvas.tool.dialog.apply.start', {
      toolId: activePlugin.type,
      nodeId: sourceNode.id,
    });

    try {
      const result = await activePlugin.execute(sourceImageUrl, options, {
        processTool: (toolType, imageUrl, toolOptions) =>
          canvasToolProcessor.process(
            toolType,
            imageUrl,
            toolOptions,
            processingController.signal,
          ),
      });

      if (result.storyboardFrames && result.rows && result.cols) {
        await commitGridSplitResult({
          sourceNodeId: sourceNode.id,
          sourceImageUrl,
          rows: result.rows,
          cols: result.cols,
          lineThicknessPercent: typeof options.lineThicknessPercent === 'number'
            ? options.lineThicknessPercent
            : undefined,
          frames: result.storyboardFrames,
        });
      } else if (result.outputImageUrl) {
        if (result.imageEditSession && (!result.outputImageSize
          || !Number.isSafeInteger(result.outputImageSize.width)
          || !Number.isSafeInteger(result.outputImageSize.height)
          || result.outputImageSize.width <= 0
          || result.outputImageSize.height <= 0)) {
          throw new Error('画布图片编辑受管输出缺少有效尺寸');
        }
        const prepared = result.imageEditSession && result.outputImageSize
          ? {
              imageUrl: result.outputImageUrl,
              previewImageUrl: result.outputImageUrl,
              aspectRatio: reduceAspectRatio(
                result.outputImageSize.width,
                result.outputImageSize.height,
              ),
            }
          : await prepareNodeImage(result.outputImageUrl);
        const createdNodeId = addDerivedExportNode(
          sourceNode.id,
          prepared.imageUrl,
          prepared.aspectRatio,
          prepared.previewImageUrl,
          {
            defaultTitle: activePlugin.dialog.resultNodeTitle,
            resultKind: 'generic',
            aspectRatioStrategy: 'provided',
            sizeStrategy: 'autoMinEdge',
            imageEditSession: result.imageEditSession,
          }
        );
        if (createdNodeId) {
          addEdge(sourceNode.id, createdNodeId);
        }
      }

      logger.info('canvas.tool.dialog.apply.completed', {
        toolId: activePlugin.type,
        nodeId: sourceNode.id,
      });
      closeDialog();
    } catch (processError) {
      if (processingController.signal.aborted) {
        logger.info('canvas.tool.dialog.apply.cancelled', {
          toolId: activePlugin.type,
          nodeId: sourceNode.id,
        });
        return;
      }
      logger.error('canvas.tool.dialog.apply.failed', {
        toolId: activePlugin.type,
        nodeId: sourceNode.id,
        error: processError instanceof Error ? processError.message : String(processError),
      });
      setError(processError instanceof Error ? processError.message : t('toolDialog.processFailed'));
    } finally {
      if (processingAbortRef.current === processingController) {
        processingAbortRef.current = null;
      }
      setIsProcessing(false);
    }
  }, [
    activeToolDialog,
    sourceNode,
    sourceImageUrl,
    activePlugin,
    options,
    addDerivedExportNode,
    addEdge,
    closeDialog,
    t,
  ]);

  const editorContent = useMemo(() => {
    if (!activePlugin) {
      return null;
    }

    if (activePlugin.editor === 'edit' && sourceImageUrl) {
      return (
        <EditToolEditor
          key={editorKey}
          plugin={activePlugin}
          sourceImageUrl={sourceImageUrl}
          options={options}
          onOptionsChange={setOptions}
          onExecutionReadyChange={(ready) => {
            setReadyEditorKey(ready ? editorKey : null);
          }}
        />
      );
    }

    if (activePlugin.editor === 'split' && sourceImageUrl) {
      return (
        <SplitStoryboardToolEditor
          plugin={activePlugin}
          sourceImageUrl={sourceImageUrl}
          options={options}
          onOptionsChange={setOptions}
        />
      );
    }

    return (
      <FormToolEditor
        plugin={activePlugin}
        fields={activePlugin.fields}
        options={options}
        onOptionsChange={setOptions}
      />
    );
  }, [activePlugin, editorKey, options, sourceImageUrl]);

  const isOpen = Boolean(activeToolDialog && isSplitImageReady);

  return (
    <UiModal
      isOpen={isOpen}
      title={`${activePlugin?.label ?? ''}${t('toolDialog.suffix')}`}
      onClose={closeDialog}
      size={activePlugin?.dialog.size ?? 'form'}
      contentClassName="overflow-y-auto px-4 py-4"
      footer={
        <>
          <UiButton variant="ghost" size="sm" onClick={closeDialog}>
            {t('common.cancel')}
          </UiButton>
          <UiButton
            size="sm"
            variant="primary"
            onClick={handleApply}
            disabled={isProcessing || !sourceImageUrl || (
              activePlugin?.editor === 'edit'
              && isImageEditorV3Enabled()
              && readyEditorKey !== editorKey
            )}
          >
            {isProcessing ? t('toolDialog.processing') : t('toolDialog.apply')}
          </UiButton>
        </>
      }
    >
      <div className="space-y-3 max-h-[82vh] overflow-y-auto pr-1">
        {editorContent}
        {error && <div className="text-xs text-red-400">{error}</div>}
      </div>
    </UiModal>
  );
}
