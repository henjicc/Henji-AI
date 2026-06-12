import { memo } from 'react';
import { AudioLines } from 'lucide-react';
import type { NodeProps } from '@xyflow/react';

import { CANVAS_NODE_TYPES, type AudioGenNodeData } from '@/features/canvas/domain/canvasNodes';
import {
  GenerationNodeShell,
  type GenerationNodeShellData,
} from '@/features/canvas/nodes/shared/GenerationNodeShell';

type AudioGenNodeProps = NodeProps & {
  id: string;
  data: AudioGenNodeData;
  selected?: boolean;
};

export const AudioGenNode = memo(({ id, data, selected, width, height }: AudioGenNodeProps) => (
  <GenerationNodeShell
    id={id}
    nodeType={CANVAS_NODE_TYPES.audioGen}
    data={data as GenerationNodeShellData}
    selected={selected}
    width={width}
    height={height}
    icon={<AudioLines className="h-4 w-4" />}
    promptPlaceholderKey="node.audioGen.promptPlaceholder"
    promptRequiredKey="node.audioGen.promptRequired"
    apiKeyRequiredKey="node.imageEdit.apiKeyRequired"
    resultTitleKey="node.audioGen.resultTitle"
  />
));

AudioGenNode.displayName = 'AudioGenNode';
