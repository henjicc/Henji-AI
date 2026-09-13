import type { TFunction } from 'i18next'
import type { CanvasNodeData } from '../domain/canvasNodes'
import { readImageInfo } from '@/commands/image'
import { registry } from '@/core/ModelRegistry'
import {
  formatAcceptedMediaTypes, GenerationMediaInputConstraintError,
  resolveGenerationMediaInputConstraints, validateGenerationImageInputs,
} from './generationMediaInputConstraints'
import { readOutpaintComposition, resolveOutpaintModelParams } from '../domain/outpaintModelParams'
import type { GenerationNodeRuntimePreparationContext } from '../nodes/shared/generationNodeExecutionTypes'

/** 图片节点与任务服务共用的素材校验、扩图参数准备。 */
export async function prepareImageEditNodeRuntime(
  { images, modelId, data: runtimeData, params }: GenerationNodeRuntimePreparationContext,
  { isOutpaint, excludeParamIds, t }: { isOutpaint: boolean; excludeParamIds: readonly string[]; t: TFunction },
): Promise<DynamicValueMap> {
  const model = registry.getModel(modelId);
  if (!model) return {};
  if (isOutpaint && images.length !== 1) throw new Error(t('node.outpaint.chooseSource'));
  const constraint = resolveGenerationMediaInputConstraints(
    model.params,
    excludeParamIds,
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
  if (isOutpaint && images[0]) {
    const image = await readImageInfo(images[0]);
    return resolveOutpaintModelParams(model, params, image, readOutpaintComposition(runtimeData)).params;
  }
  return {};
}

interface ImageEditGenerationUi {
  promptMode: 'required' | 'optional' | 'hidden';
  modelMode: 'selectable' | 'locked';
  layoutMode: 'stacked' | 'workbench';
  excludeParamIds: readonly string[];
  promptMaxCharacters?: number;
  workbenchEditor?: 'outpaint';
}

const DEFAULT_GENERATION_UI: ImageEditGenerationUi = {
  promptMode: 'required',
  modelMode: 'selectable',
  layoutMode: 'stacked',
  excludeParamIds: [],
};

export function resolveImageEditGenerationUi(data: CanvasNodeData): ImageEditGenerationUi {
  const value = data.generationUi;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return DEFAULT_GENERATION_UI;
  const raw = value as Record<string, unknown>;
  const promptMode = raw.promptMode === 'hidden' || raw.promptMode === 'optional'
    ? raw.promptMode
    : 'required';
  const modelMode = raw.modelMode === 'locked' ? 'locked' : 'selectable';
  const layoutMode = raw.layoutMode === 'workbench' ? 'workbench' : 'stacked';
  const excludeParamIds = Array.isArray(raw.excludeParamIds)
    ? raw.excludeParamIds.filter((item): item is string => typeof item === 'string')
    : [];
  const promptMaxCharacters = typeof raw.promptMaxCharacters === 'number'
    && Number.isInteger(raw.promptMaxCharacters)
    && raw.promptMaxCharacters > 0
      ? raw.promptMaxCharacters
      : undefined;
  return { promptMode, modelMode, layoutMode, excludeParamIds, promptMaxCharacters,
    workbenchEditor: raw.workbenchEditor === 'outpaint' ? 'outpaint' : undefined };
}
