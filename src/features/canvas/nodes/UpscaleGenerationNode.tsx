import { memo, useCallback } from 'react';
import type { NodeProps } from '@xyflow/react';
import { useTranslation } from 'react-i18next';

import { readImageInfo } from '@/commands/image';
import { registry } from '@/core/ModelRegistry';
import { ICON_UPSCALE } from '@/core/theme/icons';
import {
  CANVAS_IMAGE_CAPABILITY_IDS,
  prepareUpscalePreflight,
} from '@/features/canvas/capabilities';
import {
  CANVAS_NODE_TYPES,
  type UpscaleGenerationNodeData,
} from '@/features/canvas/domain/canvasNodes';
import {
  GenerationNodeShell,
  type GenerationNodeRuntimePreparationContext,
  type GenerationNodeShellData,
} from '@/features/canvas/nodes/shared/GenerationNodeShell';

type UpscaleGenerationNodeProps = NodeProps & {
  id: string;
  data: UpscaleGenerationNodeData;
  selected?: boolean;
};

const UpscaleIcon = ICON_UPSCALE;

export const UpscaleGenerationNode = memo(({
  id,
  data,
  selected,
  width,
  height,
}: UpscaleGenerationNodeProps) => {
  const { t } = useTranslation();
  const prepareRuntimeParams = useCallback(async ({
    images,
    params,
    modelId,
  }: GenerationNodeRuntimePreparationContext): Promise<DynamicValueMap> => {
    if (images.length !== 1) {
      throw new Error('高清放大必须且只能提供 1 张源图');
    }
    const model = registry.getModel(modelId);
    if (!model) throw new Error('当前高清放大模型不存在');
    const info = await readImageInfo(images[0]);
    return prepareUpscalePreflight(
      info,
      model,
      params,
    ).runtimeParams;
  }, []);

  return (
    <GenerationNodeShell
      id={id}
      nodeType={CANVAS_NODE_TYPES.upscaleGen}
      data={data as GenerationNodeShellData}
      selected={selected}
      width={width}
      height={height}
      icon={<UpscaleIcon className="h-4 w-4" />}
      capabilityId={CANVAS_IMAGE_CAPABILITY_IDS.upscale}
      promptPlaceholderKey="node.upscaleGeneration.promptPlaceholder"
      promptRequiredKey="node.upscaleGeneration.promptRequired"
      apiKeyRequiredKey="node.upscaleGeneration.apiKeyRequired"
      resultTitleKey="node.upscaleGeneration.resultTitle"
      showPromptInput={false}
      requirePrompt={false}
      prepareRuntimeParams={prepareRuntimeParams}
      layoutMode="workbench"
      workbenchSummary={t('node.upscaleGeneration.workbenchSummary')}
      minHeight={300}
    />
  );
});

UpscaleGenerationNode.displayName = 'UpscaleGenerationNode';
