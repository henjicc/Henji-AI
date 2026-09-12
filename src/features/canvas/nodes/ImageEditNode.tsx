import { memo, useCallback } from 'react';
import type { NodeProps } from '@xyflow/react';
import { useTranslation } from 'react-i18next';

import { UiEmpty } from '@/components/ui';
import { CANVAS_NODE_TYPES, type ImageEditNodeData } from '@/features/canvas/domain/canvasNodes';
import { prepareImageEditNodeRuntime } from '../application/imageEditNodePreparation';
import type { GenerationNodeRuntimePreparationContext } from './shared/generationNodeExecutionTypes';
import {
  GenerationNodeShell,
  type GenerationNodeShellData,
} from '@/features/canvas/nodes/shared/GenerationNodeShell';
import { useCanvasStore } from '@/stores/canvasStore';
import { OutpaintStage } from './outpaint/OutpaintStage';
import { OUTPAINT_FIELDS, type OutpaintMargins } from '../domain/outpaintGeometry';
import { CANVAS_IMAGE_CAPABILITY_IDS } from '../capabilities';
import { OUTPAINT_WORKSPACE_MAXIMUM, readOutpaintComposition } from '../domain/outpaintModelParams';
import { prepareOutpaintGeneration } from '../application/outpaintGenerationPreparation';
import { resolveOutpaintNodeLayout } from '../domain/outpaintNodeLayout';
import { ICON_NODE_IMAGE_GENERATION } from '@/core/theme/icons';

const ImageGenerationIcon = ICON_NODE_IMAGE_GENERATION;

type ImageEditNodeProps = NodeProps & {
  id: string;
  data: ImageEditNodeData;
  selected?: boolean;
};

interface ImageEditGenerationUi {
  promptMode: 'required' | 'optional' | 'hidden';
  modelMode: 'selectable' | 'locked';
  layoutMode: 'stacked' | 'workbench';
  excludeParamIds: readonly string[];
  promptMaxCharacters?: number;
  workbenchEditor?: 'outpaint';
}

const DEFAULT_GENERATION_UI: ImageEditGenerationUi = {
  promptMode: 'required',
  modelMode: 'selectable',
  layoutMode: 'stacked',
  excludeParamIds: [],
};

function resolveGenerationUi(data: ImageEditNodeData): ImageEditGenerationUi {
  const value = (data as ImageEditNodeData & { generationUi?: unknown }).generationUi;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return DEFAULT_GENERATION_UI;
  const raw = value as Record<string, unknown>;
  const promptMode = raw.promptMode === 'hidden' || raw.promptMode === 'optional'
    ? raw.promptMode
    : 'required';
  const modelMode = raw.modelMode === 'locked' ? 'locked' : 'selectable';
  const layoutMode = raw.layoutMode === 'workbench' ? 'workbench' : 'stacked';
  const excludeParamIds = Array.isArray(raw.excludeParamIds)
    ? raw.excludeParamIds.filter((item): item is string => typeof item === 'string')
    : [];
  const promptMaxCharacters = typeof raw.promptMaxCharacters === 'number'
    && Number.isInteger(raw.promptMaxCharacters)
    && raw.promptMaxCharacters > 0
      ? raw.promptMaxCharacters
      : undefined;
  return { promptMode, modelMode, layoutMode, excludeParamIds, promptMaxCharacters,
    workbenchEditor: raw.workbenchEditor === 'outpaint' ? 'outpaint' : undefined };
}

export const ImageEditNode = memo(({ id, data, selected, width, height }: ImageEditNodeProps) => {
  const { t } = useTranslation();
  const generationUi = resolveGenerationUi(data);
  const isOutpaint = generationUi.workbenchEditor === 'outpaint';
  const aspect = typeof data.outpaintSourceAspectRatio === 'number' && data.outpaintSourceAspectRatio > 0
    ? data.outpaintSourceAspectRatio : undefined;
  const outpaintLayout = resolveOutpaintNodeLayout(aspect ?? 1);
  const onSourceAspectRatio = useCallback((next: number) => {
    useCanvasStore.getState().updateNodeData(id, { outpaintSourceAspectRatio: next }, { skipHistory: true });
  }, [id]);
  const maximum = OUTPAINT_WORKSPACE_MAXIMUM;
  const commitMargins = useCallback((margins: OutpaintMargins) => {
    const store = useCanvasStore.getState();
    store.updateNodeData(id, { outpaintMargins: margins });
  }, [id]);
  const prepareRuntimeParams = useCallback((context: GenerationNodeRuntimePreparationContext) =>
    prepareImageEditNodeRuntime(context, { isOutpaint, excludeParamIds: generationUi.excludeParamIds, t }),
  [generationUi.excludeParamIds, isOutpaint, t]);
  return (
    <GenerationNodeShell
      id={id}
      nodeType={CANVAS_NODE_TYPES.imageEdit}
      data={data as GenerationNodeShellData}
      selected={selected}
      width={width}
      height={height}
      icon={<ImageGenerationIcon className="h-4 w-4" />}
      promptPlaceholderKey={isOutpaint ? "node.outpaint.promptPlaceholder" : "node.imageEdit.promptPlaceholder"}
      promptRequiredKey="node.imageEdit.promptRequired"
      apiKeyRequiredKey="node.imageEdit.apiKeyRequired"
      resultTitleKey="node.imageEdit.resultTitle"
      resultNodeExtraData={{ resultKind: 'generic' }}
      capabilityId={isOutpaint ? CANVAS_IMAGE_CAPABILITY_IDS.outpaint : undefined}
      showPromptInput={generationUi.promptMode !== 'hidden'}
      requirePrompt={generationUi.promptMode === 'required'}
      promptMaxCharacters={isOutpaint ? undefined : generationUi.promptMaxCharacters}
      showModelInput={isOutpaint || generationUi.modelMode !== 'locked'}
      hideAspectRatio={isOutpaint}
      excludeParamIds={isOutpaint ? [...generationUi.excludeParamIds, ...OUTPAINT_FIELDS, 'zoomOutPercentage'] : generationUi.excludeParamIds}
      prepareRuntimeParams={prepareRuntimeParams}
      prepareGenerationRequest={isOutpaint ? prepareOutpaintGeneration : undefined}
      layoutMode={generationUi.layoutMode}
      minWidth={isOutpaint ? outpaintLayout.minWidth : undefined}
      minHeight={isOutpaint ? outpaintLayout.minHeight : undefined}
      workbenchMediaInput={isOutpaint ? 'image' : undefined}
      workbenchInspectorWidth={isOutpaint ? 200 : undefined}
      workbenchPromptLast={isOutpaint}
      workbenchStageAspectRatio={isOutpaint ? aspect : undefined}
      workbenchStage={isOutpaint ? ({ images }) => images[0] ? (
        <OutpaintStage key={`${images[0]}:${aspect}`} source={images[0]} params={readOutpaintComposition(data)} maximum={maximum} onCommit={commitMargins} onSourceAspectRatio={onSourceAspectRatio} />
      ) : <UiEmpty title={t('node.outpaint.chooseSource')} /> : undefined}
    />
  );
});

ImageEditNode.displayName = 'ImageEditNode';
