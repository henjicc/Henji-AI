import { memo } from 'react';
import type { NodeProps } from '@xyflow/react';
import { useTranslation } from 'react-i18next';

import { ICON_PANORAMA } from '@/core/theme/icons';
import { CANVAS_IMAGE_CAPABILITY_IDS } from '@/features/canvas/capabilities';
import {
  CANVAS_NODE_TYPES,
  type PanoramaGenerationNodeData,
} from '@/features/canvas/domain/canvasNodes';
import {
  GenerationNodeShell,
  type GenerationNodeShellData,
} from '@/features/canvas/nodes/shared/GenerationNodeShell';

type PanoramaGenerationNodeProps = NodeProps & {
  id: string;
  data: PanoramaGenerationNodeData;
  selected?: boolean;
};

const PanoramaIcon = ICON_PANORAMA;

export const PanoramaGenerationNode = memo(({
  id,
  data,
  selected,
  width,
  height,
}: PanoramaGenerationNodeProps) => {
  const { t } = useTranslation();
  return (
    <GenerationNodeShell
      id={id}
      nodeType={CANVAS_NODE_TYPES.panoramaGen}
      data={data as GenerationNodeShellData}
      selected={selected}
      width={width}
      height={height}
      icon={<PanoramaIcon className="h-4 w-4" />}
      capabilityId={CANVAS_IMAGE_CAPABILITY_IDS.panorama}
      promptPlaceholderKey="node.panoramaGeneration.promptPlaceholder"
      promptRequiredKey="node.panoramaGeneration.promptRequired"
      apiKeyRequiredKey="node.panoramaGeneration.apiKeyRequired"
      resultTitleKey="node.panoramaGeneration.resultTitle"
      resultNodeExtraData={{ resultKind: 'panorama' }}
      requirePrompt={false}
      layoutMode="workbench"
      workbenchSummary={t('node.panoramaGeneration.workbenchSummary')}
      minHeight={320}
    />
  );
});

PanoramaGenerationNode.displayName = 'PanoramaGenerationNode';
