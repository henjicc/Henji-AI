import { registry } from '@/core/ModelRegistry'
import { mapCanvasNodeMediaReferences as mapMediaReferences, type CanvasMediaSchemaResolver, type CanvasNodeMediaValueMapper } from '@/core/canvas/nodeMediaReferences'

export type { CanvasNodeMediaValueMapper } from '@/core/canvas/nodeMediaReferences'
export const resolveCanvasNodeMediaSchema: CanvasMediaSchemaResolver = (modelId) => registry.getModel(modelId)?.params

/** 媒体字段遍历由中立核心维护；渲染层只注入当前应用模型目录。 */
export function mapCanvasNodeMediaReferences(data: DynamicValueMap, mapValue: CanvasNodeMediaValueMapper): DynamicValueMap {
  return mapMediaReferences(data, mapValue, resolveCanvasNodeMediaSchema)
}
