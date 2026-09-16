import { memo } from 'react';
import type { NodeProps } from '@xyflow/react';

import { ICON_NODE_ASSET_GROUP } from '@/core/theme/icons';
import { CANVAS_IMAGE_CAPABILITY_IDS } from '@/features/canvas/capabilities';
import {
  CANVAS_NODE_TYPES,
  type LayerSeparationGenerationNodeData,
} from '@/features/canvas/domain/canvasNodes';
import {
  GenerationNodeShell,
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
    />
  );
});

LayerSeparationGenerationNode.displayName = 'LayerSeparationGenerationNode';
