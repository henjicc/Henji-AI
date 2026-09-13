import { readImageInfo } from '@/commands/image'
import { registry } from '@/core/ModelRegistry'
import { prepareUpscalePreflight } from '../capabilities'
import type { GenerationNodeRuntimePreparationContext } from '../nodes/shared/generationNodeExecutionTypes'

export async function prepareUpscaleNodeRuntime({ images, params, modelId }: GenerationNodeRuntimePreparationContext): Promise<DynamicValueMap> {
  if (images.length !== 1) throw new Error('高清放大必须且只能提供 1 张源图')
  const model = registry.getModel(modelId)
  if (!model) throw new Error('当前高清放大模型不存在')
  return prepareUpscalePreflight(await readImageInfo(images[0]), model, params).runtimeParams
}
