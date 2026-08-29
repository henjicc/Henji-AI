import { memo, useCallback } from 'react';
import type { NodeProps } from '@xyflow/react';
import { useTranslation } from 'react-i18next';

import { readImageInfo } from '@/commands/image';
import { registry } from '@/core/ModelRegistry';
import { CANVAS_NODE_TYPES, type ImageEditNodeData } from '@/features/canvas/domain/canvasNodes';
import {
  formatAcceptedMediaTypes,
  GenerationMediaInputConstraintError,
  resolveGenerationMediaInputConstraints,
  validateGenerationImageInputs,
} from '@/features/canvas/application/generationMediaInputConstraints';
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
  promptMaxCharacters?: number;
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
  const promptMaxCharacters = typeof raw.promptMaxCharacters === 'number'
    && Number.isInteger(raw.promptMaxCharacters)
    && raw.promptMaxCharacters > 0
      ? raw.promptMaxCharacters
      : undefined;
  return { promptMode, modelMode, excludeParamIds, promptMaxCharacters };
}

export const ImageEditNode = memo(({ id, data, selected, width, height }: ImageEditNodeProps) => {
  const { t } = useTranslation();
  const generationUi = resolveGenerationUi(data);
  const prepareRuntimeParams = useCallback(async ({
    images,
    modelId,
  }: {
    images: string[];
    modelId: string;
  }): Promise<DynamicValueMap> => {
    const model = registry.getModel(modelId);
    if (!model) return {};
    const constraint = resolveGenerationMediaInputConstraints(
      model.params,
      generationUi.excludeParamIds,
    ).image;
    try {
      await validateGenerationImageInputs(images, constraint, readImageInfo);
    } catch (error) {
      if (!(error instanceof GenerationMediaInputConstraintError)) throw error;
      if (error.code === 'too-large') {
        throw new Error(t('node.mediaRow.maxSizeExceeded', {
          max: Math.max(0.1, (constraint?.maxSizeBytes ?? 0) / 1024 / 1024).toFixed(1),
        }));
      }
      if (error.code === 'unreadable') {
        throw new Error(t('node.mediaRow.constraintReadFailed'));
      }
      throw new Error(t('node.mediaRow.unsupportedFormat', {
        formats: formatAcceptedMediaTypes(constraint?.accept ?? []),
      }));
    }
    return {};
  }, [generationUi.excludeParamIds, t]);
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
      promptMaxCharacters={generationUi.promptMaxCharacters}
      showModelInput={generationUi.modelMode !== 'locked'}
      excludeParamIds={generationUi.excludeParamIds}
      prepareRuntimeParams={prepareRuntimeParams}
    />
  );
});

ImageEditNode.displayName = 'ImageEditNode';
