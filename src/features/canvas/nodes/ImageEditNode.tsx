import { memo } from 'react';
import type { NodeProps } from '@xyflow/react';

import { CANVAS_NODE_TYPES, type ImageEditNodeData } from '@/features/canvas/domain/canvasNodes';
import {
  GenerationNodeShell,
  type GenerationNodeShellData,
} from '@/features/canvas/nodes/shared/GenerationNodeShell';
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
  excludeParamIds: readonly string[];
}

const DEFAULT_GENERATION_UI: ImageEditGenerationUi = {
  promptMode: 'required',
  modelMode: 'selectable',
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
  const excludeParamIds = Array.isArray(raw.excludeParamIds)
    ? raw.excludeParamIds.filter((item): item is string => typeof item === 'string')
    : [];
  return { promptMode, modelMode, excludeParamIds };
}

export const ImageEditNode = memo(({ id, data, selected, width, height }: ImageEditNodeProps) => {
  const generationUi = resolveGenerationUi(data);
  return (
    <GenerationNodeShell
      id={id}
      nodeType={CANVAS_NODE_TYPES.imageEdit}
      data={data as GenerationNodeShellData}
      selected={selected}
      width={width}
      height={height}
      icon={<ImageGenerationIcon className="h-4 w-4" />}
      promptPlaceholderKey="node.imageEdit.promptPlaceholder"
      promptRequiredKey="node.imageEdit.promptRequired"
      apiKeyRequiredKey="node.imageEdit.apiKeyRequired"
      resultTitleKey="node.imageEdit.resultTitle"
      resultNodeExtraData={{ resultKind: 'generic' }}
      showPromptInput={generationUi.promptMode !== 'hidden'}
      requirePrompt={generationUi.promptMode === 'required'}
      showModelInput={generationUi.modelMode !== 'locked'}
      excludeParamIds={generationUi.excludeParamIds}
    />
  );
});

ImageEditNode.displayName = 'ImageEditNode';
