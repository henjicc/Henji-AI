import { memo, useCallback } from 'react';
import type { NodeProps } from '@xyflow/react';

import { ICON_NODE_ASSET_GROUP } from '@/core/theme/icons';
import { CANVAS_IMAGE_CAPABILITY_IDS } from '@/features/canvas/capabilities';
import { commitLayerSeparationGeneration } from '@/features/canvas/application/layerSeparationGenerationService';
import {
  CANVAS_NODE_TYPES,
  type LayerSeparationGenerationNodeData,
} from '@/features/canvas/domain/canvasNodes';
import {
  GenerationNodeShell,
  type GenerationNodeResultCommitContext,
  type GenerationNodeRuntimePreparationContext,
  type GenerationNodeShellData,
} from '@/features/canvas/nodes/shared/GenerationNodeShell';

type LayerSeparationGenerationNodeProps = NodeProps & {
  id: string;
  data: LayerSeparationGenerationNodeData;
  selected?: boolean;
};

export const LayerSeparationGenerationNode = memo(({
  id,
  data,
  selected,
  width,
  height,
}: LayerSeparationGenerationNodeProps) => {
  const prepareRuntimeParams = useCallback(({ images }: GenerationNodeRuntimePreparationContext) => {
    if (images.length !== 1) throw new Error('图层拆分必须且只能提供 1 张源图');
    return {};
  }, []);
  const commitGenerationResult = useCallback((context: GenerationNodeResultCommitContext) => {
    const sourceImage = context.inputs.images[0];
    if (!sourceImage) throw new Error('图层拆分结果缺少源图引用');
    return commitLayerSeparationGeneration({
      sourceNodeId: context.sourceNodeId,
      placeholderNodeId: context.placeholderNodeId,
      resultNodeType: context.resultNodeType,
      completionId: context.completionId,
      sourceImage,
      providerId: context.providerId,
      modelId: context.modelId,
      result: context.result,
    });
  }, []);

  return (
    <GenerationNodeShell
      id={id}
      nodeType={CANVAS_NODE_TYPES.layerSeparationGen}
      data={data as GenerationNodeShellData}
      selected={selected}
      width={width}
      height={height}
      icon={<ICON_NODE_ASSET_GROUP className="h-4 w-4" />}
      capabilityId={CANVAS_IMAGE_CAPABILITY_IDS.layerSeparation}
      promptPlaceholderKey="node.layerSeparationGeneration.promptPlaceholder"
      promptRequiredKey="node.layerSeparationGeneration.promptRequired"
      apiKeyRequiredKey="node.layerSeparationGeneration.apiKeyRequired"
      resultTitleKey="node.layerSeparationGeneration.resultTitle"
      resultNodeExtraData={{ resultKind: 'layer-stack' }}
      requirePrompt={false}
      prepareRuntimeParams={prepareRuntimeParams}
      commitGenerationResult={commitGenerationResult}
      minHeight={220}
    />
  );
});

LayerSeparationGenerationNode.displayName = 'LayerSeparationGenerationNode';
