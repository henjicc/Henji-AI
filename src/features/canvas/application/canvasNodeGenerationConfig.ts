import { z } from 'zod'
import { registry } from '@/core/ModelRegistry'
import type { JsonValue } from '@/core/application-control'
import { describeGenerationModel } from '@/features/generation/application/generationPreparationService'
import type { CanvasNode } from '../domain/canvasNodes'
import { extractCanvasNodeData, listCanvasNodeDataKeys } from '../domain/nodeControlRegistry'
import { CanvasApplicationError } from './canvasApplicationService'

export const canvasNodeGenerationConfigSchema = z.object({
  prompt: z.string().max(32 * 1024),
  modelId: z.string().min(1),
  params: z.record(z.string(), z.unknown()),
}).strict()

export type CanvasNodeGenerationConfig = z.infer<typeof canvasNodeGenerationConfigSchema>

export function isCanvasNodeModelLocked(node: CanvasNode): boolean {
  const ui = node.data.generationUi
  return Boolean(ui && typeof ui === 'object' && !Array.isArray(ui)
    && (ui as Record<string, unknown>).modelMode === 'locked')
}

export function supportsCanvasNodeGenerationConfig(node: CanvasNode): boolean {
  const keys = listCanvasNodeDataKeys(node.type)
  return ['prompt', 'modelId', 'params'].every((key) => keys.includes(key))
}

export function readCanvasNodeGenerationConfig(node: CanvasNode): JsonValue {
  if (!supportsCanvasNodeGenerationConfig(node)) return null
  return JSON.parse(JSON.stringify({
    prompt: node.data.prompt ?? '', modelId: node.data.modelId ?? null, params: node.data.params ?? {},
  })) as JsonValue
}

export function readCanvasNodeGenerationSchema(node: CanvasNode): JsonValue {
  if (!supportsCanvasNodeGenerationConfig(node)) return null
  const modelId = node.data.modelId
  const model = typeof modelId === 'string' ? registry.getModel(modelId) : undefined
  return JSON.parse(JSON.stringify({
    modelLocked: isCanvasNodeModelLocked(node),
    fields: listCanvasNodeDataKeys(node.type).filter((key) => ['prompt', 'modelId', 'params'].includes(key)),
    model: model ? describeGenerationModel(model) : null,
    generationUi: node.data.generationUi ?? null,
    writeMode: 'replace',
  })) as JsonValue
}

/** 通用属性和旧节点更新共用同一模型锁与节点注册校验。 */
export function validateCanvasNodeDataPatch(node: CanvasNode, data: Record<string, unknown>) {
  const locked = isCanvasNodeModelLocked(node)
  if (locked && typeof data.modelId === 'string' && data.modelId !== node.data.modelId) {
    throw new CanvasApplicationError('CAPABILITY_REJECTED',
      '固定图片工具的模型由能力契约锁定，不能修改；请重新应用目标画布图片能力。',
      true, { nodeId: node.id, modelId: node.data.modelId })
  }
  return extractCanvasNodeData(node.type, data, node.data as Record<string, unknown>, locked)
}

export function validateCanvasNodeGenerationConfig(node: CanvasNode, input: CanvasNodeGenerationConfig) {
  if (!supportsCanvasNodeGenerationConfig(node)) {
    throw new Error(`节点 ${node.type} 不支持生成配置；请读取 canvas.node.node_type 并选择生成节点。`)
  }
  const config = canvasNodeGenerationConfigSchema.parse(input)
  return validateCanvasNodeDataPatch(node, config)
}
