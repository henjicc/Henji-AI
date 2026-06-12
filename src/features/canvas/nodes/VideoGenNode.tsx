import { memo } from 'react';
import { Video } from 'lucide-react';
import type { NodeProps } from '@xyflow/react';

import { CANVAS_NODE_TYPES, type VideoGenNodeData } from '@/features/canvas/domain/canvasNodes';
import {
  GenerationNodeShell,
  type GenerationNodeShellData,
} from '@/features/canvas/nodes/shared/GenerationNodeShell';

type VideoGenNodeProps = NodeProps & {
  id: string;
  data: VideoGenNodeData;
  selected?: boolean;
};

export const VideoGenNode = memo(({ id, data, selected, width, height }: VideoGenNodeProps) => (
  <GenerationNodeShell
    id={id}
    nodeType={CANVAS_NODE_TYPES.videoGen}
    data={data as GenerationNodeShellData}
    selected={selected}
    width={width}
    height={height}
    icon={<Video className="h-4 w-4" />}
    promptPlaceholderKey="node.videoGen.promptPlaceholder"
    promptRequiredKey="node.videoGen.promptRequired"
    apiKeyRequiredKey="node.imageEdit.apiKeyRequired"
    resultTitleKey="node.videoGen.resultTitle"
  />
));

VideoGenNode.displayName = 'VideoGenNode';
