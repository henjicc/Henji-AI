import { useMemo, useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import {
  NODE_TOOL_TYPES,
  isExportImageNode,
  isImageEditNode,
  isUploadNode,
  type NodeToolType,
} from '@/features/canvas/domain/canvasNodes';
import { EXPORT_RESULT_DISPLAY_NAME } from '@/features/canvas/domain/nodeDisplay';
import {
  canvasEventBus,
  canvasToolProcessor,
} from '@/features/canvas/application/canvasServices';
import { prepareNodeImage, resolveImageDisplayUrl } from '@/features/canvas/application/imageData';
import { readStoryboardImageMetadata } from '@/commands/image';
import { getToolPlugin, type ToolOptions } from '@/features/canvas/tools';
import { useCanvasStore } from '@/stores/canvasStore';
import { UiButton, UiModal } from '@/components/ui';
import { UI_DIALOG_TRANSITION_MS } from '@/components/ui/motion';
import { FormToolEditor } from './tool-editors/FormToolEditor';
import { CropToolEditor } from './tool-editors/CropToolEditor';
import { AnnotateToolEditor } from './tool-editors/AnnotateToolEditor';
import { SplitStoryboardToolEditor } from './tool-editors/SplitStoryboardToolEditor';

export function NodeToolDialog() {
  const { t } = useTranslation();
  const activeToolDialog = useCanvasStore((state) => state.activeToolDialog);
  const nodes = useCanvasStore((state) => state.nodes);
  const addDerivedExportNode = useCanvasStore((state) => state.addDerivedExportNode);
  const addStoryboardSplitNode = useCanvasStore((state) => state.addStoryboardSplitNode);
  const addEdge = useCanvasStore((state) => state.addEdge);

  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [options, setOptions] = useState<ToolOptions>({});
  const [isSplitImageReady, setIsSplitImageReady] = useState(true);
  const [displayToolDialog, setDisplayToolDialog] = useState(activeToolDialog);

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

  const sourceNode = useMemo(() => {
    if (!displayToolDialog) {
      return null;
    }

    return nodes.find((node) => node.id === displayToolDialog.nodeId) ?? null;
  }, [displayToolDialog, nodes]);

  const sourceImageUrl = useMemo(() => {
    if (!sourceNode) {
      return null;
    }

    if (isUploadNode(sourceNode) || isImageEditNode(sourceNode) || isExportImageNode(sourceNode)) {
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

  useEffect(() => {
    if (!sourceNode || !activePlugin) {
      return;
    }

    let cancelled = false;
    setError(null);
    const initialOptions = activePlugin.createInitialOptions(sourceNode);
    setOptions(initialOptions);

    if (activePlugin.editor !== 'split' || !sourceImageUrl) {
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
        console.warn('[StoryboardMetadata] read failed on split dialog init', error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [dialogKey, sourceNode, activePlugin, sourceImageUrl]);

  useEffect(() => {
    const requiresSplitPreload = activePlugin?.editor === 'split' && Boolean(sourceImageUrl);
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
  }, [activePlugin?.editor, sourceImageUrl]);

  const closeDialog = useCallback(() => {
    canvasEventBus.publish('tool-dialog/close', undefined);
  }, []);

  const resolveToolLabel = useCallback((toolType: NodeToolType | undefined) => {
    if (!toolType) {
      return '';
    }
    if (toolType === NODE_TOOL_TYPES.crop) {
      return t('tool.crop');
    }
    if (toolType === NODE_TOOL_TYPES.annotate) {
      return t('tool.annotate');
    }
    if (toolType === NODE_TOOL_TYPES.splitStoryboard) {
      return t('tool.split');
    }
    return '';
  }, [t]);
  const resolveResultNodeTitle = useCallback((toolType: NodeToolType | undefined) => {
    if (toolType === NODE_TOOL_TYPES.crop) {
      return t('toolDialog.cropResultTitle');
    }
    if (toolType === NODE_TOOL_TYPES.annotate) {
      return t('toolDialog.annotateResultTitle');
    }
    return EXPORT_RESULT_DISPLAY_NAME.generic;
  }, [t]);

  const handleApply = useCallback(async () => {
    if (!activeToolDialog || !sourceNode || !sourceImageUrl || !activePlugin) {
      setError(t('toolDialog.noProcessableImage'));
      return;
    }

    setIsProcessing(true);
    setError(null);

    try {
      const result = await activePlugin.execute(sourceImageUrl, options, {
        processTool: (toolType, imageUrl, toolOptions) =>
          canvasToolProcessor.process(toolType, imageUrl, toolOptions),
      });

      if (result.storyboardFrames && result.rows && result.cols) {
        const createdNodeId = addStoryboardSplitNode(
          sourceNode.id,
          result.rows,
          result.cols,
          result.storyboardFrames,
          result.frameAspectRatio
        );
        if (createdNodeId) {
          addEdge(sourceNode.id, createdNodeId);
        }
      } else if (result.outputImageUrl) {
        const prepared = await prepareNodeImage(result.outputImageUrl);
        const createdNodeId = addDerivedExportNode(
          sourceNode.id,
          prepared.imageUrl,
          prepared.aspectRatio,
          prepared.previewImageUrl,
          {
            defaultTitle: resolveResultNodeTitle(activeToolDialog.toolType),
            resultKind: 'generic',
            aspectRatioStrategy: 'provided',
            sizeStrategy: 'autoMinEdge',
          }
        );
        if (createdNodeId) {
          addEdge(sourceNode.id, createdNodeId);
        }
      }

      closeDialog();
    } catch (processError) {
      setError(processError instanceof Error ? processError.message : t('toolDialog.processFailed'));
    } finally {
      setIsProcessing(false);
    }
  }, [
    activeToolDialog,
    sourceNode,
    sourceImageUrl,
    activePlugin,
    options,
    addStoryboardSplitNode,
    addDerivedExportNode,
    addEdge,
    closeDialog,
    resolveResultNodeTitle,
    t,
  ]);

  const widthClassName = useMemo(() => {
    if (!activePlugin) {
      return 'w-[min(460px,calc(100vw-40px))]';
    }
    if (activePlugin.editor === 'crop') {
      return 'w-[min(980px,calc(100vw-40px))]';
    }
    if (activePlugin.editor === 'annotate') {
      return 'w-[min(1120px,calc(100vw-40px))]';
    }
    if (activePlugin.editor === 'split') {
      return 'w-[min(1120px,calc(100vw-40px))]';
    }
    return 'w-[min(460px,calc(100vw-40px))]';
  }, [activePlugin]);

  const editorContent = useMemo(() => {
    if (!activePlugin) {
      return null;
    }

    if (activePlugin.editor === 'crop' && sourceImageUrl) {
      return (
        <CropToolEditor
          plugin={activePlugin}
          sourceImageUrl={sourceImageUrl}
          options={options}
          onOptionsChange={setOptions}
        />
      );
    }

    if (activePlugin.editor === 'annotate' && sourceImageUrl) {
      return (
        <AnnotateToolEditor
          plugin={activePlugin}
          sourceImageUrl={sourceImageUrl}
          options={options}
          onOptionsChange={setOptions}
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
  }, [activePlugin, options, sourceImageUrl]);

  const isOpen = Boolean(activeToolDialog && isSplitImageReady);

  return (
    <UiModal
      isOpen={isOpen}
      title={`${resolveToolLabel(activePlugin?.type)}${t('toolDialog.suffix')}`}
      onClose={closeDialog}
      widthClassName={widthClassName}
      footer={
        <>
          <UiButton variant="ghost" size="sm" onClick={closeDialog}>
            {t('common.cancel')}
          </UiButton>
          <UiButton size="sm" variant="primary" onClick={handleApply} disabled={isProcessing || !sourceImageUrl}>
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
