import { memo } from 'react';
import { Sparkles } from 'lucide-react';
import type { NodeProps } from '@xyflow/react';

import { CANVAS_NODE_TYPES, type ImageEditNodeData } from '@/features/canvas/domain/canvasNodes';
import {
  GenerationNodeShell,
  type GenerationNodeShellData,
} from '@/features/canvas/nodes/shared/GenerationNodeShell';

type ImageEditNodeProps = NodeProps & {
  id: string;
  data: ImageEditNodeData;
  selected?: boolean;
};

export const ImageEditNode = memo(({ id, data, selected, width, height }: ImageEditNodeProps) => (
  <GenerationNodeShell
    id={id}
    nodeType={CANVAS_NODE_TYPES.imageEdit}
    data={data as GenerationNodeShellData}
    selected={selected}
    width={width}
    height={height}
    icon={<Sparkles className="h-4 w-4" />}
    promptPlaceholderKey="node.imageEdit.promptPlaceholder"
    promptRequiredKey="node.imageEdit.promptRequired"
    apiKeyRequiredKey="node.imageEdit.apiKeyRequired"
    resultTitleKey="node.imageEdit.resultTitle"
    resultNodeExtraData={{ resultKind: 'generic' }}
  />
));

ImageEditNode.displayName = 'ImageEditNode';
