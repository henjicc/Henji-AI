import type { TFunction } from 'i18next'
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
