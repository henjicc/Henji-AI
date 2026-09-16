import { memo } from 'react';
import type { NodeProps } from '@xyflow/react';

import { ICON_UPSCALE } from '@/core/theme/icons';
import {
  CANVAS_IMAGE_CAPABILITY_IDS,
} from '@/features/canvas/capabilities';
import {
  CANVAS_NODE_TYPES,
  type UpscaleGenerationNodeData,
} from '@/features/canvas/domain/canvasNodes';
import {
  GenerationNodeShell,
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
      showPromptInput={false}
    />
  );
});

UpscaleGenerationNode.displayName = 'UpscaleGenerationNode';
